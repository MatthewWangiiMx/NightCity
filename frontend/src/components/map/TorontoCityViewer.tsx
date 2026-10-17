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
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Shape,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  ShiftLeft: 'down',
  ShiftRight: 'down',
  ControlLeft: 'sprint',
  ControlRight: 'sprint',
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
  const body = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
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

function makeShape(outer: [number, number][], holes: [number, number][][]) {
  // Shape XY → after rotateX(-90): world (x, h, z) with local +Z south.
  const shape = new Shape();
  shape.moveTo(outer[0][0], -outer[0][1]);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i][0], -outer[i][1]);
  shape.closePath();

  for (const holePts of holes) {
    if (holePts.length < 4) continue;
    const hole = new Shape();
    hole.moveTo(holePts[0][0], -holePts[0][1]);
    for (let i = 1; i < holePts.length; i++) hole.lineTo(holePts[i][0], -holePts[i][1]);
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
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

/** Dark charcoal shells + separate cool-blue window box components (no facade textures). */
function buildCityMesh(buildings: MassingBuilding[]): Group {
  const group = new Group();

  const shellMat = new MeshStandardMaterial({
    color: '#0a0e14',
    roughness: 0.92,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const shellGeos: ExtrudeGeometry[] = [];
  for (const building of buildings) {
    if (!isElectrifiedBuilding(building)) continue;
    const shape = makeShape(building.rings[0], building.rings.slice(1));
    const shell = new ExtrudeGeometry(shape, {
      depth: building.h,
      bevelEnabled: false,
      curveSegments: 1,
    });
    shell.rotateX(-Math.PI / 2);
    shell.translate(0, 0.02, 0);
    shellGeos.push(shell);
  }

  const chunk = 900;
  for (let i = 0; i < shellGeos.length; i += chunk) {
    const slice = shellGeos.slice(i, i + chunk);
    const merged = mergeGeometries(slice, false);
    slice.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeVertexNormals();
    group.add(new Mesh(merged, shellMat));
  }

  // Count, then instance — windows are real box components, not emissive textures.
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

  // Bare dark ground — no roads / grids / infrastructure.
  const ground = new Mesh(
    new PlaneGeometry(8000, 8000),
    new MeshStandardMaterial({ color: '#05070c', roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  return group;
}

/** CN Tower restyled to the same dark shell + cool accent language. */
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

  // Cool accent bands (not warm bloom pods).
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
 * Downtown Toronto from official 3D Massing — dark shells, discrete window components,
 * electrified buildings only (no street / grid infrastructure).
 */
export default function TorontoCityViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('Loading Toronto 3D Massing…');
  const [error, setError] = useState<string | null>(null);
  const [credit, setCredit] = useState('City of Toronto Open Data · 3D Massing');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let controls: PointerLockControls | null = null;
    let renderer: WebGLRenderer | null = null;
    let city: Group | null = null;

    const scene = new Scene();
    scene.background = new Color('#02060d');
    scene.fog = new Fog('#02060d', 500, 2600);

    const camera = new PerspectiveCamera(68, 1, 0.8, 5000);
    camera.position.set(80, 140, 520);
    camera.lookAt(0, 180, 0);

    renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    renderer.setClearColor(0x02060d);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    mount.appendChild(renderer.domElement);

    // Flat, dim lighting — windows carry the scene, not bloom wash.
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
    let prevTime = performance.now();
    let ready = false;

    const setKey = (code: string, down: boolean) => {
      const action = KEY_MAP[code];
      if (action) MOVE[action] = down;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return;
      setKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => setKey(e.code, false);
    const onClick = () => {
      if (ready && controls && !controls.isLocked) controls.lock();
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

      if (controls.isLocked) {
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
        setStatus(`Building ${electric.length.toLocaleString()} electrified structures…`);
        setCredit(`${data.source} · ${data.license}`);

        await new Promise((r) => setTimeout(r, 30));
        if (disposed) return;

        city = buildCityMesh(electric);
        const cn = data.landmarks?.cnTower;
        city.add(buildCnTower(cn?.x ?? 0, cn?.z ?? 0));
        scene.add(city);
        ready = true;
        setStatus('');
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
      if (city) {
        city.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
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

  return (
    <div className="relative h-screen w-full overflow-hidden bg-nc-bg">
      <div ref={mountRef} className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
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
            Electrified massing
          </div>
        </div>
      </div>

      {status && !error && (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-border/80 bg-nc-panel/85 px-8 py-5 text-sm text-nc-muted backdrop-blur-md">
          {status}
        </div>
      )}

      {!locked && !error && !status && (
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
            WASD move · Space / Shift up-down · Ctrl sprint · Esc release
          </div>
        </button>
      )}

      {error && (
        <div className="absolute left-1/2 top-1/2 z-10 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-nc-alert/50 bg-nc-panel/90 p-6 text-center backdrop-blur-md">
          <div className="text-lg font-semibold text-nc-alert">Could not load city</div>
          <p className="mt-2 text-sm text-nc-muted">{error}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-3">
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
    </div>
  );
}
