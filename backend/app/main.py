from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    buildings,
    dispatch,
    district,
    ewrb,
    health,
    scenarios,
    simulation,
    weather,
)
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="NightCity API",
    description="GridShift x WattWise - an energy grid digital twin. "
                "Scenario, dispatch and time-series figures are simulated. "
                "The /api/ewrb endpoints serve annual intensities reported to "
                "Ontario's Energy and Water Reporting and Benchmarking programme; "
                "every payload states which of its fields are measured and which "
                "are derived.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    health.router,
    district.router,
    scenarios.router,
    simulation.router,
    dispatch.router,
    buildings.router,
    ewrb.router,
    weather.router,
):
    app.include_router(router, prefix="/api")
