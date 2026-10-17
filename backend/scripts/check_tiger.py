"""Quick TigerData connectivity check (no secrets printed)."""

from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(".env", override=True)

from app.config import get_settings

get_settings.cache_clear()

from app.db.session import get_engine

eng = get_engine()
print("USE_DATABASE", get_settings().use_database)
print("ENGINE", "ok" if eng else "None")
if eng is None:
    raise SystemExit(1)

with eng.connect() as conn:
    version = conn.execute(text("SELECT version()")).scalar()
    print("CONNECTED", str(version)[:80])
    exts = conn.execute(
        text(
            "SELECT extname FROM pg_extension "
            "WHERE extname IN ('timescaledb', 'postgis') ORDER BY 1"
        )
    ).fetchall()
    print("EXTENSIONS", [r[0] for r in exts])
    tables = conn.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
    ).fetchall()
    print("TABLES", [r[0] for r in tables])
