"""Build a deterministic downtown distribution tree from PostGIS buildings.

Run from ``backend`` with ``TIGERDATA_URL`` set:

    python scripts/build_grid.py

The script creates/rebuilds ``grid_nodes``, ``grid_edges`` and
``building_nodes`` in one transaction.  ``grid.json`` and the massing cache
are written only after the database transaction commits.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]
MASSING_PATH = ROOT / "frontend" / "public" / "data" / "toronto-massing.json"
GRID_PATH = ROOT / "frontend" / "public" / "data" / "grid.json"
TRANSFORMER_COUNT = 30
FEEDER_COUNT = 5
TIE_COUNT = 3
HEADROOM = 1.25
DOWNTOWN_BBOX = (-79.41, 43.63, -79.36, 43.66)

DDL = """
DROP TABLE IF EXISTS building_nodes;
DROP TABLE IF EXISTS grid_buildings;
DROP TABLE IF EXISTS grid_edges;
DROP TABLE IF EXISTS grid_nodes;
CREATE TABLE IF NOT EXISTS grid_nodes (
    node_id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL CHECK (node_type IN ('substation', 'feeder', 'transformer')),
    parent_id TEXT REFERENCES grid_nodes(node_id),
    x DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL,
    peak_kw DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS grid_edges (
    edge_id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES grid_nodes(node_id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES grid_nodes(node_id) ON DELETE CASCADE,
    is_tie BOOLEAN NOT NULL DEFAULT FALSE,
    normally_open BOOLEAN NOT NULL DEFAULT FALSE,
    rating_kw DOUBLE PRECISION NOT NULL CHECK (rating_kw >= 0)
);
CREATE TABLE building_nodes (
    building_id BIGINT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    transformer_id TEXT NOT NULL REFERENCES grid_nodes(node_id),
    peak_kw DOUBLE PRECISION NOT NULL CHECK (peak_kw >= 0)
);
"""


@dataclass(frozen=True)
class Building:
    building_id: int
    x: float
    z: float
    peak_kw: float


def database_url() -> str:
    raw = os.environ.get("TIGERDATA_URL", "") or dotenv_values(ROOT / "backend" / ".env").get(
        "TIGERDATA_URL", ""
    )
    if not raw:
        raise RuntimeError("TIGERDATA_URL is required")
    for scheme in ("postgresql://", "postgres://"):
        if raw.startswith(scheme):
            return "postgresql+psycopg://" + raw[len(scheme) :]
    return raw


def _bbox(session) -> tuple[float, float, float, float]:
    row = session.execute(
        text(
            """
            SELECT ST_XMin(extent), ST_YMin(extent), ST_XMax(extent), ST_YMax(extent)
            FROM (
                SELECT ST_3DExtent(geom) AS extent
                FROM buildings
                WHERE geom && ST_MakeEnvelope(:min_x, :min_y, :max_x, :max_y, 4326)
            ) b
            """
        ),
        dict(zip(("min_x", "min_y", "max_x", "max_y"), DOWNTOWN_BBOX)),
    ).one()
    if any(value is None for value in row):
        raise RuntimeError("buildings has no geometry")
    return tuple(float(value) for value in row)  # type: ignore[return-value]


def _read_buildings(session, bbox: tuple[float, float, float, float]) -> list[Building]:
    min_x, min_y, max_x, max_y = bbox
    rows = session.execute(
        text(
            """
            SELECT id,
                   ST_X(ST_Centroid(geom)) AS x,
                   ST_Y(ST_Centroid(geom)) AS y,
                   ST_Area(ST_Transform(ST_Force2D(geom), 26986)) AS area_m2,
                   COALESCE(levels, GREATEST(1, ROUND(COALESCE(height_m, 3.2) / 3.2))) AS floors
            FROM buildings
            WHERE geom && ST_MakeEnvelope(:min_x, :min_y, :max_x, :max_y, 4326)
            ORDER BY id
            """
        ),
        {"min_x": min_x, "min_y": min_y, "max_x": max_x, "max_y": max_y},
    ).mappings()
    buildings: list[Building] = []
    for row in rows:
        area = max(40.0, float(row["area_m2"] or 0.0))
        floors = max(1.0, float(row["floors"] or 1.0))
        peak_kw = area * floors * 48.0 / 1000.0
        buildings.append(
            Building(int(row["id"]), float(row["x"]), float(row["y"]), round(peak_kw, 3))
        )
    if not buildings:
        raise RuntimeError("downtown bbox contains no buildings")
    return buildings


def _local_points(buildings: list[Building], origin: tuple[float, float]) -> dict[int, tuple[float, float]]:
    lon0, lat0 = origin
    scale_x = math.cos(math.radians(lat0)) * 111_320.0
    return {
        b.building_id: ((b.x - lon0) * scale_x, -(b.z - lat0) * 110_540.0)
        for b in buildings
    }


def _write_massing_node_ids(path: Path, transformers: list[tuple[str, float, float]]) -> None:
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    for building in payload.get("buildings", []):
        rings = building.get("rings") or []
        if not rings:
            continue
        points = rings[0][:-1] if rings[0][0] == rings[0][-1] else rings[0]
        x = sum(float(point[0]) for point in points) / len(points)
        z = sum(float(point[1]) for point in points) / len(points)
        building["node_id"] = min(
            transformers, key=lambda item: (math.hypot(x - item[1], z - item[2]), item[0])
        )[0]
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def build(url: str, massing_path: Path = MASSING_PATH, grid_path: Path = GRID_PATH) -> None:
    engine = create_engine(url, pool_pre_ping=True)
    with engine.begin() as session:
        session.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        session.execute(text(DDL))
        session.execute(text("TRUNCATE building_nodes, grid_edges, grid_nodes"))
        bbox = _bbox(session)
        buildings = _read_buildings(session, bbox)
        # Keep the same local frame as the massing cache and the Three.js viewer.
        origin = (-79.3871, 43.6426)
        local = _local_points(buildings, origin)

        ordered_buildings = sorted(
            buildings, key=lambda b: (local[b.building_id][0], local[b.building_id][1], b.building_id)
        )
        chunk_size = math.ceil(len(ordered_buildings) / TRANSFORMER_COUNT)
        transformers = [
            (f"transformer-{i:02d}", ordered_buildings[start:start + chunk_size])
            for i, start in enumerate(range(0, len(ordered_buildings), chunk_size), 1)
        ]
        transformer_points = [
            (node_id, sum(local[b.building_id][0] for b in members) / len(members),
             sum(local[b.building_id][1] for b in members) / len(members))
            for node_id, members in transformers
        ]
        transformer_points.sort(key=lambda item: (item[1], item[2], item[0]))
        feeder_for: dict[str, str] = {}
        feeder_size = max(1, math.ceil(len(transformer_points) / FEEDER_COUNT))
        for index, (node_id, _, _) in enumerate(transformer_points):
            feeder_for[node_id] = f"feeder-{min(index // feeder_size + 1, FEEDER_COUNT):02d}"

        assignments: dict[int, str] = {}
        for node_id, members in transformers:
            for building in sorted(members, key=lambda item: item.building_id):
                assignments[building.building_id] = node_id

        subtree: dict[str, float] = {node_id: 0.0 for node_id, _ in transformers}
        for building in buildings:
            subtree[assignments[building.building_id]] += building.peak_kw
        feeder_load = {f"feeder-{i:02d}": 0.0 for i in range(1, FEEDER_COUNT + 1)}
        for node_id, load in subtree.items():
            feeder_load[feeder_for[node_id]] += load
        total = sum(feeder_load.values())
        feeder_centroid_x = sum(p[1] for p in transformer_points) / len(transformer_points)
        feeder_centroid_z = sum(p[2] for p in transformer_points) / len(transformer_points)
        nodes = [{"node_id": "substation-01", "node_type": "substation", "parent_id": None,
                  "x": feeder_centroid_x, "z": feeder_centroid_z, "peak_kw": total}]
        for feeder_id in sorted(feeder_load):
            points = [p for p in transformer_points if feeder_for[p[0]] == feeder_id]
            nodes.append({"node_id": feeder_id, "node_type": "feeder", "parent_id": "substation-01",
                          "x": sum(p[1] for p in points) / len(points) if points else 0.0,
                          "z": sum(p[2] for p in points) / len(points) if points else 0.0,
                          "peak_kw": feeder_load[feeder_id]})
        for node_id, x, z in transformer_points:
            nodes.append({"node_id": node_id, "node_type": "transformer",
                          "parent_id": feeder_for[node_id], "x": x, "z": z,
                          "peak_kw": subtree[node_id]})
        session.execute(
            text("INSERT INTO grid_nodes (node_id,node_type,parent_id,x,z,peak_kw) "
                 "VALUES (:node_id,:node_type,:parent_id,:x,:z,:peak_kw)"), nodes
        )
        edges: list[dict] = []
        for node in nodes:
            if node["parent_id"]:
                edges.append({"edge_id": f"{node['parent_id']}->{node['node_id']}",
                              "parent_id": node["parent_id"], "child_id": node["node_id"],
                              "is_tie": False, "normally_open": False,
                              "rating_kw": math.ceil(node["peak_kw"] * HEADROOM * 1000) / 1000})
        for i in range(1, TIE_COUNT + 1):
            left, right = f"feeder-{i:02d}", f"feeder-{i + 1:02d}"
            edges.append({"edge_id": f"tie-{i:02d}", "parent_id": left, "child_id": right,
                          "is_tie": True, "normally_open": True,
                          "rating_kw": math.ceil(max(feeder_load[left], feeder_load[right]) * HEADROOM * 1000) / 1000})
        session.execute(
            text("INSERT INTO grid_edges (edge_id,parent_id,child_id,is_tie,normally_open,rating_kw) "
                 "VALUES (:edge_id,:parent_id,:child_id,:is_tie,:normally_open,:rating_kw)"), edges
        )
        session.execute(
            text("INSERT INTO building_nodes (building_id,transformer_id,peak_kw) "
                 "VALUES (:building_id,:transformer_id,:peak_kw)"),
            [{"building_id": b.building_id, "transformer_id": assignments[b.building_id],
              "peak_kw": b.peak_kw}
             for b in sorted(buildings, key=lambda item: item.building_id)],
        )

    grid_path.parent.mkdir(parents=True, exist_ok=True)
    grid_path.write_text(json.dumps(
        {"metadata": {
             "topology": "radial",
             "note": "Radial model, not a replica of Toronto Hydro's real network; "
                     "the downtown core is actually a meshed secondary network."
         },
         "nodes": nodes,
         "edges": edges},
        separators=(",", ":"),
    ), encoding="utf-8")
    _write_massing_node_ids(massing_path, [(n["node_id"], n["x"], n["z"]) for n in nodes
                                            if n["node_type"] == "transformer"])
    print(f"Built {len(nodes)} infrastructure nodes, {len(edges)} edges, "
          f"{len(buildings)} building mappings")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=None, help="Postgres URL (defaults to TIGERDATA_URL)")
    parser.add_argument("--massing", type=Path, default=MASSING_PATH)
    parser.add_argument("--grid", type=Path, default=GRID_PATH)
    args = parser.parse_args()
    build(args.url or database_url(), args.massing, args.grid)


if __name__ == "__main__":
    main()
