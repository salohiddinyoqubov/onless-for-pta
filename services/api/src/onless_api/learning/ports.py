"""Capability-minimal boundaries for obtaining aggregate learning evidence."""

from typing import Protocol

from onless_api.learning.models import LearningEvidence


class EvidenceSource(Protocol):
    """Return identity-free aggregate evidence without exposing persistence."""

    async def get_evidence(self) -> LearningEvidence: ...
