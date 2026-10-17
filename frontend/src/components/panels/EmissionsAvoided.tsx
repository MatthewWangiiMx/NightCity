import Panel from '@/components/Panel';
import type { Metrics } from '@/api/types';

export default function EmissionsAvoided({
  baseline,
  optimized,
}: {
  baseline?: Metrics;
  optimized?: Metrics;
}) {
  const avoided =
    baseline && optimized ? baseline.emissions_tco2e - optimized.emissions_tco2e : undefined;
  return (
    <Panel title="Emissions Avoided" subtitle="Estimate: grid import x declared factor">
      <div className="text-3xl font-semibold text-nc-renew">
        {avoided === undefined ? '—' : avoided.toFixed(0)}
        <span className="ml-1 text-sm font-normal text-nc-muted">tCO2e</span>
      </div>
      <p className="text-xs text-nc-muted">In this scenario, versus the baseline run.</p>
    </Panel>
  );
}
