from fastapi import APIRouter, HTTPException

from app.schemas.models import DispatchAction

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


@router.get("/{run_id}", response_model=list[DispatchAction])
def read_actions(run_id: str) -> list[DispatchAction]:
    """Actions with reason / constraint / assumption for Dispatch Review."""
    raise HTTPException(status_code=501, detail="optimizer not implemented yet")
