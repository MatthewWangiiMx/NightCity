"""Import 3D building footprints into TigerData (PostGIS).

Drop your unzipped files into the `data/` folder next to this script, then:

    cd backend
    .\\.venv\\Scripts\\Activate.ps1
    python scripts/buildings/import_builds.py              # imports everything in data/
    python scripts/buildings/import_builds.py --replace    # wipe the table first
    python scripts/buildings/import_builds.py --dry-run    # inspect without writing

Reads: .shp (plus its sidecar .dbf/.shx/.prj), .geojson, .json, .gpkg.
Z coordinates are preserved when present, so true 3D geometry survives the trip.

Everything is reprojected to EPSG:4326 (lon/lat), which is what the map expects.
Re-importing the same file replaces that file's rows rather than duplicating them.
"""

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import shapely
from dotenv import dotenv_values
from shapely.geometry import MultiPolygon, Polygon
from sqlalchemy import create_engine, text

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "data"
BACKEND_DIR = SCRIPT_DIR.parent.parent
TARGET_SRID = 4326
TABLE = "buildings"

READABLE = {".shp", ".geojson", ".json", ".gpkg"}

# Column names seen in the wild for building height and storey count.
# Toronto 3D Massing uses AVG_HEIGHT / MAX_HEIGHT / MIN_HEIGHT (metres AGL).
# Do not treat HEIGHT_MSL / SURF_ELEV / elevation as building height.
HEIGHT_COLUMNS = (
    "avg_height", "max_height", "min_height",
    "height", "height_m", "heightroof", "roof_height", "bldg_height",
    "buildingheight", "mean_height", "maxheight", "hoehe", "h",
)
LEVEL_COLUMNS = (
    "levels", "building:levels", "num_floors", "numfloors", "floors",
    "storeys", "stories", "num_storeys",
)

DDL = f"""
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS {TABLE} (
    id           BIGSERIAL PRIMARY KEY,
    source_file  TEXT NOT NULL,
    source_id    TEXT,
    height_m     DOUBLE PRECISION,
    levels       DOUBLE PRECISION,
    properties   JSONB,
    -- Untyped `geometry`: real building extracts mix 2D footprints with 3D
    -- solids, and a typmod column rejects whichever one it was not declared for.
    geom         geometry NOT NULL,
    imported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relax the column if an earlier run created it with a 2D typmod.
ALTER TABLE {TABLE} ALTER COLUMN geom TYPE geometry USING geom;

CREATE INDEX IF NOT EXISTS {TABLE}_geom_idx ON {TABLE} USING GIST (geom);
CREATE INDEX IF NOT EXISTS {TABLE}_source_idx ON {TABLE} (source_file);
"""


def database_url() -> str | None:
    """TIGERDATA_URL from backend/.env, normalized for SQLAlchemy + psycopg2."""
    env = dotenv_values(BACKEND_DIR / ".env")
    url = (env.get("TIGERDATA_URL") or "").strip()
    if not url:
        return None
    for scheme in ("postgresql://", "postgres://"):
        if url.startswith(scheme):
            return "postgresql+psycopg2://" + url[len(scheme):]
    return url


def pick_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    lowered = {c.lower(): c for c in columns}
    for candidate in candidates:
        if candidate in lowered:
            return lowered[candidate]
    return None


def to_multipolygon(geom):
    """Normalize to MultiPolygon so one table holds one geometry shape."""
    if isinstance(geom, Polygon):
        return MultiPolygon([geom])
    return geom


def load_file(path: Path) -> gpd.GeoDataFrame:
    if path.suffix.lower() == ".json":
        # CityJSON and CityGML are not OGR-readable; catch them with a clear message.
        head = path.read_text(encoding="utf-8", errors="ignore")[:400]
        if '"CityJSON"' in head or '"type": "CityJSON"' in head:
            raise ValueError(
                f"{path.name} looks like CityJSON, which this script cannot read. "
                "Convert it first, e.g. `cjio input.city.json export --format gpkg out.gpkg`."
            )
    return gpd.read_file(path)


