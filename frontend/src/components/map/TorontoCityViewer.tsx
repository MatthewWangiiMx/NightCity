import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AmbientLight,
  BufferAttribute,
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
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  estimateBuildingElectricity,
  type BuildingElectricity,
} from '@/components/map/buildingElectricity';
import { createFuturisticSign } from '@/components/map/futuristicSign';
import {
  localToLonLat,
  matchLandmarksToBuildings,
  type MatchedLandmark,
} from '@/components/map/torontoLandmarks';
import { api } from '@/api/client';
import type { EwrbEuiRow } from '@/api/types';

/** A top-5 row carrying its label and enough geometry to fly the camera to it. */
type NamedEuiRow = EwrbEuiRow & {
  name?: string | null;
  target?: SearchTarget;
};
import {
  euiGradientCss,
  euiLinearColor,
  BAND_BASE,
  EUI_TOP_COLOR,
  EUI_TOP_N,
  WINDOW_BASE,
  type EuiScale,
} from '@/components/map/euiColor';
import BuildingEnergyPanel from '@/components/panels/BuildingEnergyPanel';
import BuildingPlanCompare from '@/components/panels/BuildingPlanCompare';
import type { EwrbLevers, EwrbPlanDay } from '@/api/types';
import { useEwrbProfile } from '@/hooks/useEwrb';
import type { ScenarioKind } from '@/api/types';

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
/** Elevated 2.5D framing for Simulate — orbit around downtown, never enter the streets. */
const ORBIT_TARGET = new Vector3(40, 50, -60);
const ORBIT_POS = new Vector3(560, 340, 620);
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
  /**
   * Which massing building this target is, when it is one.
   *
   * Without it the inspector opens against a synthetic id and reports another
   * building's reported intensity, so anything that flies to a real building
   * should carry these.
   */
  buildingIndex?: number;
  /** Matches MassingBuilding.id, which TigerData and the cache type differently. */
  buildingId?: number | string;
  levels?: number;
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
  visit: (lit: boolean, mat: Matrix4, buildingIndex: number) => void,
) {
  const _pos = new Vector3();
  const _quat = new Quaternion();
  const _scale = new Vector3(1, 1, 1);
  const _mat = new Matrix4();
  const _yAxis = new Vector3(0, 1, 0);
  let seed = 1;

  for (let buildingIndex = 0; buildingIndex < buildings.length; buildingIndex++) {
    const building = buildings[buildingIndex];
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
          visit(hash01(seed) < WIN_LIT_CHANCE, _mat, buildingIndex);
        }
      }
    }
  }
}

/** One building's vertex range inside a merged mesh, so it can be tinted later. */
export type TintSlot = { mesh: Mesh; start: number; count: number; buildingIndex: number };

export type TintTarget = {
  buildingIndices: number[];
  slots: TintSlot[];
  meshes: Mesh[];
};

function mergeChunks(
  geos: ExtrudeGeometry[],
  material: Material,
  group: Group,
  tint?: TintTarget,
) {
  const chunk = 700;
  for (let i = 0; i < geos.length; i += chunk) {
    const slice = geos.slice(i, i + chunk);
    const counts = slice.map((g) => g.getAttribute('position').count);

    if (tint) {
      // The colour attribute has to exist before the merge, because reported
      // EUI arrives after the city is already on screen and is then written
      // straight into the merged buffer. White leaves the material's own
      // colour untouched until that happens.
      slice.forEach((g, j) => {
        if (!g.getAttribute('color')) {
          g.setAttribute('color', new BufferAttribute(new Float32Array(counts[j] * 3).fill(1), 3));
        }
      });
    }

    const merged = mergeGeometries(slice, false);
    slice.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeVertexNormals();
    const mesh = new Mesh(merged, material);
    group.add(mesh);

    if (tint) {
      tint.meshes.push(mesh);
      let offset = 0;
      counts.forEach((n, j) => {
        tint.slots.push({
          mesh,
          start: offset,
          count: n,
          buildingIndex: tint.buildingIndices[i + j],
        });
        offset += n;
      });
    }
  }
}

/**
 * Recolour lit windows from the reported-EUI ramp.
 *
 * Passing a null scale restores the city's own window colour, which is what
 * switching the layer off does.
 */
