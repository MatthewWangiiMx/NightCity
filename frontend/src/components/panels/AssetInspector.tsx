import { Link } from 'react-router-dom';
import Panel from '@/components/Panel';
import type { Asset, District, TimeStep } from '@/api/types';

const KIND_LABEL: Record<Asset['kind'], string> = {
  solar: 'Solar generation',
  wind: 'Wind generation',
  battery: 'Storage',
  ev_charging: 'Flexible load',
  building: 'Load + flexibility',
  grid_tie: 'Import / export',
};

/** Live output for an asset at the scrubbed step, from the deterministic series. */
function outputAt(asset: Asset, step?: TimeStep): number | null {
  if (!step) return null;
  switch (asset.kind) {
    case 'solar':
      return step.solar_mw;
    case 'wind':
      return step.wind_mw;
    case 'battery':
      return step.battery_mw;
    case 'building':
      return step.demand_mw;
    case 'grid_tie':
      return step.grid_import_mw;
    default:
      return null;
  }
}

export default function AssetInspector({
  district,
  asset,
  step,
  onSelect,
}: {
  district: District;
  asset: Asset | null;
  step?: TimeStep;
  onSelect: (asset: Asset | null) => void;
}) {
  if (!asset) {
    return (
      <Panel title="Asset Inspector" subtitle="Pick anything on the map to inspect it">
        <ul className="space-y-1.5">
          {district.assets.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a)}
                className="flex w-full items-baseline justify-between rounded-lg border border-nc-border px-3 py-2 text-left text-sm transition hover:border-nc-grid"
              >
                <span>{a.name}</span>
                <span className="text-xs tabular-nums text-nc-muted">{a.capacity_mw} MW</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  const output = outputAt(asset, step);
  const utilization = output !== null ? Math.round((Math.abs(output) / asset.capacity_mw) * 100) : null;
  const inbound = district.flows.filter((f) => f.to_asset === asset.id);
  const outbound = district.flows.filter((f) => f.from_asset === asset.id);
  const nameOf = (id: string) => district.assets.find((a) => a.id === id)?.name ?? id;

  return (
    <Panel
      title="Asset Inspector"
      subtitle={KIND_LABEL[asset.kind]}
      actions={
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-[11px] text-nc-muted hover:text-nc-text"
        >
          Clear
        </button>
      }
    >
      <div>
        <h3 className="text-lg font-semibold">{asset.name}</h3>
        <p className="text-xs text-nc-muted">Rated {asset.capacity_mw} MW</p>
      </div>

      {output !== null && (
        <div className="rounded-lg border border-nc-border bg-nc-bg/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-nc-muted">At this step</div>
          <div className="text-2xl font-semibold tabular-nums">
            {Math.round(output)}
            <span className="ml-1 text-sm font-normal text-nc-muted">MW</span>
          </div>
          {utilization !== null && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-nc-panel-2">
                <div
                  className="h-full rounded-full bg-nc-grid"
                  style={{ width: `${Math.min(utilization, 100)}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-nc-muted">{utilization}% of rated capacity</div>
            </>
          )}
        </div>
      )}

      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-nc-muted">Receiving from</dt>
          <dd>{inbound.length ? inbound.map((f) => `${nameOf(f.from_asset)} (${f.mw} MW)`).join(', ') : '—'}</dd>
        </div>
        <div>
          <dt className="text-nc-muted">Sending to</dt>
          <dd>{outbound.length ? outbound.map((f) => `${nameOf(f.to_asset)} (${f.mw} MW)`).join(', ') : '—'}</dd>
        </div>
      </dl>

      {asset.kind === 'building' && (
        <Link
          to={`/building/${asset.id}`}
          className="rounded-lg border border-nc-border px-3 py-2 text-center text-xs transition hover:border-nc-grid"
        >
          Open building detail (WattWise) →
        </Link>
      )}
    </Panel>
  );
}
