"""Apply the SQL migrations in app/db/migrations to TIGERDATA_URL.

Run from ``backend``:

    python scripts/apply_migrations.py --dry-run   # list what would run
    python scripts/apply_migrations.py             # apply all, in order
    python scripts/apply_migrations.py 004 005     # apply only these

There is no psql in this project's toolchain, and the managed service is
PostgreSQL 18, so a matching client is not a given either. This runner needs
nothing but the backend venv.

Files run in filename order, each in its own transaction, so a failure leaves
the earlier ones applied and names the one that broke.

Two things worth knowing before running the whole set against a database that
already has data:

* ``003_grid.sql`` DROPs ``building_nodes``, ``grid_edges`` and ``grid_nodes``
  before recreating them. On a fresh service that is a no-op; on a live one it
  discards the generated grid, which ``scripts/build_grid.py`` then has to
  rebuild. Everything else is ``IF NOT EXISTS`` or ``ON CONFLICT`` and is safe
  to repeat.
* ``004_structures.sql`` and ``006_structure_eui_key.sql`` ALTER ``buildings``,
  which no migration creates -- ``scripts/buildings/import_builds.py`` does.
  Import first, or run those two after. Both only add columns, and
  ``scripts/cluster_structures.py`` is what fills them.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "app" / "db" / "migrations"
# Recreates the grid from scratch; see the module docstring.
DESTRUCTIVE = {"003_grid.sql"}


def database_url() -> str:
    url = (
        dotenv_values(".env").get("TIGERDATA_URL")
        or os.environ.get("TIGERDATA_URL")
        or ""
    ).strip()
    if not url:
        raise SystemExit("TIGERDATA_URL is not set (backend/.env or environment)")
    for scheme in ("postgresql://", "postgres://"):
        if url.startswith(scheme):
            return "postgresql+psycopg://" + url[len(scheme):]
    return url


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("only", nargs="*",
                    help="apply only migrations whose filename contains one of these")
    ap.add_argument("--dry-run", action="store_true",
                    help="list the migrations and confirm the connection, writing nothing")
    args = ap.parse_args()

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if args.only:
        files = [f for f in files if any(k in f.name for k in args.only)]
    if not files:
        raise SystemExit(f"no migrations matched in {MIGRATIONS_DIR}")

    url = database_url()
    engine = create_engine(url, pool_pre_ping=True)

    with engine.connect() as conn:
        host = conn.execute(text("SELECT inet_server_addr()::text")).scalar()
        db = conn.execute(text("SELECT current_database()")).scalar()
        ver = conn.execute(text("SHOW server_version")).scalar()
    print(f"target: {db} on {host or 'managed host'}  (PostgreSQL {ver})")

    if args.dry_run:
        print("\n--dry-run, nothing written. Would apply, in order:")
        for f in files:
            flag = "  [DROPS the grid tables]" if f.name in DESTRUCTIVE else ""
            print(f"  {f.name}{flag}")
        return 0

    print()
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.commit()
        for f in files:
            sql = f.read_text(encoding="utf-8")
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                print(f"  FAILED  {f.name}")
                print(f"          {type(exc).__name__}: {str(exc).splitlines()[0]}")
                print("\nStopped. Earlier migrations are applied; fix this one and re-run.")
                return 1
            print(f"  applied {f.name}")

    print("\nall migrations applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
