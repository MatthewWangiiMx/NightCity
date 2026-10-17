from fastapi import APIRouter

from app.config import get_settings
from app.db.session import get_engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "database": "tigerdata" if get_engine() is not None else "disabled",
        "llm": "enabled" if settings.enable_llm else "disabled",
        "simulated": True,
    }
