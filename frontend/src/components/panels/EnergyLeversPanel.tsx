import { useEffect, useRef, useState, type ReactNode } from 'react';
import Panel from '@/components/Panel';
import InfoTip, { TipNote } from '@/components/InfoTip';
import { api } from '@/api/client';
import type { EwrbLevers, EwrbPlanDay, EwrbPlanResult } from '@/api/types';

/**
 * The Plan page's levers, run against reported building energy.
 *
 * Every knob here changes kWh consumed, not where the kWh comes from. That is
 * the difference from a supply-mix slider, which moves emissions per kWh and
 * leaves consumption exactly where it was.
 *
 * The fuel split is the chart that matters, because 70% of a median Toronto
 * building's site energy is gas and gas carries 4.5x the carbon per kWh. The
 * two bars make the trade visible: electrifying heat grows the blue bar a
 * little while removing the amber one entirely, and the total shrinks because
 * a heat pump delivers more heat than the energy it draws.
 */

const DEFAULTS: EwrbLevers = {
  heat_pump_pct: 0,
  heat_pump_cop: 3,
  retrofit_pct: 0,
  retrofit_target_percentile: 25,
  setpoint_widen_c: 0,
  lighting_retrofit_pct: 0,
  flex_ev_pct: 0,
  flex_hvac_pct: 0,
  flex_industrial_pct: 0,
  air_quality_floor_pct: 100,
  lighting_floor_pct: 100,
};

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function Lever({
  label,
  hint,
  tip,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '%',
}: {
  label: string;
  hint: string;
  /** Longer explanation behind the question mark. */
  tip?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-nc-text">
          {label}
          {tip && <InfoTip title={label}>{tip}</InfoTip>}
        </span>
        <span className="tabular-nums text-cyan-300">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
      <span className="block text-[10px] leading-snug text-nc-muted">{hint}</span>
    </label>
  );
}

function Outcome({
  label,
  value,
  unit,
  deltaPct,
  lowerIsBetter = true,
}: {
  label: string;
  value: string;
  unit: string;
  deltaPct: number | null;
  lowerIsBetter?: boolean;
}) {
  const good = deltaPct == null ? false : lowerIsBetter ? deltaPct < 0 : deltaPct > 0;
  return (
    <div className="rounded-lg border border-nc-border/70 bg-nc-panel/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-nc-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-nc-text">
        {value}
        <span className="ml-1 text-[10px] font-normal text-nc-muted">{unit}</span>
      </div>
      {deltaPct != null && deltaPct !== 0 && (
        <div className={`text-[11px] tabular-nums ${good ? 'text-nc-renew' : 'text-nc-flex'}`}>
          {deltaPct > 0 ? '+' : ''}
          {num(deltaPct, 1)}%
        </div>
      )}
    </div>
  );
}

