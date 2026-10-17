import { useEffect, useRef, useState } from 'react';
import type { Asset, District, EnergyFlow } from '@/api/types';

/**
 * The district twin: a night harbour city under a setting sun, drawn as one
 * isometric SVG scene with animated energy flows over it.
 *
 * All geometry is deterministic — no random seeds — so the scene is identical
 * on every render and across reruns. Asset chips are HTML on top of the SVG,
 * which keeps their text crisp at any scale.
 */

const W = 1200;
const H = 700;
const HORIZON = 250;

/** Normalized 0..1 asset coords → SVG user space. */
const px = (x: number) => x * W;
const py = (y: number) => y * H;

/** Ground plane projection. */
const ISO = { cx: 600, cy: 360, tile: 52, squash: 0.52 };
function iso(col: number, row: number, lift = 0) {
  return {
    x: ISO.cx + (col - row) * ISO.tile,
    y: ISO.cy + (col + row) * ISO.tile * ISO.squash - lift,
  };
}

/** col, row, height, how lit the windows are. Taller towers cluster downtown. */
const BLOCKS: [number, number, number, number][] = [
  [-3, -2, 52, 0.55], [-2, -2, 78, 0.7], [-1, -2, 110, 0.85], [0, -2, 64, 0.6], [1, -2, 44, 0.5],
  [-3, -1, 70, 0.65], [-2, -1, 126, 0.95], [-1, -1, 168, 1], [0, -1, 132, 0.95], [1, -1, 86, 0.75],
  [-2, 0, 104, 0.85], [-1, 0, 186, 1], [0, 0, 214, 1], [1, 0, 148, 0.95], [2, 0, 72, 0.65],
  [-3, 1, 58, 0.6], [-2, 1, 118, 0.9], [-1, 1, 160, 1], [0, 1, 124, 0.9], [1, 1, 92, 0.8], [2, 1, 54, 0.55],
  [-2, 2, 62, 0.6], [-1, 2, 96, 0.8], [0, 2, 74, 0.7], [1, 2, 48, 0.5],
  [-1, 3, 46, 0.45], [0, 3, 56, 0.55],
  // Outer low-rise, so downtown reads as a centre rather than an island
  [-4, -1, 26, 0.4], [-4, 1, 24, 0.35], [3, -1, 28, 0.4], [3, 1, 22, 0.35],
  [-3, 3, 20, 0.3], [2, 3, 24, 0.35], [-4, 2, 18, 0.3], [3, 2, 20, 0.3],
];

const FLOW_COLOR: Record<string, string> = {
  solar_farm: 'var(--color-nc-renew)',
  wind: 'var(--color-nc-renew)',
  battery: 'var(--color-nc-grid)',
  grid: 'var(--color-nc-grid)',
  city: 'var(--color-nc-flex)',
  ev: 'var(--color-nc-flex)',
};

const ASSET_ICON: Record<Asset['kind'], string> = {
  solar: '☀',
  wind: '⌁',
  battery: '▮',
  ev_charging: '⚡',
  building: '▣',
  grid_tie: '⌂',
};

