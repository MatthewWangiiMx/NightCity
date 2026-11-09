from fastapi import APIRouter

from app.db.session import get_engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "database": "tigerdata" if get_engine() is not None else "disabled",
        "simulated": True,
    }
