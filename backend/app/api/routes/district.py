from fastapi import APIRouter

from app.schemas.models import District
from app.sim.district import get_district

router = APIRouter(prefix="/district", tags=["district"])


@router.get("/{district_id}", response_model=District)
def read_district(district_id: str) -> District:
    """Assets and map positions for the isometric scene."""
    return get_district(district_id)
