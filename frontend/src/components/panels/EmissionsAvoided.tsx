import Panel from '@/components/Panel';
import type { Metrics } from '@/api/types';

/** One headline number — a stat tile, not a chart. */
export default function EmissionsAvoided({
  baseline,
  optimized,
}: {
  baseline: Metrics;
  optimized: Metrics;
}) {
  const avoided = Math.round(baseline.emissions_tco2e - optimized.emissions_tco2e);
  // Rough equivalence, declared as an estimate: ~0.02 tCO2e per tree per year.
  const trees = Math.round((avoided / 0.02) / 100) * 100;

  return (
    <Panel title="Emissions Avoided" subtitle="Estimate: grid import × declared factor">
      <div>
        <div className="text-4xl font-semibold text-nc-renew">
          {avoided}
          <span className="ml-1 text-sm font-normal text-nc-muted">tCO₂e</span>
        </div>
        <p className="text-xs text-nc-muted">in this scenario, versus baseline</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-nc-border bg-nc-bg/40 px-3 py-2 text-xs text-nc-muted">
        <span className="text-nc-renew" aria-hidden>
          ❧
        </span>
        ≈ {trees.toLocaleString()} trees for 1 year
      </div>
    </Panel>
  );
}
