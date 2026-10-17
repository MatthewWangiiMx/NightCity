"""Manual import of telemetry into TigerData.

Usage (from backend/, with the venv active):

    python scripts/import_telemetry.py data/readings.csv --district nightcity --run import-2026-10-16

CSV columns (header required; anything missing is stored as NULL):

    t,demand_mw,solar_mw,wind_mw,battery_mw,battery_soc,grid_import_mw,indoor_temp_c
    2026-10-16T18:00:00Z,612,48,53,0,0.8,511,22.1

`t` is an ISO 8601 timestamp. Re-running with the same --run replaces that
run's rows, so an import is safe to repeat.
"""

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from app.db.session import get_engine

NUMERIC = (
    "demand_mw",
    "solar_mw",
    "wind_mw",
    "battery_mw",
    "battery_soc",
    "grid_import_mw",
    "indoor_temp_c",
)


def parse_rows(path: Path, district_id: str, run_id: str, variant: str) -> list[dict]:
    rows = []
    with path.open(newline="", encoding="utf-8") as handle:
        for line in csv.DictReader(handle):
            row = {
                "t": datetime.fromisoformat(line["t"].replace("Z", "+00:00")),
                "run_id": run_id,
                "district_id": district_id,
                "asset_id": line.get("asset_id") or None,
                "variant": variant,
            }
            for column in NUMERIC:
                value = (line.get(column) or "").strip()
                row[column] = float(value) if value else None
            rows.append(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--district", default="nightcity")
    parser.add_argument("--run", required=True, help="run id these readings belong to")
    parser.add_argument("--variant", default="optimized", choices=["baseline", "optimized"])
    args = parser.parse_args()

    engine = get_engine()
    if engine is None:
        print("Database is off. Set USE_DATABASE=true and TIGERDATA_URL in backend/.env")
        return 1

    rows = parse_rows(args.csv_path, args.district, args.run, args.variant)
    if not rows:
        print("No rows found in", args.csv_path)
        return 1

    columns = ("t", "run_id", "district_id", "asset_id", "variant", *NUMERIC)
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM telemetry WHERE run_id = :run_id AND variant = :variant"),
            {"run_id": args.run, "variant": args.variant},
        )
        conn.execute(
            text(
                f"INSERT INTO telemetry ({', '.join(columns)}) "
                f"VALUES ({', '.join(':' + c for c in columns)})"
            ),
            rows,
        )

    print(f"Imported {len(rows)} rows into telemetry (run={args.run}, variant={args.variant})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
