from fastapi import APIRouter

from app.schemas.models import Scenario
from app.sim.scenarios import list_scenarios

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


@router.get("", response_model=list[Scenario])
def read_scenarios() -> list[Scenario]:
    """Catalog for the What-if Lab picker."""
    return list_scenarios()
