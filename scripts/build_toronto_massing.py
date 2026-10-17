"""
Extract a downtown subset of City of Toronto 3D Massing (WGS84 shapefile)
into a compact JSON asset for the Three.js Explore City viewer.

Source: https://open.toronto.ca/dataset/3d-massing/
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import shapefile

ROOT = Path(__file__).resolve().parents[1]
SHP = ROOT / "tmp/massing/extracted/3DMassingShapefile_2025_WGS84"
OUT = ROOT / "frontend/public/data/toronto-massing.json"

# Downtown core — waterfront through financial / entertainment districts.
LAT_MIN, LAT_MAX = 43.63, 43.66
LON_MIN, LON_MAX = -79.41, -79.36
ORIGIN_LAT, ORIGIN_LON = 43.6426, -79.3871  # CN Tower plaza

R_MERC = 6378137.0
MAX_RING_POINTS = 20
MIN_HEIGHT_M = 2.5
# Pull footprints inward to reduce coplanar wall z-fighting.
INSET_M = 0.65
# Drop near-duplicate stacked footprints (keep tallest).
DEDUP_CELL_M = 6.0
# Massing has a fat 443 m block at the tower — replace with a landmark mesh.
CN_EXCLUDE_RADIUS_M = 45.0
CN_EXCLUDE_MIN_H = 200.0


def mercator_to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon = (x / R_MERC) * 180.0 / math.pi
    lat = (2.0 * math.atan(math.exp(y / R_MERC)) - math.pi / 2.0) * 180.0 / math.pi
    return lon, lat


def lonlat_to_local(lon: float, lat: float) -> tuple[float, float]:
    """Local metres: +X east, +Z south (Three.js Y-up)."""
    x = (lon - ORIGIN_LON) * math.cos(math.radians(ORIGIN_LAT)) * 111_320.0
    z = -(lat - ORIGIN_LAT) * 110_540.0
    return x, z


def simplify_ring(points: list[tuple[float, float]], max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    simplified = points[::step]
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def ring_area(points: list[tuple[float, float]]) -> float:
    a = 0.0
    for i in range(len(points) - 1):
        x1, z1 = points[i]
        x2, z2 = points[i + 1]
        a += x1 * z2 - x2 * z1
    return 0.5 * a


def ensure_ccw(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if ring_area(points) < 0:
        return list(reversed(points))
    return points


def inset_ring(points: list[tuple[float, float]], inset: float) -> list[tuple[float, float]]:
    """Shrink ring toward centroid; keeps simple massing shapes from sharing walls."""
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


def shape_rings(shape) -> list[list[tuple[float, float]]]:
    pts = shape.points
    parts = list(shape.parts) + [len(pts)]
    rings: list[list[tuple[float, float]]] = []
    for i in range(len(parts) - 1):
        chunk = pts[parts[i] : parts[i + 1]]
        local: list[tuple[float, float]] = []
        for x, y in chunk:
            lon, lat = mercator_to_lonlat(x, y)
            local.append(lonlat_to_local(lon, lat))
        if len(local) < 4:
            continue
        local = simplify_ring(local, MAX_RING_POINTS)
        local = ensure_ccw(local)
        local = inset_ring(local, INSET_M)
        rings.append(local)
    return rings


def centroid(rings: list[list[tuple[float, float]]]) -> tuple[float, float]:
    ring = rings[0]
    body = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in body) / len(body), sum(p[1] for p in body) / len(body)


def dedupe(buildings: list[dict]) -> list[dict]:
    """Keep the tallest footprint per coarse cell; drops stacked duplicate massing parts."""
    buildings = sorted(buildings, key=lambda b: -b["h"])
    kept: list[dict] = []
    occupied: set[tuple[int, int]] = set()
    for b in buildings:
        cx, cz = b["c"]
        cell = (int(math.floor(cx / DEDUP_CELL_M)), int(math.floor(cz / DEDUP_CELL_M)))
        # Also claim neighbours so near-identical footprints don't both survive.
        clash = False
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if (cell[0] + dx, cell[1] + dz) in occupied:
                    clash = True
                    break
            if clash:
                break
        if clash:
            continue
        occupied.add(cell)
        kept.append(b)
    return kept


def main() -> None:
    sf = shapefile.Reader(str(SHP))
    fields = [f[0] for f in sf.fields[1:]]
    buildings: list[dict] = []
    skipped_cn = 0

    for sr in sf.iterShapeRecords():
        rec = dict(zip(fields, list(sr.record)))
        lat = rec.get("LATITUDE")
        lon = rec.get("LONGITUDE")
        if lat is None or lon is None:
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue

        height = rec.get("AVG_HEIGHT") or rec.get("MAX_HEIGHT") or rec.get("MIN_HEIGHT") or 0
        try:
            height = float(height)
        except (TypeError, ValueError):
            height = 0.0
        if height < MIN_HEIGHT_M:
            height = MIN_HEIGHT_M

        rings = shape_rings(sr.shape)
        if not rings:
            continue

        cx, cz = centroid(rings)
        # Replace the official massing "CN Tower" brick with a landmark mesh in the viewer.
        if math.hypot(cx, cz) < CN_EXCLUDE_RADIUS_M and height >= CN_EXCLUDE_MIN_H:
            skipped_cn += 1
            continue

        min_h = rec.get("MIN_HEIGHT")
        max_h = rec.get("MAX_HEIGHT")
        try:
            min_h = float(min_h) if min_h is not None else None
        except (TypeError, ValueError):
            min_h = None
        try:
            max_h = float(max_h) if max_h is not None else None
        except (TypeError, ValueError):
            max_h = None
        # Toronto massing often leaves MIN/MAX at 0 when only AVG_HEIGHT is filled.
        if min_h is not None and min_h <= 0:
            min_h = None
        if max_h is not None and max_h <= 0:
            max_h = None

        floors = max(1, int(round(height / 3.2)))
        buildings.append(
            {
                "id": str(rec.get("OBJECTID") or rec.get("ID") or len(buildings)),
                "h": round(height, 2),
                "levels": floors,
                "floors_estimated": True,
                "min_h": round(min_h, 2) if min_h is not None else None,
                "max_h": round(max_h, 2) if max_h is not None else None,
                "avg_h": round(height, 2),
                "height_src": rec.get("HEIGHT_SRC") or None,
                "bldg_src": rec.get("BLDG_SRC") or None,
                "c": (round(cx, 2), round(cz, 2)),
                "rings": [[[round(x, 2), round(z, 2)] for x, z in ring] for ring in rings],
            }
        )

    before = len(buildings)
    buildings = dedupe(buildings)
    for b in buildings:
        b.pop("c", None)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "City of Toronto 3D Massing 2025 (Open Data)",
        "license": "Open Government Licence – Toronto",
        "url": "https://open.toronto.ca/dataset/3d-massing/",
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "bbox": {"latMin": LAT_MIN, "latMax": LAT_MAX, "lonMin": LON_MIN, "lonMax": LON_MAX},
        "landmarks": {"cnTower": {"x": 0, "z": 0, "height": 553}},
        "count": len(buildings),
        "buildings": buildings,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(
        f"Wrote {len(buildings)} buildings (from {before}, skipped CN massing={skipped_cn}) "
        f"-> {OUT} ({size_mb:.2f} MB)"
    )


if __name__ == "__main__":
    main()
