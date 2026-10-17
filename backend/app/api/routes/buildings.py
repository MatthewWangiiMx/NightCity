from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("/{building_id}")
def read_building(building_id: str) -> dict[str, object]:
    """WattWise detail: loads, HVAC schedule, comfort bounds, anomalies."""
    raise HTTPException(status_code=501, detail="building model not implemented yet")
