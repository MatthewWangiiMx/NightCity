import Panel from '@/components/Panel';
import { useEwrbLiveDistrict, useEwrbSummary } from '@/hooks/useEwrb';

/**
 * What the district's real building stock reports, next to what the simulator
 * is doing to it.
 *
 * The Simulate page is otherwise entirely synthetic: a scenario, a dispatch
 * plan, a time series the optimizer produced. This panel is the one fixed
 * reference point - annual intensities that operators actually filed with
 * Ontario's EWRB programme - so a viewer can judge whether the simulated
 * baseline is in the right range at all.
 *
 * Absolute totals need floor area, which EWRB does not publish, so the
 * MWh/tCO2e block only appears when TigerData can supply the massing. Without
 * it the panel still shows every reported intensity.
 */

function Stat({
  label,
  value,
  unit,
  accent,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-nc-border/70 bg-nc-panel/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-nc-muted">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          accent ? 'text-cyan-300' : 'text-nc-text'
        }`}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-nc-muted">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] leading-snug text-nc-muted/80">{hint}</div>}
    </div>
  );
}

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function ReportedStockPanel({
  city = 'Toronto',
  className = '',
}: {
  city?: string;
  className?: string;
}) {
  const { summary, status } = useEwrbSummary(city);
  const { rollup, status: rollupStatus } = useEwrbLiveDistrict(city);

  const eui = summary?.metrics.site_eui_kwh_m2;
  const ghg = summary?.metrics.ghg_kg_m2;
  const star = summary?.metrics.energy_star_score;
  const water = summary?.metrics.water_m3_m2;

  if (status === 'unavailable') {
    return (
      <Panel
        title="Reported building stock"
        subtitle="Ontario EWRB — dataset not loaded"
        className={className}
      >
        <p className="text-[11px] leading-snug text-nc-muted">
          Drop the published EWRB extract at{' '}
          <code className="rounded bg-nc-panel-2 px-1">
            backend/data/odc_final_dataset_2024.csv
          </code>{' '}
          to benchmark the simulated baseline against buildings that actually reported.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Reported building stock"
      subtitle={
        summary
          ? `Ontario EWRB · ${num(summary.sample_size)} ${city} properties reported`
          : 'Ontario EWRB'
      }
      className={className}
      actions={
        <span className="rounded bg-nc-renew/15 px-2 py-1 text-[10px] uppercase tracking-wide text-nc-renew">
          Measured
        </span>
      }
    >
      {status === 'loading' && (
        <div className="grid grid-cols-2 gap-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-nc-panel-2" />
          ))}
        </div>
      )}

      {status === 'ready' && summary && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Median site EUI"
              value={num(eui?.median)}
              unit="kWh/m²·yr"
              accent
              hint={eui ? `middle half ${num(eui.p25)}–${num(eui.p75)}` : undefined}
            />
            <Stat
              label="Median emissions"
              value={num(ghg?.median, 1)}
              unit="kg CO₂e/m²·yr"
              hint={ghg ? `${num(ghg.n)} reported` : undefined}
            />
            <Stat
              label="Median ENERGY STAR"
              value={num(star?.median)}
              unit="/100"
              hint={star ? `${num(star.n)} scored` : undefined}
            />
            <Stat
              label="Median water"
              value={num(water?.median, 2)}
              unit="m³/m²·yr"
              hint={water ? `${num(water.n)} reported` : undefined}
            />
          </div>

          {/* Property-type mix: what this district is actually made of */}
          {summary.property_type_mix.length > 0 && (
            <div className="mt-1">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-nc-muted">
                Reported property mix
              </div>
              <ul className="space-y-1">
                {summary.property_type_mix.slice(0, 4).map((row) => {
                  const pct = (row.count / summary.sample_size) * 100;
                  return (
                    <li key={row.property_type} className="text-[11px]">
                      <div className="flex justify-between gap-2">
                        <span className="truncate text-nc-text">{row.property_type}</span>
                        <span className="shrink-0 tabular-nums text-nc-muted">
                          {num(row.count)} · {num(pct)}%
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-nc-panel-2">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: 'var(--color-series-demand)',
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Absolute totals, only where a floor area exists to apply them to */}
          {rollupStatus === 'ready' && rollup ? (
            <div className="mt-1 rounded-lg border border-nc-border/70 bg-nc-panel/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-nc-muted">
                Applied to {num(rollup.buildings)} mapped buildings
              </div>
              <dl className="mt-1.5 space-y-1 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-nc-muted">Annual electricity</dt>
                  <dd className="tabular-nums text-nc-text">
                    {num(rollup.annual.elec_mwh)} MWh
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-nc-muted">Annual emissions</dt>
                  <dd className="tabular-nums text-nc-text">
                    {num(rollup.annual.emissions_tco2e)} tCO₂e
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-nc-muted">Coincident peak</dt>
                  <dd className="tabular-nums text-nc-text">
                    {num(rollup.demand.peak_mw, 1)} MW
                    {rollup.peak_hour != null && (
                      <span className="ml-1 text-nc-muted">
                        @ {String(rollup.peak_hour).padStart(2, '0')}:00
                      </span>
                    )}
                  </dd>
                </div>
                {rollup.demand.diversity_factor != null && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-nc-muted">Diversity factor</dt>
                    <dd className="tabular-nums text-nc-text">
                      {num(rollup.demand.diversity_factor, 2)}
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-1.5 text-[10px] leading-snug text-nc-muted/80">
                Totals are reported intensity × massing floor area. The demand shape behind
                the peak is modelled — EWRB reports annual totals only.
              </p>
            </div>
          ) : (
            <p className="text-[10px] leading-snug text-nc-muted/80">
              Intensities are reported per m². Absolute MWh and tCO₂e need floor area from
              TigerData massing, which is not loaded.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
