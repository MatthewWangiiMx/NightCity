"""Building footprints and construction attributes from TigerData."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from app.buildings_massing import (
    construction_from_row,
    massing_envelope,
    row_to_massing_building,
)
from app.db import repository

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("/massing")
def read_massing(
    lon_min: float | None = Query(None),
    lat_min: float | None = Query(None),
    lon_max: float | None = Query(None),
    lat_max: float | None = Query(None),
    limit: int = Query(50_000, ge=1, le=100_000),
) -> dict[str, object]:
    """Explore City payload built live from TigerData `buildings`."""
    env = massing_envelope()
    lon_min = lon_min if lon_min is not None else env["lonMin"]
    lat_min = lat_min if lat_min is not None else env["latMin"]
    lon_max = lon_max if lon_max is not None else env["lonMax"]
    lat_max = lat_max if lat_max is not None else env["latMax"]

    rows = repository.list_buildings_for_massing(
        lon_min=lon_min,
        lat_min=lat_min,
        lon_max=lon_max,
        lat_max=lat_max,
        limit=limit,
    )
    if not rows:
        raise HTTPException(
            status_code=503,
            detail=(
                "No buildings in TigerData for this bbox. "
                "Set USE_DATABASE=true and TIGERDATA_URL, then run "
                "scripts/buildings/import_builds.py on the Toronto 3D Massing shapefile."
            ),
        )

    buildings: list[dict] = []
    for row in rows:
        built = row_to_massing_building(row)
        if built:
            buildings.append(built)

    return {
        "source": "TigerData · City of Toronto 3D Massing",
        "license": "Open Government Licence – Toronto",
        "url": "https://open.toronto.ca/dataset/3d-massing/",
        "origin": {"lat": 43.6426, "lon": -79.3871},
        "bbox": {
            "latMin": lat_min,
            "latMax": lat_max,
            "lonMin": lon_min,
            "lonMax": lon_max,
        },
        "landmarks": {"cnTower": {"x": 0, "z": 0, "height": 553}},
        "count": len(buildings),
        "buildings": buildings,
    }


@router.get("/{building_id}")
def read_building(building_id: int) -> dict[str, object]:
    """Construction + footprint detail for one TigerData building."""
    row = repository.get_building(building_id)
    if row is None:
        count = repository.buildings_count()
        if count is None:
            raise HTTPException(
                status_code=503,
                detail="Database disabled; set USE_DATABASE=true and TIGERDATA_URL",
            )
        raise HTTPException(status_code=404, detail="Building not found")

    props = row.get("properties") or {}
    if isinstance(props, str):
        props = json.loads(props)

    cons = construction_from_row(
        height_m=row.get("height_m"),
        levels=row.get("levels"),
        properties=props,
    )
    return {
        "id": row["id"],
        "source_file": row.get("source_file"),
        "source_id": row.get("source_id"),
        "lon": row.get("lon"),
        "lat": row.get("lat"),
        "footprint_m2": round(float(row["footprint_m2"]), 1) if row.get("footprint_m2") else None,
        "construction": cons,
        "properties": props,
        "geojson": row.get("geojson"),
    }
