"""Pure state projection for an ordered, generic learning roadmap."""

from onless_api.learning.models import (
    LearningEvidence,
    RoadmapPolicy,
    RoadmapProjection,
    RoadmapStage,
    StageProgress,
    StageStatus,
)


def project_roadmap(
    evidence: LearningEvidence,
    policy: RoadmapPolicy,
) -> RoadmapProjection:
    """Project aggregate completion into a deterministic sequence of stages.

    The function has no clock, persistence, cache, identity, or network input.
    Evidence above the final target is intentionally capped per stage in the
    presentation contract.
    """
    stages: list[RoadmapStage] = []
    previous_target = 0

    for order, (identifier, title, target) in enumerate(
        zip(
            policy.stage_ids,
            policy.stage_titles,
            policy.cumulative_targets,
            strict=True,
        )
    ):
        stage_size = target - previous_target
        stage_completed = min(max(evidence.completed_units - previous_target, 0), stage_size)
        status = _stage_status(
            evidence_units=evidence.completed_units,
            previous_target=previous_target,
            target=target,
        )
        stages.append(
            RoadmapStage(
                id=identifier,
                label=title,
                order=order,
                status=status,
                progress=StageProgress(completed=stage_completed, total=stage_size),
            )
        )
        previous_target = target

    return RoadmapProjection(stages=tuple(stages))


def _stage_status(*, evidence_units: int, previous_target: int, target: int) -> StageStatus:
    if evidence_units >= target:
        return StageStatus.COMPLETED
    if evidence_units > previous_target:
        return StageStatus.IN_PROGRESS
    if evidence_units == previous_target:
        return StageStatus.AVAILABLE
    return StageStatus.LOCKED
