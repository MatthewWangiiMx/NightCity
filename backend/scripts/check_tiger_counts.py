"""Print TigerData row counts (no secrets)."""

from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(".env", override=True)

from app.config import get_settings

get_settings.cache_clear()

from app.db.session import get_engine
from app.db.repository import load_live_run

eng = get_engine()
assert eng is not None

with eng.connect() as conn:
    for table in ("buildings", "weather_observations", "telemetry", "runs"):
        n = conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()
        print(f"{table}: {n}")

result = load_live_run("nightcity")
if result is None:
    print("LIVE_RUN: none")
else:
    print(
        "LIVE_RUN:",
        result.source,
        "steps",
        len(result.baseline),
        "weather",
        len(result.weather),
        "assets",
        len(result.district.assets),
        "demand0",
        result.baseline[0].demand_mw if result.baseline else None,
    )
