import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AmbientLight,
  BufferGeometry,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  estimateBuildingElectricity,
  type BuildingElectricity,
} from '@/components/map/buildingElectricity';
import { createFuturisticSign } from '@/components/map/futuristicSign';
import {
  matchLandmarksToBuildings,
  type MatchedLandmark,
} from '@/components/map/torontoLandmarks';

const MASSING_CACHE_URL = '/data/toronto-massing.json';
const MASSING_API_URL = '/api/buildings/massing';
const GRID_URL = '/data/grid.json';
const BUILDING_LINK_RADIUS_M = 250;

/** Only keep structures tall enough to be occupied / electrified buildings. */
const MIN_ELECTRIC_HEIGHT_M = 10;
const MIN_FOOTPRINT_AREA_M2 = 40;
const FLOOR_H = 3.6;
const WIN_W = 1.5;
const WIN_H = 1.85;
const WIN_D = 0.22;
const WIN_GAP_X = 1.1;
const WIN_LIT_CHANCE = 0.5;
const SIGN_VISIBLE_M = 1100;

export type CityViewMode = 'preview' | 'zoom' | 'explore' | 'backdrop';

const PREVIEW_LOOK = new Vector3(40, 90, -80);
/** Fixed cinematic frame for Plan / static backdrops (no orbit). */
const BACKDROP_POS = new Vector3(620, 280, 720);
const EXPLORE_POS = new Vector3(80, 140, 520);
const EXPLORE_LOOK = new Vector3(0, 180, 0);
const ZOOM_MS = 1600;
const SEARCH_FLY_MS = 1400;

type SearchTarget = {
  id: string;
  name: string;
  short?: string;
  kind: string;
  x: number;
  z: number;
  h: number;
  /** World Y of the floating nameplate (fly-to look target). */
  plateY: number;
  footprint_m2: number;
};

const MOVE = {
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  sprint: false,
};

type KeyAction = keyof typeof MOVE;

const KEY_MAP: Record<string, KeyAction> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'up',
  KeyC: 'down',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

type MassingBuilding = {
  id?: number | string;
  node_id?: string;
  h: number;
  levels?: number;
  floors_estimated?: boolean;
  min_h?: number | null;
  max_h?: number | null;
  avg_h?: number | null;
  height_src?: string | null;
  bldg_src?: string | null;
  rings: [number, number][][];
};

type GridNode = {
  node_id: string;
  node_type: 'substation' | 'feeder' | 'transformer';
  x: number;
  z: number;
};

type GridEdge = {
  parent_id: string;
  child_id: string;
  is_tie: boolean;
  normally_open: boolean;
};

type GridData = { nodes: GridNode[]; edges: GridEdge[] };

async function loadGrid(): Promise<GridData | null> {
  try {
    const res = await fetch(GRID_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as GridData;
    return data.nodes?.length && data.edges ? data : null;
  } catch {
    return null;
  }
}

function buildGridMesh(data: GridData, buildings: MassingBuilding[]): Group {
  const group = new Group();
  group.name = 'distribution-grid';
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const lineMaterial = new LineBasicMaterial({
    color: '#22d3ee',
    transparent: true,
    opacity: 0.65,
    depthTest: false,
  });
  const tieMaterial = new LineBasicMaterial({
    color: '#fbbf24',
    transparent: true,
    opacity: 0.75,
    depthTest: false,
  });
  for (const edge of data.edges) {
    const parent = byId.get(edge.parent_id);
    const child = byId.get(edge.child_id);
    if (!parent || !child) continue;
    const geometry = new BufferGeometry().setFromPoints([
      new Vector3(parent.x, 3, parent.z),
      new Vector3(child.x, 3, child.z),
    ]);
    group.add(new Line(geometry, edge.normally_open ? tieMaterial : lineMaterial));
  }
  for (const node of data.nodes) {
    const color =
      node.node_type === 'substation'
        ? '#fbbf24'
        : node.node_type === 'feeder'
          ? '#a78bfa'
          : '#22d3ee';
    const radius = node.node_type === 'substation' ? 18 : node.node_type === 'feeder' ? 12 : 7;
    const puck = new Mesh(
      new SphereGeometry(radius, 16, 10),
      new MeshBasicMaterial({ color, depthTest: false }),
    );
    puck.renderOrder = 20;
    puck.position.set(node.x, 12, node.z);
    group.add(puck);
  }
  const buildingLinkPoints: Vector3[] = [];
  for (const building of buildings) {
    if (!building.node_id || !building.rings[0]?.length) continue;
    const transformer = byId.get(building.node_id);
    if (!transformer || transformer.node_type !== 'transformer') continue;
    const center = ringCentroid(building.rings[0]);
    if (Math.hypot(center.x - transformer.x, center.z - transformer.z) > BUILDING_LINK_RADIUS_M) {
      continue;
    }
    buildingLinkPoints.push(
      new Vector3(transformer.x, 7, transformer.z),
      new Vector3(center.x, 5, center.z),
    );
  }
  if (buildingLinkPoints.length) {
    const buildingLinks = new LineSegments(
      new BufferGeometry().setFromPoints(buildingLinkPoints),
      new LineBasicMaterial({
        color: '#67e8f9',
        transparent: true,
        opacity: 0.18,
        depthTest: false,
      }),
    );
    buildingLinks.renderOrder = 19;
    group.add(buildingLinks);
  }
  return group;
}

type MassingData = {
  source: string;
  license: string;
  url: string;
  count: number;
  landmarks?: { cnTower?: { x: number; z: number; height: number } };
  buildings: MassingBuilding[];
};

async function loadMassingData(): Promise<{ data: MassingData; fromTiger: boolean }> {
  try {
    const res = await fetch(MASSING_API_URL);
    if (res.ok) {
      const data = (await res.json()) as MassingData;
      if (data.buildings?.length) return { data, fromTiger: true };
    }
  } catch {
    // Fall back to the static cache when TigerData is offline.
  }
  const res = await fetch(MASSING_CACHE_URL);
  if (!res.ok) throw new Error(`Failed to fetch massing data (${res.status})`);
  const data = (await res.json()) as MassingData;
  return { data, fromTiger: false };
}

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ringArea(ring: [number, number][]) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a * 0.5);
}

function ringCentroid(ring: [number, number][]) {
  const body =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  let x = 0;
  let z = 0;
  for (const p of body) {
    x += p[0];
    z += p[1];
  }
  return { x: x / body.length, z: z / body.length };
}

