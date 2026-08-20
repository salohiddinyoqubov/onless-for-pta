"""Contract and transition tests for the identity-free roadmap projector."""

from __future__ import annotations

import json
from collections.abc import Sequence

import httpx
import pytest
from pydantic import ValidationError

from onless_api.app import create_app
from onless_api.learning.fixtures import SYNTHETIC_POLICY, SyntheticEvidenceSource
from onless_api.learning.models import (
    LearningEvidence,
    RoadmapPolicy,
    RoadmapProjection,
    RoadmapStage,
    StageProgress,
    StageStatus,
)
from onless_api.learning.projection import project_roadmap
from onless_api.learning.routes import get_evidence_source


def policy(
    *,
    identifiers: tuple[str, ...] = ("start", "build", "finish"),
    titles: tuple[str, ...] = ("Start", "Build", "Finish"),
    targets: tuple[int, ...] = (2, 5, 9),
) -> RoadmapPolicy:
    return RoadmapPolicy(
        stage_ids=identifiers,
        stage_titles=titles,
        cumulative_targets=targets,
    )


def statuses(units: int) -> tuple[StageStatus, ...]:
    projection = project_roadmap(LearningEvidence(completed_units=units), policy())
    return tuple(stage.status for stage in projection.stages)


@pytest.mark.parametrize(
    ("units", "expected"),
    [
        (0, (StageStatus.AVAILABLE, StageStatus.LOCKED, StageStatus.LOCKED)),
        (1, (StageStatus.IN_PROGRESS, StageStatus.LOCKED, StageStatus.LOCKED)),
        (2, (StageStatus.COMPLETED, StageStatus.AVAILABLE, StageStatus.LOCKED)),
        (3, (StageStatus.COMPLETED, StageStatus.IN_PROGRESS, StageStatus.LOCKED)),
        (5, (StageStatus.COMPLETED, StageStatus.COMPLETED, StageStatus.AVAILABLE)),
        (8, (StageStatus.COMPLETED, StageStatus.COMPLETED, StageStatus.IN_PROGRESS)),
        (9, (StageStatus.COMPLETED, StageStatus.COMPLETED, StageStatus.COMPLETED)),
        (999, (StageStatus.COMPLETED, StageStatus.COMPLETED, StageStatus.COMPLETED)),
    ],
)
def test_projection_assigns_explicit_boundary_states(
    units: int,
    expected: tuple[StageStatus, ...],
) -> None:
    assert statuses(units) == expected


@pytest.mark.parametrize(
    ("units", "expected"),
    [
        (0, ((0, 2), (0, 3), (0, 4))),
        (1, ((1, 2), (0, 3), (0, 4))),
        (2, ((2, 2), (0, 3), (0, 4))),
        (4, ((2, 2), (2, 3), (0, 4))),
        (5, ((2, 2), (3, 3), (0, 4))),
        (8, ((2, 2), (3, 3), (3, 4))),
        (9, ((2, 2), (3, 3), (4, 4))),
        (500, ((2, 2), (3, 3), (4, 4))),
    ],
)
def test_projection_reports_stage_local_progress(
    units: int,
    expected: tuple[tuple[int, int], ...],
) -> None:
    projection = project_roadmap(LearningEvidence(completed_units=units), policy())

    assert (
        tuple((stage.progress.completed, stage.progress.total) for stage in projection.stages)
        == expected
    )


def test_projection_preserves_policy_identity_label_and_order() -> None:
    projection = project_roadmap(LearningEvidence(completed_units=4), policy())

    assert [(stage.id, stage.label, stage.order) for stage in projection.stages] == [
        ("start", "Start", 0),
        ("build", "Build", 1),
        ("finish", "Finish", 2),
    ]


def test_projection_is_deterministic_and_does_not_mutate_inputs() -> None:
    evidence = LearningEvidence(completed_units=4)
    roadmap_policy = policy()

    first = project_roadmap(evidence, roadmap_policy)
    second = project_roadmap(evidence, roadmap_policy)

    assert first == second
    assert first is not second
    assert evidence.completed_units == 4
    assert roadmap_policy.cumulative_targets == (2, 5, 9)


