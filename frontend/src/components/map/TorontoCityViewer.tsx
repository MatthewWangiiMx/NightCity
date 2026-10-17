import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
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

const MASSING_URL = '/data/toronto-massing.json';

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

export type CityViewMode = 'preview' | 'zoom' | 'explore';

const PREVIEW_LOOK = new Vector3(40, 90, -80);
const EXPLORE_POS = new Vector3(80, 140, 520);
const EXPLORE_LOOK = new Vector3(0, 180, 0);
const ZOOM_MS = 1600;

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
  h: number;
  rings: [number, number][][];
};

type MassingData = {
  source: string;
  license: string;
  url: string;
  count: number;
  landmarks?: { cnTower?: { x: number; z: number; height: number } };
  buildings: MassingBuilding[];
};

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

function addLandmarkExtras(match: MatchedLandmark, group: Group) {
  const accent = new MeshBasicMaterial({ color: '#67e8f9' });
  const shell = new MeshStandardMaterial({
    color: '#0c1520',
    roughness: 0.85,
    metalness: 0.18,
  });

  // Rooftop HUD ring
  const ring = new Mesh(new CylinderGeometry(8, 8, 0.6, 24, 1, true), accent);
  ring.position.set(match.x, match.h + 2.5, match.z);
  group.add(ring);

  // Corner beacons
  for (const [dx, dz] of [
    [6, 6],
    [-6, 6],
    [6, -6],
    [-6, -6],
  ] as const) {
    const beacon = new Mesh(new BoxGeometry(1.2, 2.4, 1.2), accent);
    beacon.position.set(match.x + dx, match.h + 1.2, match.z + dz);
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
    spire.position.set(match.x, match.h + 10, match.z);
    group.add(spire);
  }
}

