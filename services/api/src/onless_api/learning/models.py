"""Public data contract for the synthetic learning-roadmap demonstration."""

import re
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

StageIdentifier = Annotated[str, Field(min_length=1, max_length=64)]
StageTitle = Annotated[str, Field(min_length=1, max_length=100)]
CumulativeTarget = Annotated[int, Field(gt=0, le=1_000_000)]


class StageStatus(StrEnum):
    """Presentation state of a stage in the generic learning sequence."""

    LOCKED = "locked"
    AVAILABLE = "available"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class LearningEvidence(BaseModel):
    """Aggregate, identity-free evidence accepted by the pure projector."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    completed_units: int = Field(ge=0, le=1_000_000)


class RoadmapPolicy(BaseModel):
    """Generic cumulative stage targets used by the demonstration.

    The tuples are parallel by design: this keeps the public input compact while
    validation guarantees that projection never encounters an incomplete stage
    definition. Targets are cumulative, positive, and strictly increasing.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    stage_ids: tuple[StageIdentifier, ...] = Field(min_length=1, max_length=12)
    stage_titles: tuple[StageTitle, ...] = Field(min_length=1, max_length=12)
    cumulative_targets: tuple[CumulativeTarget, ...] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_parallel_stages(self) -> Self:
        """Reject ambiguous identifiers, labels, and target progressions."""
        size = len(self.stage_ids)
        if len(self.stage_titles) != size or len(self.cumulative_targets) != size:
            raise ValueError("stage policy fields must have the same length")

        normalized_ids = tuple(identifier.strip() for identifier in self.stage_ids)
        normalized_titles = tuple(title.strip() for title in self.stage_titles)
        if any(not identifier for identifier in normalized_ids):
            raise ValueError("stage identifiers must not be blank")
        if any(not title for title in normalized_titles):
            raise ValueError("stage titles must not be blank")
        if len(set(normalized_ids)) != size:
            raise ValueError("stage identifiers must be unique")
        if normalized_ids != self.stage_ids or normalized_titles != self.stage_titles:
            raise ValueError("stage identifiers and titles must not contain edge whitespace")
        if any(
            re.fullmatch(r"[a-z][a-z0-9-]*", identifier) is None for identifier in self.stage_ids
        ):
            raise ValueError("stage identifiers must use lowercase kebab-case")

        previous = 0
        for target in self.cumulative_targets:
            if target <= previous:
                raise ValueError("cumulative targets must be strictly increasing positive integers")
            previous = target
        return self


class StageProgress(BaseModel):
    """Bounded progress within one public roadmap stage."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    completed: int = Field(ge=0)
    total: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_completed_range(self) -> Self:
        if self.completed > self.total:
            raise ValueError("completed progress cannot exceed total progress")
        return self


class RoadmapStage(BaseModel):
    """One fully projected stage ready for JSON serialization."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
    )

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9-]*$")
    label: str = Field(min_length=1, max_length=100)
    order: int = Field(ge=0, le=11)
    status: StageStatus
    progress: StageProgress


class RoadmapProjection(BaseModel):
    """Stable JSON boundary shared with the independent web showcase."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
    )

    stages: tuple[RoadmapStage, ...] = Field(min_length=1, max_length=12)