def _rank(status: StageStatus) -> int:
    return {
        StageStatus.LOCKED: 0,
        StageStatus.AVAILABLE: 1,
        StageStatus.IN_PROGRESS: 2,
        StageStatus.COMPLETED: 3,
    }[status]


def test_state_and_progress_are_monotonic_for_all_demo_evidence_values() -> None:
    previous = project_roadmap(LearningEvidence(completed_units=0), policy())

    for units in range(1, 30):
        current = project_roadmap(LearningEvidence(completed_units=units), policy())
        for before, after in zip(previous.stages, current.stages, strict=True):
            assert _rank(after.status) >= _rank(before.status)
            assert after.progress.completed >= before.progress.completed
            assert after.progress.total == before.progress.total
        previous = current


def test_exact_wire_contract_contains_only_web_agreed_fields() -> None:
    projection = project_roadmap(LearningEvidence(completed_units=3), policy())

    assert projection.model_dump(mode="json") == {
        "stages": [
            {
                "id": "start",
                "label": "Start",
                "order": 0,
                "status": "completed",
                "progress": {"completed": 2, "total": 2},
            },
            {
                "id": "build",
                "label": "Build",
                "order": 1,
                "status": "in_progress",
                "progress": {"completed": 1, "total": 3},
            },
            {
                "id": "finish",
                "label": "Finish",
                "order": 2,
                "status": "locked",
                "progress": {"completed": 0, "total": 4},
            },
        ]
    }


def test_projection_json_schema_is_strict_and_matches_the_public_shape() -> None:
    schema = RoadmapProjection.model_json_schema()
    stage_schema = schema["$defs"]["RoadmapStage"]
    progress_schema = schema["$defs"]["StageProgress"]

    assert schema["additionalProperties"] is False
    assert schema["required"] == ["stages"]
    assert set(schema["properties"]) == {"stages"}
    assert stage_schema["additionalProperties"] is False
    assert stage_schema["required"] == ["id", "label", "order", "status", "progress"]
    assert set(stage_schema["properties"]) == {"id", "label", "order", "status", "progress"}
    assert progress_schema["additionalProperties"] is False
    assert progress_schema["required"] == ["completed", "total"]