function Tower({ col, row, height, lit }: { col: number; row: number; height: number; lit: number }) {
  const base = iso(col, row);
  const top = iso(col, row, height);
  const t = ISO.tile * 0.86;
  const s = ISO.tile * ISO.squash * 0.86;

  const topFace = `${top.x},${top.y} ${top.x + t},${top.y + s} ${top.x},${top.y + 2 * s} ${top.x - t},${top.y + s}`;
  const leftFace = `${top.x - t},${top.y + s} ${top.x},${top.y + 2 * s} ${base.x},${base.y + 2 * s} ${base.x - t},${base.y + s}`;
  const rightFace = `${top.x},${top.y + 2 * s} ${top.x + t},${top.y + s} ${base.x + t},${base.y + s} ${base.x},${base.y + 2 * s}`;

  const floors = Math.max(2, Math.floor(height / 18));
  const windows = Array.from({ length: floors }, (_, i) => {
    const y = top.y + s + i * 18 + 9;
    const warm = i % 4 === 0;
    return (
      <g key={i} opacity={lit * (i % 3 === 0 ? 0.95 : 0.6)}>
        <rect x={top.x - t + 12} y={y} width={6} height={4} fill={warm ? '#ffd79a' : '#7fe3ff'} />
        <rect x={top.x - t + 26} y={y + 5} width={6} height={4} fill="#9bf0d4" />
        <rect x={top.x + 8} y={y + 2} width={6} height={4} fill="#7fe3ff" />
        <rect x={top.x + 22} y={y + 7} width={6} height={4} fill={warm ? '#ffd79a' : '#cfe9ff'} />
      </g>
    );
  });

  return (
    <g>
      <polygon points={leftFace} fill="#0a2333" stroke="#1b4e68" strokeWidth={1} />
      <polygon points={rightFace} fill="#071b28" stroke="#1b4e68" strokeWidth={1} />
      <polygon points={topFace} fill="#15415a" stroke="#2a79a0" strokeWidth={1} />
      {windows}
      {height > 140 && (
        <circle cx={top.x} cy={top.y + s - 2} r={2.5} fill="var(--color-nc-alert)" className="nc-pulse" />
      )}
    </g>
  );
}

/** Tilted photovoltaic rows on the western shore. */
function SolarFarm() {
  const rows = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 6 }, (_, c) => {
      const x = 96 + c * 34 + r * 16;
      const y = 352 + r * 20;
      return (
        <g key={`${r}:${c}`}>
          <polygon
            points={`${x},${y} ${x + 26},${y - 7} ${x + 30},${y + 5} ${x + 4},${y + 12}`}
            fill="#1f5e9e"
            stroke="#4aa3e8"
            strokeWidth={0.8}
          />
          <line x1={x + 8} y1={y + 1} x2={x + 28} y2={y - 4} stroke="#7cc4f5" strokeWidth={0.5} opacity={0.7} />
        </g>
      );
    }),
  );
  return <g opacity={0.95}>{rows}</g>;
}

function Turbine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <line x1={0} y1={0} x2={0} y2={-46} stroke="#bfe6f5" strokeWidth={2} opacity={0.85} />
      <g stroke="#e6f6ff" strokeWidth={2} opacity={0.9}>
        <line x1={0} y1={-46} x2={0} y2={-70} />
        <line x1={0} y1={-46} x2={20} y2={-34} />
        <line x1={0} y1={-46} x2={-20} y2={-34} />
      </g>
      <circle cx={0} cy={-46} r={2.5} fill="#9bf0d4" />
    </g>
  );
}

function Flow({ flow, assets }: { flow: EnergyFlow; assets: Map<string, Asset> }) {
  const from = assets.get(flow.from_asset);
  const to = assets.get(flow.to_asset);
  if (!from || !to) return null;

  const x1 = px(from.x);
  const y1 = py(from.y);
  const x2 = px(to.x);
  const y2 = py(to.y);
  const d = `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - 48} ${x2} ${y2}`;
  const color = FLOW_COLOR[flow.from_asset] ?? 'var(--color-nc-grid)';

  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={7} filter="url(#neon)" />
      <path d={d} fill="none" stroke={color} strokeWidth={2.2} className="nc-flow" />
    </g>
  );
}

/**
 * The SVG is drawn with `slice`, so it crops rather than letterboxes at any
 * container shape. Chips therefore cannot be placed in percentages — they are
 * projected through the same scale-and-centre transform the browser applies.
 */
function useSliceTransform(ref: React.RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  const scale = box.w && box.h ? Math.max(box.w / W, box.h / H) : 0;
  return {
    ready: scale > 0,
    project: (x: number, y: number) => {
      const left = (box.w - W * scale) / 2 + px(x) * scale;
      const top = (box.h - H * scale) / 2 + py(y) * scale;
      // Keep chips inside a cropped view instead of letting them clip at an edge.
      const clamp = (v: number, limit: number, margin: number) =>
        Math.min(Math.max(v, margin), limit - margin);
      return { left: clamp(left, box.w, 62), top: clamp(top, box.h, 24) };
    },
  };
}

