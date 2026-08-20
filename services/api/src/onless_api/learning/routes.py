"""Local, inputless HTTP presentation of the synthetic roadmap projection."""

from typing import Annotated

from fastapi import APIRouter, Depends

from onless_api.learning.fixtures import SYNTHETIC_POLICY, SyntheticEvidenceSource
from onless_api.learning.models import RoadmapProjection
from onless_api.learning.ports import EvidenceSource
from onless_api.learning.projection import project_roadmap

router = APIRouter(prefix="/demo", tags=["demo"])


def get_evidence_source() -> EvidenceSource:
    """Construct the deterministic local source at the composition boundary."""
    return SyntheticEvidenceSource()


@router.get("/learning-roadmap", response_model=RoadmapProjection)
async def get_learning_roadmap(
    source: Annotated[EvidenceSource, Depends(get_evidence_source)],
) -> RoadmapProjection:
    """Return an identity-free roadmap derived entirely from demo evidence."""
    evidence = await source.get_evidence()
    return project_roadmap(evidence, SYNTHETIC_POLICY)
