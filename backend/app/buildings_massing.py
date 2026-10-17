"""Convert TigerData building footprints into the Explore City massing payload."""

from __future__ import annotations

import json
import math
from typing import Any

# Keep in sync with scripts/build_toronto_massing.py
ORIGIN_LAT = 43.6426
ORIGIN_LON = -79.3871
LAT_MIN, LAT_MAX = 43.63, 43.66
LON_MIN, LON_MAX = -79.41, -79.36
MAX_RING_POINTS = 20
INSET_M = 0.65
MIN_HEIGHT_M = 2.5
TYPICAL_FLOOR_M = 3.2


def lonlat_to_local(lon: float, lat: float) -> tuple[float, float]:
    x = (lon - ORIGIN_LON) * math.cos(math.radians(ORIGIN_LAT)) * 111_320.0
    z = -(lat - ORIGIN_LAT) * 110_540.0
    return x, z


def _simplify_ring(points: list[tuple[float, float]], max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    simplified = points[::step]
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def _ring_area(points: list[tuple[float, float]]) -> float:
    a = 0.0
    for i in range(len(points) - 1):
        x1, z1 = points[i]
        x2, z2 = points[i + 1]
        a += x1 * z2 - x2 * z1
    return 0.5 * a


def _ensure_ccw(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if _ring_area(points) < 0:
        return list(reversed(points))
    return points


def _inset_ring(points: list[tuple[float, float]], inset: float) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points
    body = points[:-1] if points[0] == points[-1] else points
    cx = sum(p[0] for p in body) / len(body)
    cz = sum(p[1] for p in body) / len(body)
    out: list[tuple[float, float]] = []
    for x, z in body:
        dx, dz = x - cx, z - cz
        dist = math.hypot(dx, dz)
        if dist < 1e-3:
            out.append((x, z))
            continue
        scale = max(0.15, (dist - inset) / dist)
        out.append((cx + dx * scale, cz + dz * scale))
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else points


def geojson_to_local_rings(geojson: dict[str, Any]) -> list[list[list[float]]]:
    """GeoJSON Polygon/MultiPolygon (lon/lat) → local metre rings [x, z]."""
    geom_type = geojson.get("type")
    coords = geojson.get("coordinates")
    if not coords:
        return []

    polygons: list[Any]
    if geom_type == "Polygon":
        polygons = [coords]
    elif geom_type == "MultiPolygon":
        polygons = coords
    else:
        return []

    rings: list[list[list[float]]] = []
    for poly in polygons:
        for ring in poly:
            local: list[tuple[float, float]] = []
            for pair in ring:
                if len(pair) < 2:
                    continue
                local.append(lonlat_to_local(float(pair[0]), float(pair[1])))
            if len(local) < 4:
                continue
            local = _simplify_ring(local, MAX_RING_POINTS)
            local = _ensure_ccw(local)
            local = _inset_ring(local, INSET_M)
            rings.append([[round(x, 2), round(z, 2)] for x, z in local])
    return rings


def _lookup(props: dict[str, Any], *keys: str) -> Any:
    lowered = {k.lower(): k for k in props}
    for key in keys:
        real = key if key in props else lowered.get(key.lower())
        if real is None:
            continue
        value = props.get(real)
        if value is None or value == "":
            continue
        return value
    return None


def _num(props: dict[str, Any], *keys: str) -> float | None:
    raw = _lookup(props, *keys)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _str(props: dict[str, Any], *keys: str) -> str | None:
    raw = _lookup(props, *keys)
    return None if raw is None else str(raw)


def construction_from_row(
    *,
    height_m: float | None,
    levels: float | None,
    properties: dict[str, Any] | None,
) -> dict[str, Any]:
    props = properties or {}
    min_h = _num(props, "MIN_HEIGHT", "min_height")
    max_h = _num(props, "MAX_HEIGHT", "max_height")
    avg_h = _num(props, "AVG_HEIGHT", "avg_height", "height", "height_m")
    # Toronto massing often leaves MIN/MAX at 0 when only AVG_HEIGHT is filled.
    if min_h is not None and min_h <= 0:
        min_h = None
    if max_h is not None and max_h <= 0:
        max_h = None
    height = height_m if height_m is not None else avg_h or max_h or min_h
    if height is None or height < MIN_HEIGHT_M:
        height = MIN_HEIGHT_M

    level_count = levels
    if level_count is None:
        level_count = _num(props, "levels", "num_floors", "storeys", "stories")
    floors_estimated = level_count is None
    if level_count is None:
        level_count = max(1.0, round(height / TYPICAL_FLOOR_M))

    return {
        "h": round(float(height), 2),
        "levels": int(round(float(level_count))),
        "floors_estimated": floors_estimated,
        "min_h": round(min_h, 2) if min_h is not None else None,
        "max_h": round(max_h, 2) if max_h is not None else None,
        "avg_h": round(avg_h, 2) if avg_h is not None else None,
        "height_src": _str(props, "HEIGHT_SRC", "height_src"),
        "bldg_src": _str(props, "BLDG_SRC", "bldg_src"),
        "surf_elev": _num(props, "SURF_ELEV", "surf_elev"),
        "height_msl": _num(props, "HEIGHT_MSL", "height_msl"),
    }


def row_to_massing_building(row: dict[str, Any]) -> dict[str, Any] | None:
    props = row.get("properties") or {}
    if isinstance(props, str):
        props = json.loads(props)

    geojson = row.get("geojson")
    if isinstance(geojson, str):
        geojson = json.loads(geojson)
    if not isinstance(geojson, dict):
        return None

    rings = geojson_to_local_rings(geojson)
    if not rings:
        return None

    cons = construction_from_row(
        height_m=row.get("height_m"),
        levels=row.get("levels"),
        properties=props,
    )
    return {
        "id": row["id"],
        "h": cons["h"],
        "levels": cons["levels"],
        "floors_estimated": cons["floors_estimated"],
        "min_h": cons["min_h"],
        "max_h": cons["max_h"],
        "avg_h": cons["avg_h"],
        "height_src": cons["height_src"],
        "bldg_src": cons["bldg_src"],
        "rings": rings,
    }


def massing_envelope() -> dict[str, float]:
    return {
        "latMin": LAT_MIN,
        "latMax": LAT_MAX,
        "lonMin": LON_MIN,
        "lonMax": LON_MAX,
    }