export default function EnergyLeversPanel({
  city = 'Toronto',
  className = '',
  extra,
  day,
  initialLevers,
  onPlanChange,
}: {
  city?: string;
  className?: string;
  /** Comfort floors and flexibility, owned by the Plan page's other panels. */
  extra?: Partial<EwrbLevers>;
  /** The forecast day to evaluate against; omitted means annual only. */
  day?: Partial<EwrbPlanDay> | null;
  /**
   * Where the sliders start. Used when returning from the results page so the
   * plan is picked up where it was left, not reset to zero. Read once on mount
   * — later changes belong to the user's dragging, not to the prop.
   */
  initialLevers?: Partial<EwrbLevers> | null;
  /** Lets the page hand the current plan to an Apply action. */
  onPlanChange?: (levers: EwrbLevers, plan: EwrbPlanResult | null) => void;
}) {
  const [levers, setLevers] = useState<EwrbLevers>({ ...DEFAULTS, ...initialLevers });
  const [plan, setPlan] = useState<EwrbPlanResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  // Plan rebuilds `extra` every render; key on its values, not its identity.
  const extraKey = JSON.stringify(extra ?? {});
  const dayKey = JSON.stringify(day ?? {});

  // Debounced: dragging a slider fires continuously and each call rebuilds
  // every building profile server-side.
  useEffect(() => {
    const token = ++requestId.current;
    const merged: EwrbLevers = { ...levers, ...extra };
    const timer = setTimeout(() => {
      api
        .ewrbPlan(merged, city, day)
        .then((res) => {
          if (token !== requestId.current) return;
          setPlan(res);
          setStatus('ready');
          onPlanChange?.(merged, res);
        })
        .catch((err: unknown) => {
          if (token !== requestId.current) return;
          setPlan(null);
          setError(err instanceof Error ? err.message : String(err));
          setStatus('unavailable');
        });
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levers, extraKey, dayKey, city]);

  const set = <K extends keyof EwrbLevers>(key: K, value: EwrbLevers[K]) =>
    setLevers((prev) => ({ ...prev, [key]: value }));

  if (status === 'unavailable') {
    return (
      <Panel title="Energy levers" subtitle="Needs the EWRB dataset and massing" className={className}>
        <p className="text-[11px] leading-snug text-nc-muted">
          Absolute savings need reported intensity from EWRB and floor area from TigerData.
          Start the backend with <code className="rounded bg-nc-panel-2 px-1">USE_DATABASE=true</code>{' '}
          and the dataset in <code className="rounded bg-nc-panel-2 px-1">backend/data/</code>.
        </p>
        {error && (
          <p className="text-[10px] leading-snug text-nc-alert">
            <span className="uppercase tracking-wide">Request failed:</span> {error}
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title="Energy levers"
      subtitle={
        plan
          ? `${num(plan.buildings)} buildings · ${num(plan.gross_floor_area_m2 / 1e6, 1)}M m²`
          : 'Measured building stock'
      }
      className={className}
      actions={
        <button
          type="button"
          onClick={() => setLevers(DEFAULTS)}
          className="rounded-md border border-nc-border px-2 py-1 text-[10px] uppercase tracking-wide text-nc-muted transition hover:border-nc-renew hover:text-nc-text"
        >
          Reset
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- The knobs ---- */}
        <div className="space-y-4">
          <Lever
            label="Heat pump conversion"
            tip={
              <>
                Swaps gas boilers for electric heat pumps across this share of the
                district's heating.
                <br />
                A boiler turns 1 kWh of gas into about 0.85 kWh of heat. A heat pump
                moves roughly 3 kWh of heat per kWh of electricity, so the same warmth
                needs about a third of the energy.
                <TipNote>
                  The largest lever here: gas is most of the energy and carries 0.162 kg
                  CO₂e/kWh against 0.036 for Ontario electricity. It raises electricity
                  use and pushes peak demand into winter.
                </TipNote>
              </>
            }
            hint="Replaces gas heating. Biggest lever: gas is most of the energy and 4.5× the carbon per kWh."
            value={levers.heat_pump_pct}
            onChange={(v) => set('heat_pump_pct', v)}
          />
          <Lever
            label="Efficiency retrofit"
            tip={
              <>
                Brings buildings that use more energy per m² than most of their peers
                down to the 25th percentile of their own property type.
                <br />
                The target is not invented — it is a level that comparable buildings of
                the same type already report to the province today.
                <TipNote>
                  Cuts gas and electricity together, because it reduces how much energy
                  the building needs rather than changing which fuel supplies it.
                </TipNote>
              </>
            }
            hint="Brings the worst buildings to the 25th percentile their own property type already reports."
            value={levers.retrofit_pct}
            onChange={(v) => set('retrofit_pct', v)}
          />
          <Lever
            label="LED lighting"
            tip={
              <>
                Converts lighting across this share of floor area. Lighting is roughly
                26% of a commercial building's electricity, and LEDs remove about half
                of it.
                <TipNote>
                  Saves real energy but little carbon: Ontario electricity is already
                  clean, so a kWh saved here avoids a fifth of the emissions a kWh saved
                  on gas would.
                </TipNote>
              </>
            }
            hint="Halves lighting load across the share of floor area converted."
            value={levers.lighting_retrofit_pct}
            onChange={(v) => set('lighting_retrofit_pct', v)}
          />
          <Lever
            label="Heat pump COP"
            tip={
              <>
                Coefficient of performance — units of heat delivered per unit of
                electricity drawn. Higher means less electricity for the same warmth.
                <br />
                3.0 is a seasonal average for a cold-climate unit, including the
                resistance backup that runs on the coldest days.
                <TipNote>
                  Manufacturers quote higher figures at mild temperatures; those are not
                  representative of a Toronto heating season.
                </TipNote>
              </>
            }
            hint="Seasonal average including backup heat on the coldest days."
            value={levers.heat_pump_cop}
            onChange={(v) => set('heat_pump_cop', v)}
            min={1.5}
            max={5}
            step={0.1}
            suffix="×"
          />
        </div>

        {/* ---- What they do ---- */}
        <div className="space-y-4">
          {plan ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Outcome
                  label="Site energy"
                  value={num(plan.planned.site_mwh)}
                  unit="MWh/yr"
                  deltaPct={plan.change.site_pct}
                />
                <Outcome
                  label="Emissions"
                  value={num(plan.planned.emissions_tco2e)}
                  unit="tCO₂e/yr"
                  deltaPct={plan.change.emissions_pct}
                />
                <Outcome
                  label="Peak demand"
                  value={num(plan.peak?.planned_peak_mw, 1)}
                  unit="MW"
                  deltaPct={plan.peak?.reduction_pct ? -plan.peak.reduction_pct : null}
                />
                <Outcome
                  label="Electrified"
                  value={num(plan.planned.electrified_pct, 0)}
                  unit="%"
                  deltaPct={
                    plan.baseline.electrified_pct != null && plan.planned.electrified_pct != null
                      ? plan.planned.electrified_pct - plan.baseline.electrified_pct
                      : null
                  }
                  lowerIsBetter={false}
                />
              </div>

              {plan.weather?.available && (
                <p className="text-[11px] leading-snug text-nc-muted">
                  With your plan, on the selected day ({num(plan.weather.temp_c, 1)} °C) this
                  district would use{' '}
                  <span className="tabular-nums text-nc-text">
                    {num(plan.weather.day_site_mwh)} MWh
                  </span>{' '}
                  of site energy
                  {/*
                    A bare megawatt-hour figure means nothing on its own. The
                    comparison against a typical day is what makes it readable,
                    and the backend already returns it.
                  */}
                  {plan.weather.vs_average_pct != null && (
                    <>
                      ,{' '}
                      <span
                        className={`tabular-nums ${
                          plan.weather.vs_average_pct > 0 ? 'text-nc-flex' : 'text-nc-renew'
                        }`}
                      >
                        {Math.abs(plan.weather.vs_average_pct).toFixed(0)}%{' '}
                        {plan.weather.vs_average_pct > 0 ? 'above' : 'below'}
                      </span>{' '}
                      an average day
                    </>
                  )}
                  . {plan.weather.driver}
                </p>
              )}

              <p className="text-[11px] leading-snug text-nc-muted/80">
                Apply the plan to see the full comparison — hourly load, fuel shift and each
                lever's share — on the results page.
              </p>
            </>
          ) : (
            <div className="space-y-2" aria-busy>
              <p className="text-[11px] text-nc-muted">Running levers over the building stock…</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-nc-panel-2" />
              ))}
            </div>
          )}
        </div>
      </div>

      {plan && (
        <p className="text-[10px] leading-snug text-nc-muted/80">
          Emission factors derived from the filings themselves —{' '}
          <span className="tabular-nums">{plan.factors.elec_kg_per_kwh}</span> kg CO₂e/kWh for
          electricity,{' '}
          <span className="tabular-nums">{plan.factors.gas_kg_per_kwh}</span> for gas — by fitting
          reported emissions against reported fuel use across 5,606 buildings, to a 6% median
          error. Levers apply in order: {String(plan.assumptions.order)}.
        </p>
      )}
    </Panel>
  );
}