def prepare(gdf: gpd.GeoDataFrame, source_file: str, bbox: tuple[float, float, float, float] | None = None) -> list[dict]:
    """Normalize one file into insertable rows (geometry as EWKB hex).

    bbox is (lon_min, lat_min, lon_max, lat_max) in EPSG:4326 when provided.
    """
    gdf = gdf[~gdf.geometry.isna()].copy()
    if gdf.empty:
        return []

    if gdf.crs is None:
        print(f"  ! {source_file}: no CRS declared, assuming EPSG:{TARGET_SRID}")
        gdf = gdf.set_crs(epsg=TARGET_SRID)
    elif gdf.crs.to_epsg() != TARGET_SRID:
        print(f"  reprojecting {gdf.crs.to_string()} -> EPSG:{TARGET_SRID}")
        gdf = gdf.to_crs(epsg=TARGET_SRID)

    if bbox is not None:
        lon_min, lat_min, lon_max, lat_max = bbox
        gdf = gdf.cx[lon_min:lon_max, lat_min:lat_max].copy()
        print(f"  bbox filter -> {len(gdf)} features")
        if gdf.empty:
            return []

    attribute_columns = [c for c in gdf.columns if c != gdf.geometry.name]
    height_col = pick_column(attribute_columns, HEIGHT_COLUMNS)
    level_col = pick_column(attribute_columns, LEVEL_COLUMNS)
    id_col = pick_column(attribute_columns, ("id", "osm_id", "gml_id", "bin", "fid", "objectid"))
    print(f"  height: {height_col or '-'} | levels: {level_col or '-'} | id: {id_col or '-'}")

    heights = gpd.pd.to_numeric(gdf[height_col], errors="coerce") if height_col else None
    levels = gpd.pd.to_numeric(gdf[level_col], errors="coerce") if level_col else None

    def number(series, i):
        if series is None:
            return None
        value = series.iloc[i]
        return None if gpd.pd.isna(value) else float(value)

    rows = []
    for i, (_, feature) in enumerate(gdf.iterrows()):
        geom = to_multipolygon(feature[gdf.geometry.name])
        rows.append(
            {
                "source_file": source_file,
                "source_id": str(feature[id_col]) if id_col else None,
                "height_m": number(heights, i),
                "levels": number(levels, i),
                # Every original attribute is kept; nothing is dropped on import.
                "properties": json.dumps(
                    {k: feature[k] for k in attribute_columns}, default=str
                ),
                # EWKB hex carries the Z coordinate through unchanged.
                "geom": shapely.to_wkb(geom, hex=True, include_srid=False),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, help="files to import (default: data/*)")
    parser.add_argument("--replace", action="store_true", help="empty the table before importing")
    parser.add_argument("--dry-run", action="store_true", help="report what would be imported")
    parser.add_argument("--limit", type=int, help="import at most N features per file")
    parser.add_argument(
        "--bbox",
        type=str,
        help="lon_min,lat_min,lon_max,lat_max in EPSG:4326 (downtown default example: "
             "-79.41,43.63,-79.36,43.66)",
    )
    args = parser.parse_args()

    bbox = None
    if args.bbox:
        parts = [float(p.strip()) for p in args.bbox.split(",")]
        if len(parts) != 4:
            print("--bbox must be lon_min,lat_min,lon_max,lat_max")
            return 1
        bbox = (parts[0], parts[1], parts[2], parts[3])

    paths = args.paths or sorted(p for p in DATA_DIR.glob("**/*") if p.suffix.lower() in READABLE)
    # A .shp carries sidecars; reading the .shp alone picks them up.
    paths = [p for p in paths if p.suffix.lower() != ".dbf"]
    if not paths:
        print(f"No readable files found. Put unzipped data in: {DATA_DIR}")
        print(f"Supported: {', '.join(sorted(READABLE))}")
        return 1

    url = database_url()
    if url is None and not args.dry_run:
        print("TIGERDATA_URL missing from backend/.env")
        return 1

    engine = None if args.dry_run else create_engine(url, pool_pre_ping=True)
    if engine is not None:
        with engine.begin() as conn:
            conn.execute(text(DDL))
            if args.replace:
                conn.execute(text(f"TRUNCATE {TABLE} RESTART IDENTITY"))
                print(f"Emptied {TABLE}")

    total = 0
    for path in paths:
        print(f"\n{path.name}")
        try:
            gdf = load_file(path)
        except Exception as exc:  # noqa: BLE001 - report and continue to the next file
            print(f"  ! could not read: {exc}")
            continue

        if args.limit:
            gdf = gdf.head(args.limit)
        print(f"  {len(gdf)} features | geometry: {gdf.geom_type.unique().tolist()}")

        prepared = prepare(gdf, path.name, bbox=bbox)
        if not prepared:
            print("  ! no usable geometry, skipped")
            continue

        if args.dry_run:
            print(f"  would import {len(prepared)} rows")
            total += len(prepared)
            continue

        insert = text(
            f"INSERT INTO {TABLE} (source_file, source_id, height_m, levels, properties, geom) "
            "VALUES (:source_file, :source_id, :height_m, :levels, CAST(:properties AS JSONB), "
            f"       ST_SetSRID(ST_GeomFromWKB(decode(:geom, 'hex')), {TARGET_SRID}))"
        )
        with engine.begin() as conn:
            # Re-importing a file replaces its rows rather than duplicating them.
            conn.execute(text(f"DELETE FROM {TABLE} WHERE source_file = :f"), {"f": path.name})
            for start in range(0, len(prepared), 2000):
                conn.execute(insert, prepared[start : start + 2000])
        print(f"  imported {len(prepared)} rows")
        total += len(prepared)

    print(f"\n{'Would import' if args.dry_run else 'Imported'} {total} buildings in total.")
    if engine is not None:
        with engine.connect() as conn:
            count = conn.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar()
            print(f"{TABLE} now holds {count} rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
