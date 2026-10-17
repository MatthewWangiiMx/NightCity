import Panel from '@/components/Panel';
import type { Metrics } from '@/api/types';

const ROWS = [
  { key: 'peak_demand_mw', label: 'Peak load', unit: 'MW', betterIsLower: true },
  { key: 'renewable_share_pct', label: 'Renewable share', unit: '%', betterIsLower: false },
  { key: 'emissions_tco2e', label: 'Emissions', unit: 'tCO₂e', betterIsLower: true },
] as const;

function delta(baseline: number, plan: number, betterIsLower: boolean) {
  if (baseline === 0) return null;
  const pct = Math.round(((plan - baseline) / baseline) * 100);
  const good = betterIsLower ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, good };
}

export default function ScenarioComparison({
  baseline,
  optimized,
}: {
  baseline: Metrics;
  optimized: Metrics;
}) {
  return (
    <Panel title="Scenario Comparison" subtitle="How NightCity makes a difference">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-nc-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-nc-muted" aria-hidden />
            Baseline
          </div>
          <p className="mb-3 text-xs text-nc-muted">No coordinated response</p>
          <dl className="space-y-2">
            {ROWS.map((row) => (
              <div key={row.key}>
                <dt className="text-[11px] text-nc-muted">{row.label}</dt>
                <dd className="whitespace-nowrap text-lg font-semibold tabular-nums">
                  {Math.round(baseline[row.key])}
                  <span className="ml-1 text-xs font-normal text-nc-muted">{row.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-lg border border-nc-renew/50 bg-nc-renew/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-nc-renew">
            <span className="h-2 w-2 rounded-full bg-nc-renew" aria-hidden />
            NightCity plan
          </div>
          <p className="mb-3 text-xs text-nc-muted">AI-optimized dispatch</p>
          <dl className="space-y-2">
            {ROWS.map((row) => {
              const d = delta(baseline[row.key], optimized[row.key], row.betterIsLower);
              return (
                <div key={row.key}>
                  <dt className="text-[11px] text-nc-muted">{row.label}</dt>
                  <dd className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="text-lg font-semibold tabular-nums">
                      {Math.round(optimized[row.key])}
                      <span className="ml-1 text-xs font-normal text-nc-muted">{row.unit}</span>
                    </span>
                    {d && (
                      <span
                        className={`text-xs tabular-nums ${d.good ? 'text-nc-renew' : 'text-nc-flex'}`}
                      >
                        {d.text}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
      <p className="text-[11px] text-nc-muted">
        Both columns run on identical inputs; only the dispatch plan differs.
      </p>
    </Panel>
  );
}
