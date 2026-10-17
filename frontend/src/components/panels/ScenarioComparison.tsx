import Panel from '@/components/Panel';
import MetricTile from '@/components/MetricTile';
import type { Metrics } from '@/api/types';

const fmt = (v: number | undefined, digits = 0) => (v === undefined ? '—' : v.toFixed(digits));

function Column({ title, note, metrics }: { title: string; note: string; metrics?: Metrics }) {
  return (
    <div className="flex-1 rounded-lg border border-nc-border p-3">
      <div className="text-sm font-medium">{title}</div>
      <div className="mb-3 text-xs text-nc-muted">{note}</div>
      <div className="space-y-3">
        <MetricTile label="Peak load" value={fmt(metrics?.peak_demand_mw)} unit="MW" />
        <MetricTile label="Renewable share" value={fmt(metrics?.renewable_share_pct)} unit="%" />
        <MetricTile label="Emissions" value={fmt(metrics?.emissions_tco2e)} unit="tCO2e" />
        <MetricTile
          label="Comfort violations"
          value={fmt(metrics?.comfort_violation_minutes)}
          unit="min"
        />
      </div>
    </div>
  );
}

export default function ScenarioComparison({
  baseline,
  optimized,
}: {
  baseline?: Metrics;
  optimized?: Metrics;
}) {
  return (
    <Panel title="Scenario Comparison" subtitle="Same inputs, with and without coordination">
      <div className="flex gap-3">
        <Column title="Baseline" note="No coordinated response" metrics={baseline} />
        <Column title="NightCity plan" note="Optimized dispatch" metrics={optimized} />
      </div>
    </Panel>
  );
}
