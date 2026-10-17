import type { Asset, District } from '@/api/types';

/**
 * Isometric district scene.
 *
 * Skeleton: assets are positioned from normalized 0..1 coords onto an SVG
 * canvas. TODO: isometric projection, animated flow paths (cyan = grid,
 * green = renewable, amber = flexible load, red = disruption), click-through
 * to Building Detail.
 */
export default function DistrictMap({
  district,
  onSelectAsset,
}: {
  district?: District;
  onSelectAsset?: (asset: Asset) => void;
}) {
  return (
    <div className="relative flex-1 rounded-xl border border-nc-border bg-[radial-gradient(ellipse_at_50%_30%,#0d2f3f,#06131c)] overflow-hidden">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {/* TODO: flow paths rendered from district.flows */}
      </svg>
      {district?.assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onSelectAsset?.(asset)}
          style={{ left: `${asset.x * 100}%`, top: `${asset.y * 100}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-nc-border bg-nc-panel/90 px-3 py-2 text-left text-xs hover:border-nc-grid"
        >
          <div className="font-medium">{asset.name}</div>
          <div className="text-nc-muted">{asset.capacity_mw} MW</div>
        </button>
      ))}
      {!district && (
        <div className="absolute inset-0 grid place-items-center text-xs text-nc-muted">
          District map — awaiting /api/district
        </div>
      )}
    </div>
  );
}