export type BuildingPick = {
  buildingIndex: number;
  name: string;
  kind: string;
  h: number;
  footprint_m2: number;
  x: number;
  z: number;
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
): { group: Group; signs: Sprite[]; hitTargets: Group } {
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

    // Main shaft — leave headroom for setback crown on tall towers.
    const crownH = h >= 90 ? Math.min(28, h * 0.14) : 0;
    const shaftH = h - crownH;
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
    if (h >= 160) {
      const beltY = h * 0.55;
      const belt = extrudeUp(makeShape(outer, holes, 0.8), 2.2, beltY);
      accentGeos.push(belt);
    }

    // Invisible click proxy (raycastable)
    const hit = new Mesh(new BoxGeometry(bbox.w, h, bbox.d), hitMat);
    hit.position.set(bbox.cx, h / 2, bbox.cz);
    hit.userData.pick = {
      buildingIndex: index,
      name: match?.landmark.short ?? match?.landmark.name ?? `Building · ${Math.round(h)}m`,
      kind: match?.landmark.kind ?? (h >= 80 ? 'office' : 'structure'),
      h,
      footprint_m2: match?.footprint_m2 ?? ringArea(outer),
      x: bbox.cx,
      z: bbox.cz,
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

  // Landmark extras + futuristic name signs
  for (const match of matches) {
    if (match.landmark.id !== 'cn-tower') addLandmarkExtras(match, group);
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
      } satisfies BuildingPick;
      hitTargets.add(cnHit);
    }

    const label = match.landmark.short ?? match.landmark.name;
    const kind = (match.landmark.kind ?? 'structure').toUpperCase();
    const sign = createFuturisticSign(label, kind);
    const lift = match.landmark.id === 'cn-tower' ? 570 : match.h + 22;
    sign.position.set(match.x, lift, match.z);
    sign.userData.anchor = { x: match.x, y: lift, z: match.z };
    group.add(sign);
    signs.push(sign);
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
    color: '#0a0e14',
    roughness: 0.9,
    metalness: 0.12,
  });
  const accent = new MeshBasicMaterial({ color: '#7dd3fc' });

  const base = new Mesh(new CylinderGeometry(26, 32, 16, 20), shell);
  base.position.y = 8;
  g.add(base);

  const legs = new Mesh(new CylinderGeometry(9, 20, 50, 14), shell);
  legs.position.y = 41;
  g.add(legs);

  const shaft = new Mesh(new CylinderGeometry(5.5, 8, 280, 16), shell);
  shaft.position.y = 206;
  g.add(shaft);

  for (const [y, r, h] of [
    [350, 20, 10],
    [385, 11, 7],
  ] as const) {
    const pod = new Mesh(new CylinderGeometry(r, r + 2, h, 20), shell);
    pod.position.y = y;
    g.add(pod);
    const ring = new Mesh(new CylinderGeometry(r + 0.4, r + 0.4, 1.2, 20), accent);
    ring.position.y = y;
    g.add(ring);
  }

  const needle = new Mesh(new CylinderGeometry(0.7, 2.8, 160, 10), shell);
  needle.position.y = 470;
  g.add(needle);

  const tip = new Mesh(new SphereGeometry(1.8, 10, 10), accent);
  tip.position.y = 552;
  g.add(tip);

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
            {data.kind} · {data.floors} floors · {data.height_m} m
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
        <Metric label="Demand now" value={`${data.demand_kw.toLocaleString()} kW`} accent />
        <Metric label="Peak load" value={`${data.peak_kw.toLocaleString()} kW`} />
        <Metric label="Daily energy" value={`${data.daily_kwh.toLocaleString()} kWh`} />
        <Metric label="Annual" value={`${data.annual_mwh.toLocaleString()} MWh`} />
        <Metric label="Grid import" value={`${data.grid_import_kw.toLocaleString()} kW`} />
        <Metric label="Load factor" value={`${data.load_factor_pct}%`} />
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
        Simulated from massing height × footprint (illustrative digital twin — not metered utility
        data).
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
  const selectRef = useRef<(pick: BuildingPick | null) => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
          id: `b-${pick.buildingIndex}`,
          name: pick.name,
          kind: pick.kind,
          height_m: pick.h,
          footprint_m2: pick.footprint_m2,
          seed: pick.buildingIndex * 17 + Math.round(pick.h),
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

    const scene = new Scene();
    scene.background = new Color('#02060d');
    scene.fog = new Fog('#02060d', 500, 2600);

    const camera = new PerspectiveCamera(68, 1, 0.8, 5000);
    // Start in cinematic preview framing (farther / higher).
    camera.position.set(620, 280, 720);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return;
      if (e.code === 'KeyF' && controls?.isLocked) {
        // Inspect whatever is under the reticle
        pickAtCenter();
        return;
      }
      setKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => setKey(e.code, false);

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
      if (!controls.isLocked) {
        controls.lock();
        return;
      }
      // While flying: click = inspect building under crosshair
      pickAtCenter();
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

      if (viewMode !== 'explore' && controls.isLocked) controls.unlock();

      if (viewMode === 'preview' && ready && !zoomActive) {
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
      } else if (viewMode === 'explore' && controls.isLocked) {
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
      const showSigns = viewMode !== 'preview';
      for (const sign of signs) {
        if (!showSigns) {
          sign.visible = false;
          continue;
        }
        const anchor = sign.userData.anchor as { x: number; y: number; z: number };
        const dist = camera.position.distanceTo(sign.position);
        const visible = dist < SIGN_VISIBLE_M;
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
        const res = await fetch(MASSING_URL);
        if (!res.ok) throw new Error(`Failed to fetch massing data (${res.status})`);
        const data = (await res.json()) as MassingData;
        if (disposed) return;

        const electric = data.buildings.filter(isElectrifiedBuilding);
        setStatus(`Labeling Toronto landmarks across ${electric.length.toLocaleString()} buildings…`);
        setCredit(`${data.source} · ${data.license}`);

        await new Promise((r) => setTimeout(r, 30));
        if (disposed) return;

        const matches = matchLandmarksToBuildings(electric);
        const built = buildCityMesh(electric, matches);
        city = built.group;
        signs = built.signs;
        hitTargets = built.hitTargets;

        const cn = data.landmarks?.cnTower;
        city.add(buildCnTower(cn?.x ?? 0, cn?.z ?? 0));
        scene.add(city);
        setLabeled(matches.length);
        ready = true;
        setCityReady(true);
        setStatus('');

        // If we landed directly on explore, snap to explore framing.
        if (modeRef.current === 'explore') {
          camera.position.copy(EXPLORE_POS);
          camera.lookAt(EXPLORE_LOOK);
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
      renderer?.dispose();
      if (renderer?.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      Object.keys(MOVE).forEach((k) => {
        MOVE[k as KeyAction] = false;
      });
    };
  }, []);

  const exploreUi = mode === 'explore';

  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden bg-nc-bg">
      <div ref={mountRef} className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" />

      {exploreUi && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4">
          <div className="pointer-events-auto">
            <Link
              to="/"
              className="rounded-md border border-nc-border/80 bg-nc-panel/80 px-3 py-1.5 text-sm backdrop-blur-md transition hover:border-nc-renew"
            >
              ← NightCity
            </Link>
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

      {status && !error && mode !== 'zoom' && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-5 text-sm text-nc-muted backdrop-blur-md">
          {status}
        </div>
      )}

      {exploreUi && cityReady && !locked && !error && !status && (
        <button
          type="button"
          className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-6 text-center shadow-xl shadow-black/50 backdrop-blur-md transition hover:border-nc-renew"
          onClick={() => {
            const canvas = mountRef.current?.querySelector('canvas');
            canvas?.click();
          }}
        >
          <div className="text-2xl font-semibold">Click to fly</div>
          <div className="mt-2 text-xs text-nc-muted">
            WASD move · Space up · C down · Shift sprint · Esc release
          </div>
          <div className="mt-3 text-[11px] text-nc-renew/90">
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
          <a
            href="https://open.toronto.ca/dataset/3d-massing/"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto text-[11px] text-nc-muted underline-offset-2 hover:text-nc-text hover:underline"
          >
            open.toronto.ca/dataset/3d-massing
          </a>
          <p className="max-w-[70%] text-right text-[10px] leading-snug text-nc-muted/90">{credit}</p>
        </div>
      )}
    </div>
  );
}