function isElectrifiedBuilding(b: MassingBuilding) {
  const outer = b.rings[0];
  if (!outer || outer.length < 4) return false;
  if (b.h < MIN_ELECTRIC_HEIGHT_M) return false;
  if (ringArea(outer) < MIN_FOOTPRINT_AREA_M2) return false;
  return true;
}

function makeShape(outer: [number, number][], holes: [number, number][][], inset = 0) {
  const shape = new Shape();
  const { x: cx, z: cz } = ringCentroid(outer);
  const pt = (x: number, z: number): [number, number] => {
    if (inset <= 0) return [x, -z];
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz) || 1;
    const s = Math.max(0.2, (d - inset) / d);
    return [cx + dx * s, -(cz + dz * s)];
  };

  const p0 = pt(outer[0][0], outer[0][1]);
  shape.moveTo(p0[0], p0[1]);
  for (let i = 1; i < outer.length; i++) {
    const p = pt(outer[i][0], outer[i][1]);
    shape.lineTo(p[0], p[1]);
  }
  shape.closePath();

  for (const holePts of holes) {
    if (holePts.length < 4) continue;
    const hole = new Shape();
    const h0 = pt(holePts[0][0], holePts[0][1]);
    hole.moveTo(h0[0], h0[1]);
    for (let i = 1; i < holePts.length; i++) {
      const p = pt(holePts[i][0], holePts[i][1]);
      hole.lineTo(p[0], p[1]);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

function extrudeUp(shape: Shape, height: number, y0 = 0.02) {
  const geo = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return geo;
}

function forEachWindow(
  buildings: MassingBuilding[],
  visit: (lit: boolean, mat: Matrix4) => void,
) {
  const _pos = new Vector3();
  const _quat = new Quaternion();
  const _scale = new Vector3(1, 1, 1);
  const _mat = new Matrix4();
  const _yAxis = new Vector3(0, 1, 0);
  let seed = 1;

  for (const building of buildings) {
    if (!isElectrifiedBuilding(building)) continue;
    const outer = building.rings[0];
    const height = building.h;
    const { x: cx, z: cz } = ringCentroid(outer);
    const floors = Math.max(1, Math.floor((height - 2.5) / FLOOR_H));
    const floorStep = height > 120 ? 2 : 1;
    const body =
      outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1]
        ? outer.slice(0, -1)
        : outer;

    for (let e = 0; e < body.length; e++) {
      const x1 = body[e][0];
      const z1 = body[e][1];
      const x2 = body[(e + 1) % body.length][0];
      const z2 = body[(e + 1) % body.length][1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < WIN_W + WIN_GAP_X) continue;

      let nx = -dz / len;
      let nz = dx / len;
      const midX = (x1 + x2) * 0.5;
      const midZ = (z1 + z2) * 0.5;
      if (
        (midX + nx - cx) ** 2 + (midZ + nz - cz) ** 2 <
        (midX - nx - cx) ** 2 + (midZ - nz - cz) ** 2
      ) {
        nx = -nx;
        nz = -nz;
      }

      _quat.setFromAxisAngle(_yAxis, Math.atan2(nx, nz));
      const cols = Math.max(1, Math.floor((len - WIN_GAP_X) / (WIN_W + WIN_GAP_X)));
      const span = cols * WIN_W + (cols - 1) * WIN_GAP_X;
      const start = (len - span) * 0.5 + WIN_W * 0.5;

      for (let floor = 0; floor < floors; floor += floorStep) {
        const y = 1.5 + floor * FLOOR_H + WIN_H * 0.5;
        if (y + WIN_H * 0.5 > height - 0.8) continue;

        for (let col = 0; col < cols; col++) {
          seed += 1;
          const t = (start + col * (WIN_W + WIN_GAP_X)) / len;
          _pos.set(x1 + dx * t + nx * 0.25, y, z1 + dz * t + nz * 0.25);
          _mat.compose(_pos, _quat, _scale);
          visit(hash01(seed) < WIN_LIT_CHANCE, _mat);
        }
      }
    }
  }
}

function mergeChunks(geos: ExtrudeGeometry[], material: Material, group: Group) {
  const chunk = 700;
  for (let i = 0; i < geos.length; i += chunk) {
    const slice = geos.slice(i, i + chunk);
    const merged = mergeGeometries(slice, false);
    slice.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeVertexNormals();
    group.add(new Mesh(merged, material));
  }
}

/** Same top height the extruded mesh uses (avg/max + optional black crown). */
function buildingVisualTop(building: MassingBuilding): { buildH: number; crownH: number } {
  const h = building.h;
  const buildH = building.max_h != null && building.max_h > h ? building.max_h : h;
  const crownH = buildH >= 90 ? Math.min(28, buildH * 0.14) : 0;
  return { buildH, crownH };
}

/** World Y of the landmark nameplate — keep in sync with sign placement. */
function landmarkNameplateY(
  match: MatchedLandmark,
  building?: MassingBuilding,
): number {
  if (match.landmark.id === 'cn-tower') return 570;
  if (match.landmark.id === 'rogers-centre') return match.h + 28;
  const visual = building ? buildingVisualTop(building) : null;
  const roofY = visual?.buildH ?? match.h;
  const hasCrown = (visual?.crownH ?? 0) > 0;
  return roofY + (hasCrown ? 16 : 22);
}

function addLandmarkExtras(match: MatchedLandmark, group: Group, roofY?: number) {
  const accent = new MeshBasicMaterial({ color: '#67e8f9' });
  const shell = new MeshStandardMaterial({
    color: '#0c1520',
    roughness: 0.85,
    metalness: 0.18,
  });
  const roof = roofY ?? match.h;

  // Rooftop HUD ring — Rogers sits higher so the stand clears the bowl roof.
  const ringY = match.landmark.id === 'rogers-centre' ? match.h + 8 : roof + 2.5;
  const ring = new Mesh(new CylinderGeometry(8, 8, 0.6, 24, 1, true), accent);
  ring.position.set(match.x, ringY, match.z);
  group.add(ring);

  // Corner beacons
  const beaconY = match.landmark.id === 'rogers-centre' ? match.h + 6.5 : roof + 1.2;
  for (const [dx, dz] of [
    [6, 6],
    [-6, 6],
    [6, -6],
    [-6, -6],
  ] as const) {
    const beacon = new Mesh(new BoxGeometry(1.2, 2.4, 1.2), accent);
    beacon.position.set(match.x + dx, beaconY, match.z + dz);
    group.add(beacon);
  }

  // Kind-specific silhouette cues
  if (match.landmark.kind === 'stadium' || match.landmark.kind === 'arena') {
    const bowl = new Mesh(new CylinderGeometry(28, 34, 6, 28, 1, true), shell);
    bowl.position.set(match.x, Math.min(18, match.h * 0.35), match.z);
    group.add(bowl);
    const lip = new Mesh(new CylinderGeometry(30, 30, 1.2, 28, 1, true), accent);
    lip.position.set(match.x, Math.min(22, match.h * 0.4), match.z);
    group.add(lip);
  }

  if (match.landmark.kind === 'hotel' || match.landmark.kind === 'tower') {
    const spire = new Mesh(new CylinderGeometry(0.5, 1.4, 16, 8), accent);
    spire.position.set(match.x, roof + 10, match.z);
    group.add(spire);
  }
}

export type BuildingPick = {
  buildingIndex: number;
  buildingId?: number | string;
  name: string;
  kind: string;
  h: number;
  footprint_m2: number;
  x: number;
  z: number;
  levels?: number;
  floors_estimated?: boolean;
  min_h?: number | null;
  max_h?: number | null;
  avg_h?: number | null;
  height_src?: string | null;
  bldg_src?: string | null;
  data_source: 'tigerdata' | 'massing-cache';
};

function ringBBox(ring: [number, number][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    w: Math.max(4, maxX - minX),
    d: Math.max(4, maxZ - minZ),
  };
}

function buildCityMesh(
  buildings: MassingBuilding[],
  matches: MatchedLandmark[],
  dataSource: BuildingPick['data_source'] = 'massing-cache',
  opts?: { showLabels?: boolean },
): { group: Group; signs: Sprite[]; hitTargets: Group } {
  const showLabels = opts?.showLabels !== false;
  const group = new Group();
  const signs: Sprite[] = [];
  const hitTargets = new Group();
  hitTargets.name = 'hitTargets';

  const landmarkByIndex = new Map(
    matches.filter((m) => m.buildingIndex >= 0).map((m) => [m.buildingIndex, m]),
  );
  const landmarkIndex = new Set(landmarkByIndex.keys());

  const shellMat = new MeshStandardMaterial({
    color: '#0a0e14',
    roughness: 0.92,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const landmarkShellMat = new MeshStandardMaterial({
    color: '#0d1824',
    roughness: 0.82,
    metalness: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const crownMat = new MeshStandardMaterial({
    color: '#101c28',
    roughness: 0.8,
    metalness: 0.22,
  });
  const accentMat = new MeshBasicMaterial({ color: '#5eead4' });

  const shellGeos: ExtrudeGeometry[] = [];
  const landmarkGeos: ExtrudeGeometry[] = [];
  const crownGeos: ExtrudeGeometry[] = [];
  const accentGeos: ExtrudeGeometry[] = [];

  const hitMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  buildings.forEach((building, index) => {
    if (!isElectrifiedBuilding(building)) return;
    const outer = building.rings[0];
    const holes = building.rings.slice(1);
    const h = building.h;
    const isLandmark = landmarkIndex.has(index);
    const match = landmarkByIndex.get(index);
    const bbox = ringBBox(outer);

    // Prefer MAX_HEIGHT from TigerData / massing when it exceeds AVG_HEIGHT.
    const buildH = building.max_h != null && building.max_h > h ? building.max_h : h;
    const crownH = buildH >= 90 ? Math.min(28, buildH * 0.14) : 0;
    const shaftH = buildH - crownH;
    const shape = makeShape(outer, holes);
    const shaft = extrudeUp(shape, shaftH);
    (isLandmark ? landmarkGeos : shellGeos).push(shaft);

    if (crownH > 0) {
      const crownShape = makeShape(outer, holes, 3.2);
      crownGeos.push(extrudeUp(crownShape, crownH, shaftH + 0.05));

      // Thin neon crown band
      const bandShape = makeShape(outer, holes, 1.2);
      const band = extrudeUp(bandShape, 1.1, shaftH - 0.2);
      accentGeos.push(band);
    }

    // Mid-tower mechanical belt on very tall buildings
    if (buildH >= 160) {
      const beltY = buildH * 0.55;
      const belt = extrudeUp(makeShape(outer, holes, 0.8), 2.2, beltY);
      accentGeos.push(belt);
    }

    // Invisible click proxy (raycastable)
    const hit = new Mesh(new BoxGeometry(bbox.w, buildH, bbox.d), hitMat);
    hit.position.set(bbox.cx, buildH / 2, bbox.cz);
    hit.userData.pick = {
      buildingIndex: index,
      buildingId: building.id,
      name: match?.landmark.short ?? match?.landmark.name ?? `Building · ${Math.round(h)}m`,
      kind: match?.landmark.kind ?? (h >= 80 ? 'office' : 'structure'),
      h,
      footprint_m2: match?.footprint_m2 ?? ringArea(outer),
      x: bbox.cx,
      z: bbox.cz,
      levels: building.levels,
      floors_estimated: building.floors_estimated,
      min_h: building.min_h,
      max_h: building.max_h,
      avg_h: building.avg_h ?? h,
      height_src: building.height_src,
      bldg_src: building.bldg_src,
      data_source: dataSource,
    } satisfies BuildingPick;
    hitTargets.add(hit);
  });

  mergeChunks(shellGeos, shellMat, group);
  mergeChunks(landmarkGeos, landmarkShellMat, group);
  mergeChunks(crownGeos, crownMat, group);
  mergeChunks(accentGeos, accentMat, group);

  // Windows
  let litTotal = 0;
  let dimTotal = 0;
  forEachWindow(buildings, (lit) => {
    if (lit) litTotal += 1;
    else dimTotal += 1;
  });

  const winGeo = new BoxGeometry(WIN_W, WIN_H, WIN_D);
  const litMesh =
    litTotal > 0
      ? new InstancedMesh(winGeo, new MeshBasicMaterial({ color: '#c8efff' }), litTotal)
      : null;
  const dimMesh =
    dimTotal > 0
      ? new InstancedMesh(winGeo, new MeshBasicMaterial({ color: '#15202b' }), dimTotal)
      : null;

  let litI = 0;
  let dimI = 0;
  forEachWindow(buildings, (lit, mat) => {
    if (lit) litMesh?.setMatrixAt(litI++, mat);
    else dimMesh?.setMatrixAt(dimI++, mat);
  });
  if (litMesh) {
    litMesh.instanceMatrix.needsUpdate = true;
    group.add(litMesh);
  }
  if (dimMesh) {
    dimMesh.instanceMatrix.needsUpdate = true;
    group.add(dimMesh);
  }

  // Named landmarks only — massing/TigerData rows have no building names.
  // Backdrop / silent modes skip plates and HUD rings (buildings + windows only).
  if (showLabels) {
    for (const match of matches) {
      const building =
        match.buildingIndex >= 0 ? buildings[match.buildingIndex] : undefined;
      const visual = building ? buildingVisualTop(building) : null;
      // Sit on the true mesh top (including black crown), not avg-height mid-roof.
      const roofY = visual?.buildH ?? match.h;
      const hasCrown = (visual?.crownH ?? 0) > 0;

      if (match.landmark.id !== 'cn-tower') addLandmarkExtras(match, group, roofY);
      else {
        const cnHit = new Mesh(new CylinderGeometry(18, 22, 553, 12), hitMat);
        cnHit.position.set(match.x, 276, match.z);
        cnHit.userData.pick = {
          buildingIndex: -1,
          name: 'CN Tower',
          kind: 'landmark',
          h: 553,
          footprint_m2: match.footprint_m2,
          x: match.x,
          z: match.z,
          levels: 147,
          floors_estimated: true,
          avg_h: 553,
          max_h: 553,
          min_h: null,
          height_src: 'Landmark reference',
          bldg_src: 'CN Tower',
          data_source: dataSource,
        } satisfies BuildingPick;
        hitTargets.add(cnHit);
      }

      const label = match.landmark.short ?? match.landmark.name;
      const kind = (match.landmark.kind ?? 'structure').toUpperCase();
      const sign = createFuturisticSign(label, kind);
      const sx = match.x;
      const sz = match.z;
      const lift = landmarkNameplateY(match, building);

      // Rogers Centre: centre of the roof, plate forced visible above the stand.
      if (match.landmark.id === 'rogers-centre') {
        const mat = sign.material as SpriteMaterial;
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.fog = false;
        mat.needsUpdate = true;
        sign.renderOrder = 20;
        const base = sign.userData.baseScale as { x: number; y: number };
        sign.scale.set(base.x * 1.35, base.y * 1.35, 1);
        sign.userData.baseScale = { x: base.x * 1.35, y: base.y * 1.35 };
      }

      // Crowned towers: keep the plate above the black cap in the middle.
      if (hasCrown && match.landmark.id !== 'cn-tower') {
        const mat = sign.material as SpriteMaterial;
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.needsUpdate = true;
        sign.renderOrder = 15;
      }

      sign.position.set(sx, lift, sz);
      sign.userData.anchor = { x: sx, y: lift, z: sz };
      group.add(sign);
      signs.push(sign);
    }
  }

  group.add(hitTargets);

  const ground = new Mesh(
    new PlaneGeometry(8000, 8000),
    new MeshStandardMaterial({ color: '#05070c', roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  return { group, signs, hitTargets };
}

function buildCnTower(x = 0, z = 0): Group {
  const g = new Group();
  g.position.set(x, 0, z);

  const shell = new MeshStandardMaterial({
    color: '#101820',
    roughness: 0.72,
    metalness: 0.35,
    emissive: '#0a2a38',
    emissiveIntensity: 0.35,
  });
  const glow = new MeshBasicMaterial({ color: '#67e8f9' });
  const warm = new MeshBasicMaterial({ color: '#fde68a' });
  const litGlass = new MeshBasicMaterial({
    color: '#7dd3fc',
    transparent: true,
    opacity: 0.55,
  });

  // Concrete base + Y-legs
  const base = new Mesh(new CylinderGeometry(26, 32, 16, 24), shell);
  base.position.y = 8;
  g.add(base);

  const legs = new Mesh(new CylinderGeometry(9, 20, 50, 18), shell);
  legs.position.y = 41;
  g.add(legs);

  // Continuous main shaft (no gaps) up into the pods
  const shaft = new Mesh(new CylinderGeometry(5.2, 8, 290, 20), shell);
  shaft.position.y = 211;
  g.add(shaft);

  // Climbing light bands along the shaft
  for (let i = 0; i < 14; i++) {
    const y = 90 + i * 18;
    const band = new Mesh(new CylinderGeometry(6.2, 6.6, 1.1, 16), glow);
    band.position.y = y;
    g.add(band);
  }

  // Main pod (SkyPod) — lit glass ring + neon lip
  const mainPod = new Mesh(new CylinderGeometry(18, 22, 14, 28), shell);
  mainPod.position.y = 352;
  g.add(mainPod);
  const mainGlass = new Mesh(new CylinderGeometry(19.5, 21, 8, 28, 1, true), litGlass);
  mainGlass.position.y = 352;
  g.add(mainGlass);
  const mainRing = new Mesh(new CylinderGeometry(22.5, 22.5, 1.4, 28), glow);
  mainRing.position.y = 359;
  g.add(mainRing);
  const mainRingLo = new Mesh(new CylinderGeometry(22.5, 22.5, 1.4, 28), glow);
  mainRingLo.position.y = 345;
  g.add(mainRingLo);

  // Neck between pods (this was the broken empty middle)
  const neck = new Mesh(new CylinderGeometry(4.2, 5.2, 22, 16), shell);
  neck.position.y = 370;
  g.add(neck);
  const neckGlow = new Mesh(new CylinderGeometry(4.6, 5.5, 1.2, 16), glow);
  neckGlow.position.y = 370;
  g.add(neckGlow);

  // Upper pod
  const upperPod = new Mesh(new CylinderGeometry(10, 12, 9, 24), shell);
  upperPod.position.y = 386;
  g.add(upperPod);
  const upperGlass = new Mesh(new CylinderGeometry(11, 12.2, 5, 24, 1, true), litGlass);
  upperGlass.position.y = 386;
  g.add(upperGlass);
  const upperRing = new Mesh(new CylinderGeometry(12.6, 12.6, 1.2, 24), glow);
  upperRing.position.y = 391;
  g.add(upperRing);

  // Antenna / needle — continuous from upper pod
  const needleBase = new Mesh(new CylinderGeometry(2.6, 4, 18, 12), shell);
  needleBase.position.y = 400;
  g.add(needleBase);

  const needle = new Mesh(new CylinderGeometry(0.55, 2.4, 145, 12), shell);
  needle.position.y = 481;
  g.add(needle);

  for (let i = 0; i < 8; i++) {
    const y = 420 + i * 16;
    const r = 2.1 - i * 0.18;
    const ring = new Mesh(new CylinderGeometry(r, r, 0.9, 12), glow);
    ring.position.y = y;
    g.add(ring);
  }

  const tip = new Mesh(new SphereGeometry(2.2, 12, 12), warm);
  tip.position.y = 554;
  g.add(tip);
  const tipHalo = new Mesh(new SphereGeometry(3.4, 12, 12), new MeshBasicMaterial({
    color: '#fde68a',
    transparent: true,
    opacity: 0.35,
  }));
  tipHalo.position.y = 554;
  g.add(tipHalo);

  return g;
}

/**
 * Downtown Toronto from official 3D Massing — dark shells, discrete windows,
 * named landmarks with futuristic signs.
 */
function ElectricityPanel({
  data,
  onClose,
}: {
  data: BuildingElectricity;
  onClose: () => void;
}) {
  const statusColor =
    data.status === 'elevated' ? 'text-nc-alert' : data.status === 'flexible' ? 'text-nc-flex' : 'text-nc-renew';

  return (
    <div className="pointer-events-auto absolute right-4 top-20 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-cyan-400/40 bg-[#061018]/92 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">Grid node</div>
          <h2 className="mt-1 text-lg font-semibold leading-tight text-nc-text">{data.name}</h2>
              <div className="mt-1 text-xs capitalize text-nc-muted">
            {data.kind} · {data.floors} floors
            {data.construction.floors_estimated ? ' (est.)' : ''} · {data.height_m} m
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-nc-border px-2 py-1 text-[11px] text-nc-muted hover:border-nc-renew hover:text-nc-text"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Metric label="Height" value={`${(data.construction.avg_h ?? data.height_m).toLocaleString()} m`} accent />
        <Metric label="Footprint" value={`${data.footprint_m2.toLocaleString()} m²`} />
        <Metric
          label="Levels"
          value={`${data.floors}${data.construction.floors_estimated ? ' est.' : ''}`}
        />
        <Metric label="Demand now" value={`${data.demand_kw.toLocaleString()} kW`} />
        <Metric label="Peak load" value={`${data.peak_kw.toLocaleString()} kW`} />
        <Metric label="Daily energy" value={`${data.daily_kwh.toLocaleString()} kWh`} />
        <Metric label="Annual" value={`${data.annual_mwh.toLocaleString()} MWh`} />
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-[11px]">
        <div className="flex justify-between gap-3">
          <span className="text-nc-muted">Height source</span>
          <span className="text-right text-nc-text">{data.construction.height_src ?? '—'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-nc-muted">Building source</span>
          <span className="text-right text-nc-text">{data.construction.bldg_src ?? '—'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-nc-muted">Data</span>
          <span className="text-right text-cyan-200/90">
            {data.construction.data_source === 'tigerdata' ? 'TigerData' : 'Massing cache'}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-nc-muted">
          <span>Load mix</span>
          <span className={statusColor}>{data.status}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-nc-panel-2">
          <div className="bg-sky-400" style={{ width: `${data.hvac_share_pct}%` }} title="HVAC" />
          <div className="bg-cyan-200" style={{ width: `${data.lighting_share_pct}%` }} title="Lighting" />
          <div className="bg-teal-500/80" style={{ width: `${data.plug_share_pct}%` }} title="Plug loads" />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-nc-muted">
          <span>HVAC {data.hvac_share_pct}%</span>
          <span>Lights {data.lighting_share_pct}%</span>
          <span>Plugs {data.plug_share_pct}%</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-xs">
        <span className="text-nc-muted">Renewable offset</span>
        <span className="font-semibold text-nc-renew">{data.renewable_offset_pct}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-xs">
        <span className="text-nc-muted">EV chargers on site</span>
        <span className="font-semibold text-nc-grid">{data.ev_chargers}</span>
      </div>

      <p className="mt-3 text-[10px] leading-snug text-nc-muted/80">
        Heights and footprint from City of Toronto 3D Massing via{' '}
        {data.construction.data_source === 'tigerdata' ? 'TigerData' : 'local cache'}. Electricity
        load mix is simulated, not metered utility data.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-nc-border/70 bg-nc-panel/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-nc-muted">{label}</div>
      <div className={`mt-0.5 tabular-nums ${accent ? 'text-cyan-300' : 'text-nc-text'}`}>{value}</div>
    </div>
  );
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function BuildingSearch({
  targets,
  onSelect,
  onActivate,
}: {
  targets: SearchTarget[];
  onSelect: (target: SearchTarget) => void;
  onActivate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const results =
    q.length < 1
      ? []
      : targets
          .filter((t) => {
            const name = t.name.toLowerCase();
            const short = (t.short ?? '').toLowerCase();
            return name.includes(q) || short.includes(q) || t.id.includes(q);
          })
          .slice(0, 8);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (target: SearchTarget) => {
    setQuery(target.short ?? target.name);
    setOpen(false);
    onSelect(target);
  };

  return (
    <div ref={rootRef} className="pointer-events-auto relative w-[min(20rem,calc(100vw-1.5rem))]">
      <label className="sr-only" htmlFor="building-search">
        Search buildings
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-cyan-400/35 bg-[#061018]/90 px-3 py-2 shadow-lg shadow-cyan-500/10 backdrop-blur-md">
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0 text-cyan-300/80"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          id="building-search"
          type="search"
          autoComplete="off"
          placeholder="Search buildings…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            onActivate?.();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const hit = results[active] ?? results[0];
              if (hit) choose(hit);
            } else if (e.key === 'Escape') {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-nc-text outline-none placeholder:text-nc-muted/70"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute bottom-[calc(100%+0.4rem)] left-0 right-0 max-h-64 overflow-auto rounded-xl border border-cyan-400/30 bg-[#061018]/95 py-1 shadow-xl backdrop-blur-md">
          {results.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(t)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-cyan-400/15 text-cyan-100' : 'text-nc-text hover:bg-white/5'
                }`}
              >
                <span className="truncate font-medium">{t.short ?? t.name}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-nc-muted">
                  {t.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q.length > 0 && results.length === 0 && (
        <div className="absolute bottom-[calc(100%+0.4rem)] left-0 right-0 rounded-xl border border-nc-border/70 bg-[#061018]/95 px-3 py-2 text-xs text-nc-muted backdrop-blur-md">
          No buildings match “{query.trim()}”
        </div>
      )}
    </div>
  );
}

export default function TorontoCityViewer({
  mode = 'explore',
  onZoomComplete,
}: {
  mode?: CityViewMode;
  onZoomComplete?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<CityViewMode>(mode);
  const onZoomCompleteRef = useRef(onZoomComplete);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('Loading Toronto 3D Massing…');
  const [error, setError] = useState<string | null>(null);
  const [credit, setCredit] = useState('City of Toronto Open Data · 3D Massing');
  const [labeled, setLabeled] = useState(0);
  const [electricity, setElectricity] = useState<BuildingElectricity | null>(null);
  const [cityReady, setCityReady] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [searchTargets, setSearchTargets] = useState<SearchTarget[]>([]);
  const gridRef = useRef<Group | null>(null);
  const gridVisibleRef = useRef(gridVisible);
  const selectRef = useRef<(pick: BuildingPick | null) => void>(() => {});
  const flyToRef = useRef<(target: SearchTarget) => void>(() => {});
  const unlockFlyRef = useRef<() => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    gridVisibleRef.current = gridVisible;
  }, [gridVisible]);

  useEffect(() => {
    onZoomCompleteRef.current = onZoomComplete;
  }, [onZoomComplete]);

  useEffect(() => {
    selectRef.current = (pick) => {
      if (!pick) {
        setElectricity(null);
        return;
      }
      setElectricity(
        estimateBuildingElectricity({
          id: pick.buildingId != null ? `tiger-${pick.buildingId}` : `b-${pick.buildingIndex}`,
          name: pick.name,
          kind: pick.kind,
          height_m: pick.h,
          footprint_m2: pick.footprint_m2,
          seed: pick.buildingIndex * 17 + Math.round(pick.h),
          floors: pick.levels,
          floors_estimated: pick.floors_estimated,
          min_h: pick.min_h,
          max_h: pick.max_h,
          avg_h: pick.avg_h,
          height_src: pick.height_src,
          bldg_src: pick.bldg_src,
          data_source: pick.data_source,
        }),
      );
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let controls: PointerLockControls | null = null;
    let renderer: WebGLRenderer | null = null;
    let city: Group | null = null;
    let hitTargets: Group | null = null;
    let signs: Sprite[] = [];
    let highlight: Mesh | null = null;

    let zoomActive = false;
    let zoomStart = 0;
    let zoomFromPos = new Vector3();
    let zoomFromLook = new Vector3();
    let lastMode: CityViewMode = modeRef.current;

    let searchFly: {
      fromPos: Vector3;
      fromLook: Vector3;
      toPos: Vector3;
      toLook: Vector3;
      start: number;
    } | null = null;

    const scene = new Scene();
    scene.background = new Color('#02060d');
    scene.fog = new Fog('#02060d', 500, 2600);

    const camera = new PerspectiveCamera(68, 1, 0.8, 5000);
    // Start in cinematic preview / backdrop framing (farther / higher).
    camera.position.copy(BACKDROP_POS);
    camera.lookAt(PREVIEW_LOOK);

    renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    renderer.setClearColor(0x02060d);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    mount.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0x6b7c8f, 0.22));
    scene.add(new HemisphereLight(0x1e293b, 0x020617, 0.4));
    const key = new DirectionalLight(0x94a3b8, 0.28);
    key.position.set(-180, 320, 120);
    scene.add(key);

    controls = new PointerLockControls(camera, renderer.domElement);
    const onLock = () => setLocked(true);
    const onUnlock = () => setLocked(false);
    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);

    const velocity = new Vector3();
    const direction = new Vector3();
    const raycaster = new Raycaster();
    const pointer = new Vector2(0, 0); // center reticle while locked
    let prevTime = performance.now();
    let ready = false;

    const setKey = (code: string, down: boolean) => {
      const action = KEY_MAP[code];
      if (action) MOVE[action] = down;
    };
    const typingInField = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return;
      if (typingInField()) return;
      if (e.code === 'KeyF' && controls?.isLocked) {
        // Inspect whatever is under the reticle
        pickAtCenter();
        return;
      }
      setKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (typingInField()) return;
      setKey(e.code, false);
    };

    const showHighlight = (pick: BuildingPick) => {
      if (highlight) {
        scene.remove(highlight);
        highlight.geometry.dispose();
        (highlight.material as MeshBasicMaterial).dispose();
        highlight = null;
      }
      const box = new Mesh(
        new BoxGeometry(Math.max(12, Math.sqrt(pick.footprint_m2) * 0.9), pick.h + 4, Math.max(12, Math.sqrt(pick.footprint_m2) * 0.9)),
        new MeshBasicMaterial({
          color: '#22d3ee',
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      box.position.set(pick.x, pick.h / 2, pick.z);
      highlight = box;
      scene.add(box);
    };

    const pickAtCenter = () => {
      if (!hitTargets || !ready) return;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(hitTargets.children, false);
      if (!hits.length) {
        selectRef.current(null);
        if (highlight) {
          scene.remove(highlight);
          highlight.geometry.dispose();
          (highlight.material as MeshBasicMaterial).dispose();
          highlight = null;
        }
        return;
      }
      const pick = hits[0].object.userData.pick as BuildingPick | undefined;
      if (!pick) return;
      selectRef.current(pick);
      showHighlight(pick);
    };

    const onClick = () => {
      if (!ready || !controls) return;
      if (modeRef.current !== 'explore') return;
      if (typingInField()) return;
      if (!controls.isLocked) {
        controls.lock();
        return;
      }
      // While flying: click = inspect building under crosshair
      pickAtCenter();
    };

    unlockFlyRef.current = () => {
      if (controls?.isLocked) controls.unlock();
      Object.keys(MOVE).forEach((k) => {
        MOVE[k as KeyAction] = false;
      });
    };

    flyToRef.current = (target: SearchTarget) => {
      if (!ready || modeRef.current !== 'explore') return;
      unlockFlyRef.current();
      zoomActive = false;

      // Frame on the floating nameplate, not the old blue roof ring.
      const plateY = target.plateY;
      const lookY = Math.max(18, plateY);
      const dist = Math.max(36, Math.min(95, target.h * 0.22 + 42));
      const toPos = new Vector3(
        target.x + dist * 0.65,
        Math.max(28, plateY + dist * 0.18),
        target.z + dist * 0.78,
      );
      const toLook = new Vector3(target.x, lookY, target.z);
      searchFly = {
        fromPos: camera.position.clone(),
        fromLook: camera.getWorldDirection(new Vector3()).multiplyScalar(280).add(camera.position),
        toPos,
        toLook,
        start: performance.now(),
      };

      const pick: BuildingPick = {
        buildingIndex: -2,
        name: target.short ?? target.name,
        kind: target.kind,
        h: target.h,
        footprint_m2: target.footprint_m2,
        x: target.x,
        z: target.z,
        data_source: 'massing-cache',
      };
      selectRef.current(pick);
      showHighlight(pick);
    };

    const beginZoom = () => {
      if (zoomActive) return;
      zoomActive = true;
      zoomStart = performance.now();
      zoomFromPos = camera.position.clone();
      // Approximate look target from current orientation
      zoomFromLook = camera.getWorldDirection(new Vector3()).multiplyScalar(400).add(camera.position);
      if (controls?.isLocked) controls.unlock();
    };

    const resize = () => {
      if (!renderer) return;
      const { clientWidth: w, clientHeight: h } = mount;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('click', onClick);

    const tick = () => {
      if (disposed || !renderer || !controls) return;
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      const delta = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      const viewMode = modeRef.current;

      if (viewMode === 'zoom' && lastMode !== 'zoom') beginZoom();
      lastMode = viewMode;

      if (gridRef.current) {
        const inCity = viewMode === 'explore' || viewMode === 'zoom';
        gridRef.current.visible = inCity && gridVisibleRef.current;
      }

      if (viewMode !== 'explore' && controls.isLocked) controls.unlock();

      if (searchFly && viewMode === 'explore') {
        const u = Math.min(1, (now - searchFly.start) / SEARCH_FLY_MS);
        const e = easeInOutCubic(u);
        camera.position.lerpVectors(searchFly.fromPos, searchFly.toPos, e);
        const look = new Vector3().lerpVectors(searchFly.fromLook, searchFly.toLook, e);
        camera.lookAt(look);
        if (u >= 1) searchFly = null;
      } else if (viewMode === 'backdrop' && ready) {
        camera.position.copy(BACKDROP_POS);
        camera.lookAt(PREVIEW_LOOK);
      } else if (viewMode === 'preview' && ready && !zoomActive) {
        const t = now * 0.00012;
        const radius = 780;
        camera.position.set(
          Math.cos(t) * radius,
          250 + Math.sin(t * 0.65) * 40,
          Math.sin(t) * radius * 0.85 + 180,
        );
        camera.lookAt(PREVIEW_LOOK);
      } else if (zoomActive) {
        const u = Math.min(1, (now - zoomStart) / ZOOM_MS);
        const e = easeInOutCubic(u);
        camera.position.lerpVectors(zoomFromPos, EXPLORE_POS, e);
        const look = new Vector3().lerpVectors(zoomFromLook, EXPLORE_LOOK, e);
        camera.lookAt(look);
        // Subtle FOV punch for “dive in” feel
        camera.fov = 68 - e * 8;
        camera.updateProjectionMatrix();
        if (u >= 1) {
          zoomActive = false;
          camera.fov = 68;
          camera.updateProjectionMatrix();
          camera.position.copy(EXPLORE_POS);
          camera.lookAt(EXPLORE_LOOK);
          onZoomCompleteRef.current?.();
        }
      } else if (viewMode === 'explore' && controls.isLocked && !searchFly) {
        const base = MOVE.sprint ? 180 : 70;
        const accel = base * 8;

        velocity.x -= velocity.x * 8 * delta;
        velocity.z -= velocity.z * 8 * delta;
        velocity.y -= velocity.y * 8 * delta;

        direction.z = Number(MOVE.forward) - Number(MOVE.back);
        direction.x = Number(MOVE.right) - Number(MOVE.left);
        direction.y = Number(MOVE.up) - Number(MOVE.down);
        if (direction.lengthSq() > 0) direction.normalize();

        velocity.z -= direction.z * accel * delta;
        velocity.x -= direction.x * accel * delta;
        velocity.y += direction.y * accel * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        camera.position.y += velocity.y * delta;

        if (camera.position.y < 6) {
          camera.position.y = 6;
          velocity.y = Math.max(0, velocity.y);
        }
      }

      // Distance-scale futuristic signs so names stay readable in flight.
      const showSigns = viewMode === 'explore' || viewMode === 'zoom';
      for (const sign of signs) {
        if (!showSigns) {
          sign.visible = false;
          continue;
        }
        const anchor = sign.userData.anchor as { x: number; y: number; z: number };
        const dist = camera.position.distanceTo(sign.position);
        const maxVisible = (sign.userData.maxVisible as number | undefined) ?? SIGN_VISIBLE_M;
        const visible = dist < maxVisible;
        sign.visible = visible;
        if (!visible) continue;
        const base = sign.userData.baseScale as { x: number; y: number };
        const s = Math.min(2.8, Math.max(0.85, dist / 280));
        sign.scale.set(base.x * s, base.y * s, 1);
        sign.position.y = anchor.y + Math.sin(now * 0.0015 + anchor.x * 0.01) * 1.2;
      }

      renderer.render(scene, camera);
    };

    tick();

    (async () => {
      try {
        const isBackdrop = modeRef.current === 'backdrop';
        // Home preview pans without the distribution grid; Explore / Plan-backdrop
        // decide separately (backdrop never loads it).
        const [{ data, fromTiger }, gridData] = await Promise.all([
          loadMassingData(),
          isBackdrop ? Promise.resolve(null) : loadGrid(),
        ]);
        if (disposed) return;

        const electric = data.buildings.filter(isElectrifiedBuilding);
        if (!isBackdrop) {
          setStatus(`Labeling Toronto landmarks across ${electric.length.toLocaleString()} buildings…`);
        }
        setCredit(
          fromTiger
            ? `TigerData · ${data.license}`
            : `${data.source} · ${data.license}`,
        );

        await new Promise((r) => setTimeout(r, 30));
        if (disposed) return;

        const matches = matchLandmarksToBuildings(electric);
        const built = buildCityMesh(
          electric,
          matches,
          fromTiger ? 'tigerdata' : 'massing-cache',
          { showLabels: !isBackdrop },
        );
        city = built.group;
        signs = built.signs;
        hitTargets = built.hitTargets;

        const cn = data.landmarks?.cnTower;
        city.add(buildCnTower(cn?.x ?? 0, cn?.z ?? 0));
        scene.add(city);
        if (gridData) {
          const mesh = buildGridMesh(gridData, electric);
          // Hidden on home cinematic pan; Explore respects the Power Grid toggle.
          const inCity =
            modeRef.current === 'explore' || modeRef.current === 'zoom';
          mesh.visible = inCity && gridVisibleRef.current;
          gridRef.current = mesh;
          scene.add(mesh);
        }
        setLabeled(isBackdrop ? 0 : matches.length);
        if (!isBackdrop) {
          setSearchTargets(
            matches.map((m) => {
              const building =
                m.buildingIndex >= 0 ? electric[m.buildingIndex] : undefined;
              return {
                id: m.landmark.id,
                name: m.landmark.name,
                short: m.landmark.short,
                kind: m.landmark.kind ?? 'structure',
                x: m.x,
                z: m.z,
                h: m.h,
                plateY: landmarkNameplateY(m, building),
                footprint_m2: m.footprint_m2,
              };
            }),
          );
        }
        ready = true;
        setCityReady(true);
        setStatus('');

        // If we landed directly on explore, snap to explore framing.
        if (modeRef.current === 'explore') {
          camera.position.copy(EXPLORE_POS);
          camera.lookAt(EXPLORE_LOOK);
        } else if (modeRef.current === 'backdrop') {
          camera.position.copy(BACKDROP_POS);
          camera.lookAt(PREVIEW_LOOK);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Could not load Toronto 3D Massing data.');
          setStatus('');
        }
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer?.domElement.removeEventListener('click', onClick);
      controls?.removeEventListener('lock', onLock);
      controls?.removeEventListener('unlock', onUnlock);
      controls?.dispose();
      if (highlight) {
        scene.remove(highlight);
        highlight.geometry.dispose();
        (highlight.material as MeshBasicMaterial).dispose();
      }
      if (city) {
        city.traverse((obj) => {
          if (obj instanceof Mesh || obj instanceof InstancedMesh) {
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if ('map' in m && m.map) m.map.dispose();
              m.dispose();
            });
          }
          if (obj instanceof Sprite) {
            obj.material.map?.dispose();
            obj.material.dispose();
          }
        });
        scene.remove(city);
      }
      if (gridRef.current) {
        gridRef.current.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        });
        scene.remove(gridRef.current);
        gridRef.current = null;
      }
      renderer?.dispose();
      if (renderer?.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      Object.keys(MOVE).forEach((k) => {
        MOVE[k as KeyAction] = false;
      });
    };
  }, []);

  useEffect(() => {
    if (!gridRef.current) return;
    const inCity = mode === 'explore' || mode === 'zoom';
    gridRef.current.visible = inCity && gridVisible;
  }, [gridVisible, mode]);

  const exploreUi = mode === 'explore';
  const backdropUi = mode === 'backdrop';

  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden bg-nc-bg">
      <div
        ref={mountRef}
        className={`absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${backdropUi ? 'pointer-events-none' : ''}`}
      />

      {exploreUi && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4">
          <div className="pointer-events-auto">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="rounded-md border border-nc-border/80 bg-nc-panel/80 px-3 py-1.5 text-sm backdrop-blur-md transition hover:border-nc-renew"
              >
                ← NightCity
              </Link>
              <button
                type="button"
                role="switch"
                aria-checked={gridVisible}
                aria-label="Toggle grid"
                onClick={() => setGridVisible((visible) => !visible)}
                className="flex items-center gap-3 rounded-md border border-nc-border/60 bg-nc-panel/70 px-3 py-2 text-xs uppercase tracking-[0.16em] text-nc-text backdrop-blur-md transition hover:border-cyan-300/70"
              >
                <span>Power Grid</span>
                <span
                  className={`relative h-6 w-12 rounded-full transition ${
                    gridVisible ? 'bg-cyan-400/80' : 'bg-slate-600/80'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left] ${
                      gridVisible ? 'left-7' : 'left-1'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>
          <div className="rounded-md border border-nc-border/60 bg-nc-panel/70 px-3 py-2 text-right backdrop-blur-md">
            <div className="text-sm font-semibold tracking-wide">Toronto</div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-nc-muted">
              {labeled > 0 ? `${labeled} nameplates · click to inspect` : 'Electrified massing'}
            </div>
          </div>
        </div>
      )}

      {exploreUi && locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="h-5 w-5 -translate-y-px">
            <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-cyan-300/90" />
            <div className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-cyan-300/90" />
            <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/90" />
            <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/90" />
          </div>
        </div>
      )}

      {exploreUi && electricity && (
        <ElectricityPanel data={electricity} onClose={() => setElectricity(null)} />
      )}

      {status && !error && mode !== 'zoom' && mode !== 'backdrop' && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-5 text-sm text-nc-muted backdrop-blur-md">
          {status}
        </div>
      )}

      {exploreUi && cityReady && !locked && !error && !status && (
        <button
          type="button"
          className="absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-5 text-center shadow-xl shadow-black/50 backdrop-blur-md transition hover:border-nc-renew sm:top-24"
          onClick={() => {
            const canvas = mountRef.current?.querySelector('canvas');
            canvas?.click();
          }}
        >
          <div className="text-xl font-semibold sm:text-2xl">Click to fly</div>
          <div className="mt-2 text-xs text-nc-muted">
            WASD move · Space up · C down · Shift sprint · Esc release
          </div>
          <div className="mt-2 text-[11px] text-nc-renew/90">
            Aim at a building and click (or press F) for electricity data
          </div>
        </button>
      )}

      {error && (
        <div className="absolute left-1/2 top-1/2 z-20 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-alert/50 bg-nc-panel/90 p-6 text-center backdrop-blur-md">
          <div className="text-lg font-semibold text-nc-alert">Could not load city</div>
          <p className="mt-2 text-sm text-nc-muted">{error}</p>
        </div>
      )}

      {exploreUi && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 p-3">
          <div className="flex flex-col gap-2">
            {cityReady && searchTargets.length > 0 && (
              <BuildingSearch
                targets={searchTargets}
                onActivate={() => unlockFlyRef.current()}
                onSelect={(target) => {
                  flyToRef.current(target);
                }}
              />
            )}
            <a
              href="https://open.toronto.ca/dataset/3d-massing/"
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto text-[11px] text-nc-muted underline-offset-2 hover:text-nc-text hover:underline"
            >
              open.toronto.ca/dataset/3d-massing
            </a>
          </div>
          <p className="max-w-[50%] text-right text-[10px] leading-snug text-nc-muted/90">{credit}</p>
        </div>
      )}
    </div>
  );
}