@pytest.mark.parametrize(
    "payload",
    [
        {"completed_units": -1},
        {"completed_units": 1_000_001},
        {"completed_units": True},
        {"completed_units": "4"},
        {"completed_units": 4, "identity": "Demo"},
    ],
)
def test_learning_evidence_rejects_out_of_range_coerced_or_extra_values(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        LearningEvidence.model_validate(payload)


@pytest.mark.parametrize(
    ("identifiers", "titles", "targets"),
    [
        (("start",), ("Start", "Build"), (2,)),
        (("start", "build"), ("Start",), (2, 5)),
        (("start", "build"), ("Start", "Build"), (2,)),
        (("start", "start"), ("Start", "Again"), (2, 5)),
        (("",), ("Start",), (2,)),
        ((" start",), ("Start",), (2,)),
        (("Start",), ("Start",), (2,)),
        (("two words",), ("Start",), (2,)),
        (("a" * 65,), ("Start",), (2,)),
        (("start",), ("",), (2,)),
        (("start",), ("Start ",), (2,)),
        (("start",), ("S" * 101,), (2,)),
        (("start",), ("Start",), (0,)),
        (("start",), ("Start",), (1_000_001,)),
        (("start", "build"), ("Start", "Build"), (2, 2)),
        (("start", "build"), ("Start", "Build"), (3, 2)),
    ],
)
def test_policy_enforces_all_stage_constraints_at_construction(
    identifiers: tuple[str, ...],
    titles: tuple[str, ...],
    targets: tuple[int, ...],
) -> None:
    with pytest.raises(ValidationError):
        policy(identifiers=identifiers, titles=titles, targets=targets)


@pytest.mark.parametrize(
    "payload",
    [
        {"stage_ids": [], "stage_titles": [], "cumulative_targets": []},
        {"stage_ids": ["start"], "stage_titles": ["Start"], "cumulative_targets": [2]},
        {
            "stage_ids": ("start",),
            "stage_titles": ("Start",),
            "cumulative_targets": (True,),
        },
        {
            "stage_ids": ("start",),
            "stage_titles": ("Start",),
            "cumulative_targets": (2,),
            "user_id": "00000000-0000-4000-8000-000000000001",
        },
    ],
)
def test_policy_uses_strict_container_and_value_types(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        RoadmapPolicy.model_validate(payload)


def test_stage_progress_rejects_impossible_counts() -> None:
    with pytest.raises(ValidationError, match="cannot exceed"):
        StageProgress(completed=4, total=3)
    with pytest.raises(ValidationError):
        StageProgress(completed=-1, total=3)
    with pytest.raises(ValidationError):
        StageProgress(completed=0, total=0)


def test_stage_rejects_invalid_identifier_and_extra_fields() -> None:
    valid = {
        "id": "foundation",
        "label": "Foundation",
        "order": 0,
        "status": StageStatus.AVAILABLE,
        "progress": StageProgress(completed=0, total=3),
    }
    with pytest.raises(ValidationError):
        RoadmapStage(**{**valid, "id": "Foundation Stage"})
    with pytest.raises(ValidationError):
        RoadmapStage(**{**valid, "threshold": 3})


@pytest.mark.asyncio
async def test_synthetic_source_is_deterministic_and_identity_free() -> None:
    source = SyntheticEvidenceSource(completed_units=6)

    assert await source.get_evidence() == LearningEvidence(completed_units=6)
    assert await source.get_evidence() == await source.get_evidence()
    assert set(LearningEvidence.model_json_schema()["properties"]) == {"completed_units"}


@pytest.mark.asyncio
async def test_demo_route_returns_exact_deterministic_contract() -> None:
    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        response = await client.get("/demo/learning-roadmap")

    assert response.status_code == 200
    assert response.json() == {
        "stages": [
            {
                "id": "foundation",
                "label": "Foundation",
                "order": 0,
                "status": "completed",
                "progress": {"completed": 3, "total": 3},
            },
            {
                "id": "practice",
                "label": "Guided practice",
                "order": 1,
                "status": "in_progress",
                "progress": {"completed": 2, "total": 4},
            },
            {
                "id": "readiness",
                "label": "Exam readiness",
                "order": 2,
                "status": "locked",
                "progress": {"completed": 0, "total": 5},
            },
        ]
    }


def test_demo_route_declares_no_identity_or_input_parameters() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/demo/learning-roadmap"]["get"]
    serialized = json.dumps(operation, sort_keys=True).lower()

    assert operation.get("parameters", []) == []
    assert "requestbody" not in operation
    assert all(term not in serialized for term in ("user_id", "session_id", "account_id"))


@pytest.mark.asyncio
async def test_demo_route_can_replace_only_the_capability_minimal_source() -> None:
    application = create_app()
    application.dependency_overrides[get_evidence_source] = lambda: SyntheticEvidenceSource(
        completed_units=12
    )

    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        response = await client.get("/demo/learning-roadmap")

    assert response.status_code == 200
    assert [stage["status"] for stage in response.json()["stages"]] == [
        "completed",
        "completed",
        "completed",
    ]


def test_fixture_policy_is_visibly_generic_and_contains_no_product_threshold_names() -> None:
    dumped = SYNTHETIC_POLICY.model_dump()
    forbidden_terms: Sequence[str] = (
        "user",
        "ticket",
        "question",
        "pass",
        "vip",
        "mastery",
    )

    assert all(term not in json.dumps(dumped).lower() for term in forbidden_terms)
