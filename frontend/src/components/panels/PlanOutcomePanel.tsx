import Panel from '@/components/Panel';
import DayLoadChart from '@/components/charts/DayLoadChart';
import type { EwrbPlanResult } from '@/api/types';

/**
 * What a plan did, shown where the consequences belong.
 *
 * Plan owns the controls; this owns the comparison. Everything here is baseline
 * against plan on the same scale, evaluated for the selected forecast day, so
 * the weather and the levers are visible in the same numbers.
 */

const FUEL = {
  elec: 'var(--color-series-demand)',
  gas: 'var(--color-series-solar)',
} as const;

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function Delta({ pct, lowerIsBetter = true }: { pct: number | null; lowerIsBetter?: boolean }) {
  if (pct == null || pct === 0) return null;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span className={`text-[11px] tabular-nums ${good ? 'text-nc-renew' : 'text-nc-flex'}`}>
      {pct > 0 ? '+' : ''}
      {num(pct, 1)}%
    </span>
  );
}

function Stat({
  label,
  value,
  unit,
  pct,
  lowerIsBetter = true,
}: {
  label: string;
  value: string;
  unit: string;
  pct?: number | null;
  lowerIsBetter?: boolean;
}) {
  return (
    <div className="rounded-lg border border-nc-border/70 bg-nc-panel/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-nc-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-nc-text">
        {value}
        <span className="ml-1 text-[10px] font-normal text-nc-muted">{unit}</span>
      </div>
      <Delta pct={pct ?? null} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

/** Annual site energy by fuel, baseline against plan on one shared scale. */
function FuelBars({ plan }: { plan: EwrbPlanResult }) {
  const max = Math.max(plan.baseline.site_mwh, plan.planned.site_mwh) || 1;
  const rows = [
    { key: 'base', label: 'Today', t: plan.baseline },
    { key: 'plan', label: 'Your plan', t: plan.planned },
  ];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-nc-muted">
          Annual site energy by fuel
        </span>
        <span className="text-[10px] text-nc-muted">MWh/yr</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-baseline justify-between text-[11px]">
              <span className="text-nc-text">{row.label}</span>
              <span className="tabular-nums text-nc-text">
                {num(row.t.site_mwh)}
                <span className="ml-1 text-[10px] text-nc-muted">
                  · {num(row.t.emissions_tco2e)} tCO₂e
                </span>
              </span>
            </div>
            <div className="flex h-4 gap-0.5">
              <div
                className="rounded-l"
                style={{ width: `${(row.t.elec_mwh / max) * 100}%`, background: FUEL.elec }}
                title={`Electricity ${num(row.t.elec_mwh)} MWh`}
              />
              {row.t.gas_mwh / max > 0.004 && (
                <div
                  className="rounded-r"
                  style={{ width: `${(row.t.gas_mwh / max) * 100}%`, background: FUEL.gas }}
                  title={`Gas ${num(row.t.gas_mwh)} MWh`}
                />
              )}
            </div>
            <div className="mt-0.5 flex gap-3 text-[10px] text-nc-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FUEL.elec }} />
                Electricity {num(row.t.elec_mwh)}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FUEL.gas }} />
                Gas {num(row.t.gas_mwh)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlanOutcomePanel({
  plan,
  className = '',
}: {
  plan: EwrbPlanResult;
  className?: string;
}) {
  const w = plan.weather;
  const dayPct =
    w?.available && w.baseline_day_site_mwh && w.day_site_mwh
      ? ((w.day_site_mwh - w.baseline_day_site_mwh) / w.baseline_day_site_mwh) * 100
      : null;
  const dayEmPct =
    w?.available && w.baseline_day_emissions_tco2e && w.day_emissions_tco2e
      ? ((w.day_emissions_tco2e - w.baseline_day_emissions_tco2e) /
          w.baseline_day_emissions_tco2e) *
        100
      : null;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* ---- The selected day, which is what the event actually costs ---- */}
      {w?.available && (
        <Panel
          title="On this day"
          subtitle={`${num(w.temp_c, 1)} °C · ${num(w.hdd, 0)} heating degree-days · ${w.driver}`}
          actions={
            <span className="rounded bg-nc-grid/15 px-2 py-1 text-[10px] uppercase tracking-wide text-nc-grid">
              Weather applied
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Energy today"
              value={num(w.baseline_day_site_mwh)}
              unit="MWh"
            />
            <Stat label="With your plan" value={num(w.day_site_mwh)} unit="MWh" pct={dayPct} />
            <Stat
              label="Emissions today"
              value={num(w.baseline_day_emissions_tco2e)}
              unit="tCO₂e"
            />
            <Stat
              label="With your plan"
              value={num(w.day_emissions_tco2e)}
              unit="tCO₂e"
              pct={dayEmPct}
            />
          </div>
          <p className="text-[10px] leading-snug text-nc-muted/80">
            Heating runs <span className="tabular-nums">{num(w.heating_vs_average, 2)}×</span> an
            average day here. {w.note}
          </p>
        </Panel>
      )}

      {/* ---- The difference, hour by hour ---- */}
      {plan.day_curve?.available && (
        <Panel
          title="Electricity through the day"
          subtitle="Baseline against your plan, on the selected day's weather"
        >
          <DayLoadChart curve={plan.day_curve} />
          <p className="text-[10px] leading-snug text-nc-muted/80">{plan.day_curve.note}</p>
        </Panel>
      )}

      {/* ---- Annual totals and the fuel shift ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Annual outcome" subtitle="Across the measured building stock">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Site energy"
              value={num(plan.planned.site_mwh)}
              unit="MWh/yr"
              pct={plan.change.site_pct}
            />
            <Stat
              label="Emissions"
              value={num(plan.planned.emissions_tco2e)}
              unit="tCO₂e/yr"
              pct={plan.change.emissions_pct}
            />
            <Stat
              label="Electrified"
              value={num(plan.planned.electrified_pct, 0)}
              unit="%"
              pct={
                plan.baseline.electrified_pct && plan.planned.electrified_pct
                  ? plan.planned.electrified_pct - plan.baseline.electrified_pct
                  : null
              }
              lowerIsBetter={false}
            />
            <Stat
              label="Peak demand"
              value={num(plan.peak?.planned_peak_mw, 1)}
              unit="MW"
              pct={plan.peak?.reduction_pct ? -plan.peak.reduction_pct : null}
            />
          </div>
          <FuelBars plan={plan} />
        </Panel>

        <Panel title="Where it comes from" subtitle="Each lever's share of the change">
          {plan.breakdown.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-nc-muted">
                  <th className="pb-1 font-medium">Lever</th>
                  <th className="pb-1 text-right font-medium">MWh</th>
                  <th className="pb-1 text-right font-medium">tCO₂e</th>
                </tr>
              </thead>
              <tbody>
                {plan.breakdown.map((row) => (
                  <tr key={row.lever} className="border-t border-nc-border/60">
                    <td className="py-1 pr-2">
                      <div className="text-nc-text">{row.label}</div>
                      <div className="text-[10px] leading-snug text-nc-muted/80">{row.detail}</div>
                    </td>
                    <td className="py-1 text-right tabular-nums text-nc-renew">
                      {num(row.delta_site_mwh)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-nc-renew">
                      {num(row.delta_tco2e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[11px] text-nc-muted">
              No levers applied — this is the stock as it stands today.
            </p>
          )}

          {plan.peak?.available && plan.peak.actions?.some((a) => a.mw > 0) && (
            <div className="mt-1 border-t border-nc-border/60 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-nc-muted">
                Peak actions
              </div>
              <ul className="space-y-0.5">
                {plan.peak.actions
                  .filter((a) => a.mw > 0)
                  .map((a) => (
                    <li key={a.action} className="flex items-baseline gap-2 text-[10px]">
                      <span className="text-nc-text">{a.label}</span>
                      <span
                        className={`rounded px-1 text-[9px] uppercase tracking-wide ${
                          a.kind === 'shed'
                            ? 'bg-nc-renew/15 text-nc-renew'
                            : 'bg-nc-grid/15 text-nc-grid'
                        }`}
                      >
                        {a.kind}
                      </span>
                      <span className="ml-auto tabular-nums text-nc-text">{num(a.mw, 2)} MW</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-1 text-[10px] leading-snug text-nc-muted/80">{plan.peak.note}</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
