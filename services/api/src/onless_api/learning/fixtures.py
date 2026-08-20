"""Deterministic and visibly synthetic evidence used by the local demo route."""

from dataclasses import dataclass

from onless_api.learning.models import LearningEvidence, RoadmapPolicy

SYNTHETIC_POLICY = RoadmapPolicy(
    stage_ids=("foundation", "practice", "readiness"),
    stage_titles=("Foundation", "Guided practice", "Exam readiness"),
    cumulative_targets=(3, 7, 12),
)


@dataclass(frozen=True, slots=True)
class SyntheticEvidenceSource:
    """In-memory evidence source with no user, session, or external state."""

    completed_units: int = 5

    async def get_evidence(self) -> LearningEvidence:
        """Return the same validated aggregate on every invocation."""
        return LearningEvidence(completed_units=self.completed_units)