export function applyEuiWindows(
  mesh: InstancedMesh | null,
  buildingByInstance: Int32Array,
  euiByIndex: Map<number, number>,
  scale: EuiScale | null,
  topIndices: Set<number> = new Set(),
) {
  if (!mesh) return;
  const colour = new Color();
  const base = new Color(WINDOW_BASE).convertSRGBToLinear();
  const count = Math.min(mesh.count, buildingByInstance.length);

  for (let i = 0; i < count; i++) {
    if (scale == null) {
      mesh.setColorAt(i, base);
      continue;
    }
    const idx = buildingByInstance[i];
    euiLinearColor(
      idx >= 0 ? euiByIndex.get(idx) ?? null : null,
      scale,
      colour,
      idx >= 0 && topIndices.has(idx),
      WINDOW_BASE,
    );
    mesh.setColorAt(i, colour);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Paint each building's vertex range with its reported-EUI colour. */
export function applyEuiTint(
  slots: TintSlot[],
  euiByIndex: Map<number, number>,
  scale: EuiScale | null,
  topIndices: Set<number> = new Set(),
) {
  const colour = new Color();
  const touched = new Set<Mesh>();

  for (const slot of slots) {
    const eui = euiByIndex.get(slot.buildingIndex);
    euiLinearColor(
      eui ?? null,
      scale,
      colour,
      topIndices.has(slot.buildingIndex),
      BAND_BASE,
    );
    const attr = slot.mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (!attr) continue;
    for (let v = slot.start; v < slot.start + slot.count; v++) {
      attr.setXYZ(v, colour.r, colour.g, colour.b);
    }
    touched.add(slot.mesh);
  }

  touched.forEach((mesh) => {
    const attr = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (attr) attr.needsUpdate = true;
  });
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
): {
  group: Group;
  signs: Sprite[];
  hitTargets: Group;
  tint: TintTarget;
  /** Swapped onto the band meshes to turn the EUI colouring on and off. */
  tintMaterials: { base: Material[]; eui: Material[] };
  /** Lit-window instances plus the building each one belongs to. */
  windows: { mesh: InstancedMesh | null; buildingByInstance: Int32Array };
} {
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
  // The light band that wraps each building carries the EUI colour when the
  // layer is on. White base so the vertex colour is the whole colour.
  const accentEuiMat = new MeshBasicMaterial({ color: '#ffffff', vertexColors: true });

  const shellGeos: ExtrudeGeometry[] = [];
  const landmarkGeos: ExtrudeGeometry[] = [];
  // Parallel to the two arrays above, so a merged vertex range can be traced
  // back to the building it belongs to.
  const shellIdx: number[] = [];
  const landmarkIdx: number[] = [];
  // Parallel to accentGeos: a band's vertex range has to map back to its
  // building so it can be tinted by that building's reported intensity.
  const accentIdx: number[] = [];
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
    if (isLandmark) {
      landmarkGeos.push(shaft);
      landmarkIdx.push(index);
    } else {
      shellGeos.push(shaft);
      shellIdx.push(index);
    }

    if (crownH > 0) {
      const crownShape = makeShape(outer, holes, 3.2);
      crownGeos.push(extrudeUp(crownShape, crownH, shaftH + 0.05));

      // Thin neon crown band
      const bandShape = makeShape(outer, holes, 1.2);
      const band = extrudeUp(bandShape, 1.1, shaftH - 0.2);
      accentGeos.push(band);
      accentIdx.push(index);
    }

    // Mid-tower mechanical belt on very tall buildings
    if (buildH >= 160) {
      const beltY = buildH * 0.55;
      const belt = extrudeUp(makeShape(outer, holes, 0.8), 2.2, beltY);
      accentGeos.push(belt);
      accentIdx.push(index);
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

  const tint: TintTarget = { buildingIndices: accentIdx, slots: [], meshes: [] };
  mergeChunks(accentGeos, accentMat, group, tint);
  const tintMaterials = {
    base: tint.meshes.map(() => accentMat as Material),
    eui: tint.meshes.map(() => accentEuiMat as Material),
  };

  // Windows
  let litTotal = 0;
  let dimTotal = 0;
  forEachWindow(buildings, (lit) => {
    if (lit) litTotal += 1;
    else dimTotal += 1;
  });

  const winGeo = new BoxGeometry(WIN_W, WIN_H, WIN_D);
  // White material: the per-instance colour multiplies it, so instanceColor
  // carries the window's whole colour and nothing is tinted twice.
  const litMesh =
    litTotal > 0
      ? new InstancedMesh(winGeo, new MeshBasicMaterial({ color: '#ffffff' }), litTotal)
      : null;
  const dimMesh =
    dimTotal > 0
      ? new InstancedMesh(winGeo, new MeshBasicMaterial({ color: '#15202b' }), dimTotal)
      : null;

  let litI = 0;
  let dimI = 0;
  // Which building each lit instance belongs to, so the windows can be
  // recoloured once reported intensity arrives.
  const litBuildingByInstance = new Int32Array(Math.max(1, litTotal)).fill(-1);
  const unlitColour = new Color(WINDOW_BASE).convertSRGBToLinear();
  forEachWindow(buildings, (lit, mat, buildingIndex) => {
    if (lit) {
      if (litMesh) {
        litMesh.setMatrixAt(litI, mat);
        litMesh.setColorAt(litI, unlitColour);
        litBuildingByInstance[litI] = buildingIndex;
      }
      litI += 1;
    } else {
      dimMesh?.setMatrixAt(dimI++, mat);
    }
  });
  if (litMesh) {
    litMesh.name = 'litWindows';
    litMesh.instanceMatrix.needsUpdate = true;
    if (litMesh.instanceColor) litMesh.instanceColor.needsUpdate = true;
    group.add(litMesh);
  }
  if (dimMesh) {
    dimMesh.name = 'dimWindows';
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

  return {
    group,
    signs,
    hitTargets,
    tint,
    tintMaterials,
    windows: { mesh: litMesh, buildingByInstance: litBuildingByInstance },
  };
}

/** Dim / recolor lit windows for a weather disruption on the 3D massing. */
function applyScenarioWindowLights(
  lit: InstancedMesh | null,
  kind: ScenarioKind | undefined,
  intensity: number,
) {
  if (!lit) return;
  const mat = lit.material as MeshBasicMaterial;
  const t = Math.min(1, Math.max(0, intensity));

  if (!kind || t <= 0.02) {
    // White base so per-instance EUI colours carry the window look.
    mat.color.set('#ffffff');
    mat.transparent = false;
    mat.opacity = 1;
    lit.visible = true;
    mat.needsUpdate = true;
    return;
  }

  switch (kind) {
    case 'storm':
      // Cascading blackout — most towers go dark.
      mat.color.set('#6a8a9a');
      mat.transparent = true;
      mat.opacity = Math.max(0.04, 1 - t * 0.94);
      lit.visible = true;
      break;
    case 'heat_wave':
      mat.color.set('#ffd4a8');
      mat.transparent = false;
      mat.opacity = 1;
      lit.visible = true;
      break;
    case 'solar_drop':
      mat.color.set('#9eb8c8');
      mat.transparent = true;
      mat.opacity = 0.55 + (1 - t) * 0.45;
      lit.visible = true;
      break;
    case 'battery_outage':
      mat.color.set('#a8c4d4');
      mat.transparent = true;
      mat.opacity = Math.max(0.2, 1 - t * 0.55);
      lit.visible = true;
      break;
    case 'ev_surge':
      mat.color.set('#ffe08a');
      mat.transparent = false;
      mat.opacity = 1;
      lit.visible = true;
      break;
    default:
      mat.color.set('#ffffff');
      mat.transparent = false;
      mat.opacity = 1;
      lit.visible = true;
  }
  mat.needsUpdate = true;
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
        <ul className="absolute top-[calc(100%+0.4rem)] left-0 right-0 max-h-64 overflow-auto rounded-xl border border-cyan-400/30 bg-[#061018]/95 py-1 shadow-xl backdrop-blur-md">
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
        <div className="absolute top-[calc(100%+0.4rem)] left-0 right-0 rounded-xl border border-nc-border/70 bg-[#061018]/95 px-3 py-2 text-xs text-nc-muted backdrop-blur-md">
          No buildings match “{query.trim()}”
        </div>
      )}
    </div>
  );
}

/**
 * Legend for the reported-EUI colour layer.
 *
 * A sequential ramp is useless without its bounds, so the scale is labelled at
 * both ends and at the cohort median. The caveat is on the card rather than in
 * a tooltip, because the single most likely misreading - bright equals badly
 * run - needs to be visible at the same moment as the colours.
 */
function EuiLegend({
  scale,
  top,
  onFly,
}: {
  scale: EuiScale;
  top: NamedEuiRow[];
  onFly: (target: SearchTarget) => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-amber-400/30 bg-[#061018]/92 p-3 shadow-2xl shadow-amber-500/10 backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-300/90">
          Heaviest 25%
        </span>
        <span className="text-[10px] text-nc-muted">kWh/m²·yr</span>
      </div>
      <div className="text-[10px] text-nc-muted/80">Windows and roof band</div>

      {/* Only the painted quartile appears on the ramp */}
      <div
        className="mt-2 h-2.5 rounded-full"
        style={{ background: euiGradientCss() }}
      />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-nc-muted">
        <span>{Math.round(scale.p75).toLocaleString()}</span>
        <span>{Math.round(scale.p95).toLocaleString()}+</span>
      </div>
      <div className="flex justify-between text-[9px] uppercase tracking-wide text-nc-muted/70">
        <span>cutoff · dim</span>
        <span>worst · bright</span>
      </div>

      <div className="mt-2 space-y-1 text-[10px] text-nc-muted">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: WINDOW_BASE }}
          />
          <span>Under {Math.round(scale.p75).toLocaleString()} — unchanged</span>
          <span className="ml-auto tabular-nums">
            {Math.round(scale.n * 0.75).toLocaleString()}
          </span>
        </div>
        <div className="text-[10px] text-nc-muted/70">
          {scale.n.toLocaleString()} buildings matched to a reported cohort
        </div>
      </div>

      {/* The heaviest few, named: the deep red is too dark to carry this alone */}
      {top.length > 0 && (
        <div className="mt-2.5 border-t border-nc-border/60 pt-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: EUI_TOP_COLOR }}
            />
            <span className="text-[10px] uppercase tracking-wide text-nc-muted">
              {top.length} heaviest buildings
            </span>
            <span className="ml-auto text-[9px] text-nc-muted/60">click to fly</span>
          </div>
          <ol className="space-y-0.5">
            {top.map((row, i) => (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={!row.target}
                  onClick={() => row.target && onFly(row.target)}
                  title={row.target ? 'Fly to this building' : 'Location unavailable'}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-[10px] transition hover:bg-red-400/10 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="w-3 shrink-0 tabular-nums text-nc-muted/70">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-nc-text">
                      {row.name ?? row.property_type}
                    </span>
                    <span className="block truncate text-[9px] text-nc-muted/70">
                      {row.property_type}
                      {row.fsa ? ` · ${row.fsa}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-nc-text">
                    {Math.round(row.eui).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-snug text-nc-muted/80">
        Site energy per m² reported to Ontario EWRB by comparable properties. Only the
        heaviest quarter is coloured; every other building is left as it is. Raw intensity mixes
        building type with performance — a hospital out-consumes a warehouse by design,
        so brighter does not by itself mean worse-run.
      </p>
    </div>
  );
}

export default function TorontoCityViewer({
  mode = 'explore',
  onZoomComplete,
  scenarioKind,
  effectIntensity = 0,
  variant = 'default',
  planLevers = null,
  planDay = null,
  className = '',
}: {
  mode?: CityViewMode;
  onZoomComplete?: () => void;
  /** Weather disruption driving window lights / atmosphere (Simulate). */
  scenarioKind?: ScenarioKind;
  effectIntensity?: number;
  /**
   * `simulate` — embedded 2.5D orbit of the massing (drag to rotate, no fly-through).
   * Hides Explore home chrome; city fills the parent panel.
   */
  variant?: 'default' | 'simulate';
  /** Applied plan, so a clicked building can show today against the plan. */
  planLevers?: Partial<EwrbLevers> | null;
  planDay?: Partial<EwrbPlanDay> | null;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<CityViewMode>(mode);
  const onZoomCompleteRef = useRef(onZoomComplete);
  const litWindowsRef = useRef<InstancedMesh | null>(null);
  const variantRef = useRef(variant);
  const scenarioRef = useRef<{ kind?: ScenarioKind; intensity: number }>({
    kind: scenarioKind,
    intensity: effectIntensity,
  });
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('Loading Toronto 3D Massing…');
  const [error, setError] = useState<string | null>(null);
  const [credit, setCredit] = useState('City of Toronto Open Data · 3D Massing');
  const [labeled, setLabeled] = useState(0);
  const [electricity, setElectricity] = useState<BuildingElectricity | null>(null);
  // Reported EWRB half of the inspector; the geometry half renders without it.
  const { profile: ewrbProfile, status: ewrbStatus, load: loadEwrb, clear: clearEwrb } =
    useEwrbProfile();
  const [cityReady, setCityReady] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);
  const [searchTargets, setSearchTargets] = useState<SearchTarget[]>([]);
  // Reported-EUI colour layer: off by default so the city keeps its own look.
  // On the results page the colouring is the whole point, so it starts on.
  const [euiVisible, setEuiVisible] = useState(variant === 'simulate');
  const [euiScale, setEuiScale] = useState<EuiScale | null>(null);
  const [euiTop, setEuiTop] = useState<NamedEuiRow[]>([]);
  const [euiStatus, setEuiStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>(
    'idle',
  );
  const gridRef = useRef<Group | null>(null);
  const gridVisibleRef = useRef(gridVisible);
  const tintRef = useRef<TintTarget | null>(null);
  const tintMaterialsRef = useRef<{ base: Material[]; eui: Material[] } | null>(null);
  const windowsRef = useRef<{
    mesh: InstancedMesh | null;
    buildingByInstance: Int32Array;
  } | null>(null);
  const euiPaintRef = useRef<{
    byIndex: Map<number, number>;
    scale: EuiScale | null;
    topIndices: Set<number>;
  }>({ byIndex: new Map(), scale: null, topIndices: new Set() });
  const euiVisibleRef = useRef(euiVisible);

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
    euiVisibleRef.current = euiVisible;
  }, [euiVisible]);


  // Toggling the layer swaps materials rather than rebuilding geometry, so the
  // vertex colours written once stay valid and the switch is instant.
  useEffect(() => {
    const tint = tintRef.current;
    const mats = tintMaterialsRef.current;
    if (!tint || !mats) return;
    tint.meshes.forEach((mesh, i) => {
      const next = euiVisible ? mats.eui[i] : mats.base[i];
      if (next) mesh.material = next;
    });

    const windows = windowsRef.current;
    const paint = euiPaintRef.current;
    if (windows) {
      applyEuiWindows(
        windows.mesh,
        windows.buildingByInstance,
        paint.byIndex,
        euiVisible ? paint.scale : null,
        paint.topIndices,
      );
    }
  }, [euiVisible, euiStatus]);

  useEffect(() => {
    onZoomCompleteRef.current = onZoomComplete;
  }, [onZoomComplete]);

  useEffect(() => {
    variantRef.current = variant;
  }, [variant]);

  useEffect(() => {
    scenarioRef.current = { kind: scenarioKind, intensity: effectIntensity };
    applyScenarioWindowLights(litWindowsRef.current, scenarioKind, effectIntensity);
  }, [scenarioKind, effectIntensity]);

  useEffect(() => {
    selectRef.current = (pick) => {
      if (!pick) {
        setElectricity(null);
        clearEwrb();
        return;
      }
      const id = pick.buildingId != null ? `tiger-${pick.buildingId}` : `b-${pick.buildingIndex}`;
      setElectricity(
        estimateBuildingElectricity({
          id,
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

      // Scene coords back to lon/lat so the backend can pick the postal FSA
      // cohort rather than falling back to the city-wide one.
      const { lat, lon } = localToLonLat(pick.x, pick.z);
      loadEwrb({
        id,
        name: pick.name,
        kind: pick.kind,
        footprint_m2: pick.footprint_m2,
        height_m: pick.h,
        levels: pick.levels ?? null,
        lat,
        lon,
        hour: new Date().getHours(),
      });
    };
  }, [loadEwrb, clearEwrb]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let controls: PointerLockControls | null = null;
    let orbit: OrbitControls | null = null;
    let renderer: WebGLRenderer | null = null;
    let city: Group | null = null;
    let hitTargets: Group | null = null;
    let signs: Sprite[] = [];
    let highlight: Mesh | null = null;
    const simulateOrbit = variantRef.current === 'simulate';

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
    const baseBg = new Color('#02060d');
    scene.background = baseBg.clone();
    // Tighter fog so the dense downtown reads as a 2.5D city picture.
    scene.fog = new Fog('#02060d', simulateOrbit ? 380 : 500, simulateOrbit ? 2200 : 2600);

    const camera = new PerspectiveCamera(simulateOrbit ? 38 : 68, 1, 0.8, 5000);
    if (simulateOrbit) {
      camera.position.copy(ORBIT_POS);
      camera.lookAt(ORBIT_TARGET);
    } else {
      // Start in cinematic preview / backdrop framing (farther / higher).
      camera.position.copy(BACKDROP_POS);
      camera.lookAt(PREVIEW_LOOK);
    }

    // A browser will refuse a context once too many are live, and three throws
    // from the constructor when it does. Unhandled, that takes the whole app
    // down with it; the city is one panel, so it fails as one panel instead.
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        logarithmicDepthBuffer: true,
      });
    } catch (err) {
      setError(
        'The browser could not create a WebGL context — usually too many 3D views open at once. ' +
          'Close other tabs using 3D, or fully restart the browser. ' +
          (err instanceof Error ? err.message : String(err)),
      );
      setStatus('');
      return;
    }
    renderer.setClearColor(0x02060d);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    mount.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0x6b7c8f, simulateOrbit ? 0.32 : 0.22));
    scene.add(new HemisphereLight(0x1e293b, 0x020617, simulateOrbit ? 0.55 : 0.4));
    const key = new DirectionalLight(0x94a3b8, simulateOrbit ? 0.45 : 0.28);
    key.position.set(-180, 320, 120);
    scene.add(key);
    if (simulateOrbit) {
      const fill = new DirectionalLight(0x67e8f9, 0.18);
      fill.position.set(220, 180, -160);
      scene.add(fill);
    }

    const onLock = () => setLocked(true);
    const onUnlock = () => setLocked(false);
    if (simulateOrbit) {
      orbit = new OrbitControls(camera, renderer.domElement);
      orbit.target.copy(ORBIT_TARGET);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.07;
      orbit.enablePan = false;
      orbit.enableZoom = true;
      orbit.rotateSpeed = 0.48;
      orbit.zoomSpeed = 0.75;
      // Stay above the skyline — rotate around, never dive into the streets.
      orbit.minDistance = 320;
      orbit.maxDistance = 980;
      orbit.minPolarAngle = Math.PI * 0.32;
      orbit.maxPolarAngle = Math.PI * 0.46;
      orbit.autoRotate = true;
      orbit.autoRotateSpeed = 0.35;
      orbit.update();
    } else {
      controls = new PointerLockControls(camera, renderer.domElement);
      controls.addEventListener('lock', onLock);
      controls.addEventListener('unlock', onUnlock);
    }

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

    /**
     * Pick under the cursor. The orbit view has no crosshair, so the pointer
     * position is the selection, unlike the locked fly view which picks centre.
     */
    const pickAtPointer = (event: MouseEvent) => {
      if (!hitTargets || !ready || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
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

    const onClick = (event: MouseEvent) => {
      if (!ready) return;
      if (typingInField()) return;
      // Orbit view: no fly lock or street entry, but buildings are inspectable.
      if (simulateOrbit) {
        if (orbit) orbit.autoRotate = false;
        pickAtPointer(event);
        return;
      }
      if (!controls) return;
      if (modeRef.current !== 'explore') return;
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
        buildingIndex: target.buildingIndex ?? -2,
        buildingId: target.buildingId,
        name: target.short ?? target.name,
        kind: target.kind,
        h: target.h,
        footprint_m2: target.footprint_m2,
        x: target.x,
        z: target.z,
        levels: target.levels,
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
      if (disposed || !renderer) return;
      if (!simulateOrbit && !controls) return;
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      const delta = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      const viewMode = modeRef.current;

      if (!simulateOrbit) {
        if (viewMode === 'zoom' && lastMode !== 'zoom') beginZoom();
        lastMode = viewMode;
      }

      if (gridRef.current) {
        const inCity =
          simulateOrbit || viewMode === 'explore' || viewMode === 'zoom';
        gridRef.current.visible = inCity && gridVisibleRef.current;
      }

      // Atmosphere reacts to the active Simulate scenario.
      const sc = scenarioRef.current;
      const fog = scene.fog;
      if (fog instanceof Fog) {
        const baseNear = simulateOrbit ? 380 : 500;
        const baseFar = simulateOrbit ? 2200 : 2600;
        if (sc.kind === 'storm' && sc.intensity > 0.02) {
          fog.near = baseNear - sc.intensity * 220;
          fog.far = baseFar - sc.intensity * 900;
          fog.color.set('#02060d');
          (scene.background as Color).copy(baseBg).lerp(new Color('#050308'), sc.intensity * 0.65);
        } else if (sc.kind === 'heat_wave' && sc.intensity > 0.02) {
          fog.near = baseNear - 40;
          fog.far = baseFar - 200;
          fog.color.set('#1a0c08');
          (scene.background as Color).set('#1a0c08').lerp(new Color('#3a1810'), sc.intensity * 0.4);
        } else if (sc.kind === 'solar_drop' && sc.intensity > 0.02) {
          fog.near = baseNear;
          fog.far = baseFar - 100;
          fog.color.set('#0a1018');
          (scene.background as Color).copy(baseBg).lerp(new Color('#0a1018'), sc.intensity * 0.5);
        } else {
          fog.near = baseNear;
          fog.far = baseFar;
          fog.color.set('#02060d');
          (scene.background as Color).copy(baseBg);
        }
      }

      if (simulateOrbit && orbit) {
        orbit.update();
      } else if (controls) {
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
      }

      // Distance-scale futuristic signs so names stay readable in flight / orbit.
      const showSigns = simulateOrbit || viewMode === 'explore' || viewMode === 'zoom';
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
        // Plan backdrop stays silent (no labels/grid). Simulate uses the full
        // Explore massing even if the camera starts mid-zoom.
        const isBackdrop =
          modeRef.current === 'backdrop' && variantRef.current !== 'simulate';
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
        tintRef.current = built.tint;
        tintMaterialsRef.current = built.tintMaterials;
        windowsRef.current = built.windows;
        litWindowsRef.current = built.windows.mesh;
        applyScenarioWindowLights(
          litWindowsRef.current,
          scenarioRef.current.kind,
          scenarioRef.current.intensity,
        );

        const cn = data.landmarks?.cnTower;
        city.add(buildCnTower(cn?.x ?? 0, cn?.z ?? 0));
        scene.add(city);
        if (gridData) {
          const mesh = buildGridMesh(gridData, electric);
          // Hidden on home cinematic pan; Explore / Simulate respect the toggle.
          const inCity =
            simulateOrbit ||
            modeRef.current === 'explore' ||
            modeRef.current === 'zoom';
          mesh.visible = inCity && gridVisibleRef.current;
          gridRef.current = mesh;
          scene.add(mesh);
        }
        if (!isBackdrop) {
          // Ids must match the click path exactly, or a building's colour would
          // disagree with the EUI its own panel reports.
          const idForIndex = (i: number) =>
            electric[i].id != null ? `tiger-${electric[i].id}` : `b-${i}`;
          const idToIndex = new Map<string, number>();
          // Same label the inspector shows, so the legend and the panel agree.
          const nameByIndex = new Map<number, string>();
          // Kept so a top-5 row can fly the camera to its building.
          const targetByIndex = new Map<number, SearchTarget>();
          const payload = electric.map((b, i) => {
            const id = idForIndex(i);
            idToIndex.set(id, i);
            const outer = b.rings[0];
            const match = matches.find((m) => m.buildingIndex === i);
            nameByIndex.set(
              i,
              match?.landmark.short ??
                match?.landmark.name ??
                `Building · ${Math.round(b.h)}m`,
            );
            const bbox = ringBBox(outer);
            const { lat, lon } = localToLonLat(bbox.cx, bbox.cz);
            const footprint = match?.footprint_m2 ?? ringArea(outer);
            const kind = match?.landmark.kind ?? (b.h >= 80 ? 'office' : 'structure');
            targetByIndex.set(i, {
              id,
              name: nameByIndex.get(i) ?? id,
              short: match?.landmark.short,
              kind,
              x: bbox.cx,
              z: bbox.cz,
              h: b.h,
              plateY: match ? landmarkNameplateY(match, b) : b.h + 22,
              footprint_m2: footprint,
              buildingIndex: i,
              buildingId: b.id,
              levels: b.levels,
            });
            return {
              id,
              footprint_m2: footprint,
              kind,
              h: b.h,
              levels: b.levels ?? null,
              lat,
              lon,
            };
          });

          setEuiStatus('loading');
          api
            .ewrbBuildingEuis(payload)
            .then((res) => {
              if (disposed) return;
              const byIndex = new Map<number, number>();
              res.buildings.forEach((row) => {
                const idx = idToIndex.get(row.id);
                if (idx != null) byIndex.set(idx, row.eui);
              });
              // The few heaviest buildings get their own colour, so pick them
              // from the reported rows rather than from a threshold.
              const ranked = [...res.buildings].sort((a, b) => b.eui - a.eui);
              const top = ranked.slice(0, EUI_TOP_N);
              const topIndices = new Set<number>();
              top.forEach((row) => {
                const idx = idToIndex.get(row.id);
                if (idx != null) topIndices.add(idx);
              });

              if (built.tint.slots.length) {
                applyEuiTint(built.tint.slots, byIndex, res.scale, topIndices);
              }

              euiPaintRef.current = { byIndex, scale: res.scale, topIndices };
              // Covers the layer being switched on while this was in flight.
              applyEuiWindows(
                built.windows.mesh,
                built.windows.buildingByInstance,
                byIndex,
                euiVisibleRef.current ? res.scale : null,
                topIndices,
              );

              setEuiTop(
                top.map((row) => {
                  const idx = idToIndex.get(row.id);
                  return {
                    ...row,
                    name: idx != null ? nameByIndex.get(idx) ?? null : null,
                    target: idx != null ? targetByIndex.get(idx) : undefined,
                  };
                }),
              );
              setEuiScale(res.scale);
              setEuiStatus('ready');
            })
            .catch(() => {
              if (disposed) return;
              setEuiScale(null);
              setEuiStatus('unavailable');
            });
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
                buildingIndex: m.buildingIndex >= 0 ? m.buildingIndex : undefined,
                buildingId: building?.id,
                levels: building?.levels,
              };
            }),
          );
        }
        ready = true;
        setCityReady(true);
        setStatus('');

        if (simulateOrbit) {
          camera.position.copy(ORBIT_POS);
          camera.lookAt(ORBIT_TARGET);
          if (orbit) {
            orbit.target.copy(ORBIT_TARGET);
            orbit.update();
          }
        } else if (modeRef.current === 'explore') {
          camera.position.copy(EXPLORE_POS);
          camera.lookAt(EXPLORE_LOOK);
        } else if (modeRef.current === 'backdrop') {
          camera.position.copy(BACKDROP_POS);
          camera.lookAt(PREVIEW_LOOK);
        } else if (modeRef.current === 'zoom') {
          camera.position.copy(BACKDROP_POS);
          camera.lookAt(PREVIEW_LOOK);
          beginZoom();
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
      orbit?.dispose();
      if (highlight) {
        scene.remove(highlight);
        highlight.geometry.dispose();
        (highlight.material as MeshBasicMaterial).dispose();
      }
      litWindowsRef.current = null;
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
      // dispose() frees three's own GPU resources but leaves the WebGL context
      // itself alive until the canvas is collected, and a browser allows only
      // ~16 at once. StrictMode mounts twice and every HMR update remounts, so
      // without an explicit context loss a dev session runs out of contexts and
      // every later view fails to start until the browser is restarted.
      renderer?.forceContextLoss();
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
  const simulateUi = variant === 'simulate';
  const showCityChrome = simulateUi || (exploreUi && !backdropUi);

  return (
    <div
      className={`overflow-hidden bg-nc-bg ${
        simulateUi ? 'relative h-full w-full' : 'absolute inset-0 h-full w-full'
      } ${className}`}
    >
      <div
        ref={mountRef}
        className={`absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${backdropUi ? 'pointer-events-none' : ''}`}
      />

      {showCityChrome && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4">
          <div className="pointer-events-auto">
            <div className="flex items-center gap-3">
              {!simulateUi && (
                <Link
                  to="/"
                  className="rounded-md border border-nc-border/80 bg-nc-panel/80 px-3 py-1.5 text-sm backdrop-blur-md transition hover:border-nc-renew"
                >
                  ← NightCity
                </Link>
              )}
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
              <button
                type="button"
                role="switch"
                aria-checked={euiVisible}
                aria-label="Toggle reported energy intensity colouring"
                disabled={euiStatus !== 'ready'}
                onClick={() => setEuiVisible((visible) => !visible)}
                title={
                  euiStatus === 'unavailable'
                    ? 'EWRB dataset not loaded'
                    : 'Colour buildings by reported site energy intensity'
                }
                className="flex items-center gap-3 rounded-md border border-nc-border/60 bg-nc-panel/70 px-3 py-2 text-xs uppercase tracking-[0.16em] text-nc-text backdrop-blur-md transition hover:border-amber-300/70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>Energy Use</span>
                <span
                  className={`relative h-6 w-12 rounded-full transition ${
                    euiVisible ? 'bg-amber-400/80' : 'bg-slate-600/80'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left] ${
                      euiVisible ? 'left-7' : 'left-1'
                    }`}
                  />
                </span>
              </button>
            </div>

            {/*
              Directly under the toggles. The detail panel is anchored top-right
              and runs most of the viewport height, so the bottom-right corner
              is not reliably visible.
            */}
            {!simulateUi && cityReady && searchTargets.length > 0 && (
              <div className="mt-2">
                <BuildingSearch
                  targets={searchTargets}
                  onActivate={() => unlockFlyRef.current()}
                  onSelect={(target) => {
                    flyToRef.current(target);
                  }}
                />
              </div>
            )}
          </div>
          <div className="rounded-md border border-nc-border/60 bg-nc-panel/70 px-3 py-2 text-right backdrop-blur-md">
            <div className="text-sm font-semibold tracking-wide">Toronto</div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-nc-muted">
              {simulateUi
                ? '2.5D orbit · drag to rotate'
                : labeled > 0
                  ? `${labeled} nameplates · click to inspect`
                  : 'Electrified massing'}
            </div>
          </div>
        </div>
      )}

      {!simulateUi && showCityChrome && locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="h-5 w-5 -translate-y-px">
            <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-cyan-300/90" />
            <div className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-cyan-300/90" />
            <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/90" />
            <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/90" />
          </div>
        </div>
      )}

      {showCityChrome && euiVisible && euiScale && (
        <EuiLegend
          scale={euiScale}
          top={euiTop}
          onFly={(target) => flyToRef.current(target)}
        />
      )}

      {showCityChrome && electricity && planLevers && (
        <BuildingPlanCompare geometry={electricity} levers={planLevers} day={planDay} />
      )}

      {showCityChrome && electricity && !planLevers && (
        <BuildingEnergyPanel
          geometry={electricity}
          profile={ewrbProfile}
          status={ewrbStatus}
          onClose={() => {
            setElectricity(null);
            clearEwrb();
          }}
        />
      )}

      {status && !error && mode !== 'backdrop' && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-5 text-sm text-nc-muted backdrop-blur-md">
          {status}
        </div>
      )}

      {simulateUi && cityReady && !error && !status && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-nc-border/70 bg-nc-panel/80 px-4 py-2 text-center text-[11px] text-nc-muted backdrop-blur-md">
          Drag to rotate · scroll to zoom · streets stay locked
        </div>
      )}

      {!simulateUi && showCityChrome && cityReady && !locked && !error && !status && (
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

      {/*
        The bottom bar sits hard right: the energy-use legend owns the
        bottom-left corner, and a card that tall would cover anything placed
        there. Search lives under the top-left toggles instead.
      */}
      {showCityChrome && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-end gap-4 p-3">
          <div className="flex flex-col items-end gap-2">
            <a
              href="https://open.toronto.ca/dataset/3d-massing/"
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto text-[11px] text-nc-muted underline-offset-2 hover:text-nc-text hover:underline"
            >
              open.toronto.ca/dataset/3d-massing
            </a>
            <p className="max-w-[min(22rem,calc(100vw-1.5rem))] text-right text-[10px] leading-snug text-nc-muted/90">
              {credit}
            </p>
          </div>
        </div>
      )}

      {/* Weather overlays for Simulate — sit above the WebGL canvas */}
      {simulateUi && scenarioKind === 'storm' && effectIntensity > 0.05 && (
        <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
          <div className="absolute inset-0 bg-[#02060d]/25" />
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-18deg, transparent, transparent 6px, rgba(180,220,255,0.12) 6px, rgba(180,220,255,0.12) 7px)',
              animation: 'nc-rain 0.55s linear infinite',
            }}
          />
        </div>
      )}
      {simulateUi && scenarioKind === 'heat_wave' && effectIntensity > 0.05 && (
        <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-orange-500/20 via-transparent to-orange-400/10 nc-heat-shimmer" />
      )}
    </div>
  );
}
