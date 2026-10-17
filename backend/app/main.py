from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import buildings, dispatch, district, health, scenarios, simulation, weather
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="NightCity API",
    description="GridShift x WattWise - a simulated energy digital twin. "
                "All figures are simulated, not measured.",
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
    weather.router,
):
    app.include_router(router, prefix="/api")