export default function DistrictMap({
  district,
  onSelectAsset,
  className = 'relative',
}: {
  district?: District;
  onSelectAsset?: (asset: Asset) => void;
  /** Must include a position utility — the chips are absolutely placed inside. */
  className?: string;
}) {
  const assets = new Map((district?.assets ?? []).map((a) => [a.id, a]));
  const ref = useRef<HTMLDivElement>(null);
  const { ready, project } = useSliceTransform(ref);

  return (
    <div
      ref={ref}
      className={`overflow-hidden rounded-xl border border-nc-border bg-nc-bg ${className}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d1b3a" />
            <stop offset="55%" stopColor="#2a3566" />
            <stop offset="85%" stopColor="#7c4a6a" />
            <stop offset="100%" stopColor="#d9815a" />
          </linearGradient>
          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d3f5e" />
            <stop offset="100%" stopColor="#0a1f2e" />
          </linearGradient>
          <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0b2432" />
            <stop offset="100%" stopColor="#05141d" />
          </linearGradient>
          <radialGradient id="sunGlow" cx="86%" cy="100%" r="45%">
            <stop offset="0%" stopColor="#ffb47a" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ffb47a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cityGlow" cx="50%" cy="52%" r="42%">
            <stop offset="0%" stopColor="#2e9fc4" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#2e9fc4" stopOpacity="0" />
          </radialGradient>
          <filter id="neon" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Sky, sun, ridgeline */}
        <rect width={W} height={HORIZON + 30} fill="url(#sky)" />
        <rect width={W} height={HORIZON + 30} fill="url(#sunGlow)" />
        <circle cx={1040} cy={206} r={34} fill="#ffd3a0" opacity={0.9} filter="url(#neon)" />
        <polygon
          points="0,196 90,132 170,186 260,116 360,190 470,140 560,200 660,150 780,206 900,138 1010,196 1120,150 1200,204 1200,262 0,262"
          fill="#111f3f"
          opacity={0.92}
        />
        <polygon
          points="0,224 120,176 240,222 340,180 460,228 600,190 720,232 860,188 980,230 1100,192 1200,232 1200,268 0,268"
          fill="#0b1830"
        />

        {/* Harbour */}
        <rect y={HORIZON} width={W} height={120} fill="url(#water)" />
        <g stroke="#6fd9f0" strokeOpacity={0.3} strokeWidth={1.5}>
          {[262, 276, 292, 308, 324, 342].map((y, i) => (
            <line key={y} x1={300 - i * 40} y1={y} x2={760 + i * 50} y2={y} strokeDasharray="18 26" />
          ))}
        </g>
        {/* Sun track on the water, under the sun itself */}
        <g opacity={0.55} stroke="#ffb47a" strokeWidth={2}>
          {[262, 280, 298, 318].map((y, i) => (
            <line key={y} x1={1040 - 14 - i * 10} y1={y} x2={1040 + 14 + i * 10} y2={y} strokeDasharray="12 16" />
          ))}
        </g>

        {/* Shoreline + land */}
        <clipPath id="landClip">
          <path d={`M 0 330 Q 300 300 620 318 T 1200 330 L 1200 ${H} L 0 ${H} Z`} />
        </clipPath>
        <path
          d={`M 0 330 Q 300 300 620 318 T 1200 330 L 1200 ${H} L 0 ${H} Z`}
          fill="url(#land)"
        />
        <path
          d="M 0 330 Q 300 300 620 318 T 1200 330"
          fill="none"
          stroke="#3fd0f5"
          strokeOpacity={0.35}
          strokeWidth={2}
          filter="url(#neon)"
        />
        <rect width={W} height={H} fill="url(#cityGlow)" />

        <SolarFarm />
        {/* Offshore wind, standing in the bay above the shoreline */}
        <Turbine x={766} y={300} scale={1.05} />
        <Turbine x={836} y={312} />
        <Turbine x={906} y={296} scale={0.9} />
        <Turbine x={712} y={314} scale={0.8} />

        {/* Treeline softening the land edges */}
        <g fill="#0a2a24" opacity={0.75}>
          {[
            [40, 486], [74, 508], [110, 478], [28, 552], [92, 572],
            [1136, 446], [1100, 476], [1156, 512], [1068, 534], [1132, 578],
          ].map(([x, y]) => (
            <polygon key={`${x}:${y}`} points={`${x},${y} ${x + 8},${y + 15} ${x - 8},${y + 15}`} />
          ))}
        </g>

        {/* Street grid, glowing — clipped to land so it never runs into the bay */}
        <g filter="url(#neon)" clipPath="url(#landClip)">
          <g stroke="#3fd0f5" strokeOpacity={0.38} strokeWidth={1.6}>
            {Array.from({ length: 11 }, (_, i) => {
              const a = iso(i - 5, -4);
              const b = iso(i - 5, 5);
              return <line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
            {Array.from({ length: 11 }, (_, i) => {
              const a = iso(-5, i - 4);
              const b = iso(5, i - 4);
              return <line key={`r${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </g>
          {/* Two main avenues read brighter than the side streets */}
          <g stroke="#7af0ff" strokeOpacity={0.75} strokeWidth={2.4}>
            <line x1={iso(0, -4).x} y1={iso(0, -4).y} x2={iso(0, 5).x} y2={iso(0, 5).y} />
            <line x1={iso(-5, 0).x} y1={iso(-5, 0).y} x2={iso(5, 0).x} y2={iso(5, 0).y} />
          </g>
        </g>

        {/* Skyline, back to front */}
        {[...BLOCKS]
          .sort((a, b) => a[0] + a[1] - (b[0] + b[1]))
          .map(([col, row, height, lit]) => (
            <Tower key={`${col}:${row}`} col={col} row={row} height={height} lit={lit} />
          ))}

        {/* Battery yard and EV pad */}
        <g transform="translate(980 372)">
          <polygon points="0,0 46,13 46,37 0,24" fill="#0e3042" stroke="#2a79a0" />
          <polygon points="46,13 86,-2 86,22 46,37" fill="#0a2534" stroke="#2a79a0" />
          <polygon points="0,0 40,-15 86,-2 46,13" fill="#174a63" stroke="#3fd0f5" />
          <rect x={10} y={8} width={26} height={4} rx={2} fill="var(--color-nc-renew)" />
        </g>
        <g transform="translate(190 520)">
          <polygon points="0,0 70,-22 130,-4 60,18" fill="#0d2a38" stroke="#2a79a0" />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${24 + i * 30} ${-2 - i * 6})`}>
              <rect x={0} y={-14} width={7} height={14} rx={2} fill="#123a4e" stroke="#3fd0f5" />
              <circle cx={3.5} cy={-10} r={1.8} fill="var(--color-nc-flex)" />
            </g>
          ))}
        </g>

        {/* Energy flows */}
        {(district?.flows ?? []).map((flow) => (
          <Flow key={flow.id} flow={flow} assets={assets} />
        ))}

        {/* Marker glow under each HTML chip */}
        {(district?.assets ?? []).map((a) => (
          <circle
            key={a.id}
            cx={px(a.x)}
            cy={py(a.y)}
            r={16}
            fill="var(--color-nc-grid)"
            opacity={0.22}
            className="nc-pulse"
          />
        ))}
      </svg>

      {ready &&
        district?.assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onSelectAsset?.(asset)}
          style={project(asset.x, asset.y)}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-nc-border/80 bg-nc-panel/85 px-2.5 py-1.5 text-left text-[11px] shadow-lg shadow-black/40 backdrop-blur-sm transition hover:border-nc-grid hover:bg-nc-panel"
        >
          <div className="flex items-center gap-1.5 font-medium whitespace-nowrap">
            <span className="text-nc-grid" aria-hidden>
              {ASSET_ICON[asset.kind]}
            </span>
            {asset.name}
          </div>
          <div className="text-nc-muted">{asset.capacity_mw} MW</div>
        </button>
      ))}

      {!district && (
        <div className="absolute inset-0 grid place-items-center text-xs text-nc-muted">
          District map — awaiting data
        </div>
      )}
    </div>
  );
}
