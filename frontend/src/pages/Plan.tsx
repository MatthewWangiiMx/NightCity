import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Panel from '@/components/Panel';
import InfoTip, { TipNote } from '@/components/InfoTip';
import CityPageBackdrop from '@/components/map/CityPageBackdrop';
import EnergyLeversPanel from '@/components/panels/EnergyLeversPanel';
import {
  PlanWeatherDayPicker,
  WeatherDayBar,
} from '@/components/panels/WeatherForecastPanel';
import {
  fetchDailyForecast,
  type DailyForecastDay,
  type ForecastSource,
} from '@/api/openMeteo';
import type { EwrbLevers, EwrbPlanResult } from '@/api/types';

/**
 * Everything the Plan page owns, so the results page can hand it straight back.
 *
 * The levers travel merged (panel knobs plus the comfort and flexibility
 * floors); `comfort` and `flex` come along separately because those two panels
 * cannot be reconstructed from the merged lever set alone.
 */
export type ResumedPlan = {
  day: DailyForecastDay | null;
  levers: EwrbLevers | null;
  weatherEnabled: boolean;
  comfort: { temperature: number; airQuality: number; lighting: number };
  flex: { ev: number; hvac: number; industrial: number };
};

function Slider({
  label,
  value,
  onChange,
  suffix = '%',
  min = 0,
  max = 100,
  leading,
  trailing,
  tip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  leading?: string;
  trailing?: string;
  /** Longer explanation behind the question mark. */
  tip?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs">
        <span className="flex items-center gap-1.5 text-nc-muted">
          {label}
          {tip && <InfoTip title={label}>{tip}</InfoTip>}
        </span>
        <span className="tabular-nums text-nc-text">
          {value}
          {suffix}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-2">
        {leading && (
          <span className="text-xs text-nc-muted" aria-hidden>
            {leading}
          </span>
        )}
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        {trailing && (
          <span className="text-xs text-nc-muted" aria-hidden>
            {trailing}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * Plan: pick a backend-provided weather day first, then author a dispatch posture.
 *
 * The sliders are local state today; wiring them to a rerun means passing them
 * as `params` on the run request. Projected figures are scaled from the current
 * plan and labeled as such — they are not simulator output.
 */
export default function Plan() {
  const navigate = useNavigate();
  const location = useLocation();
  const forecast = usePlanForecast();

  // Coming back from the results page: resume the plan that was applied rather
  // than dropping the user on an empty day picker with every slider at zero.
  const resume = (location.state as { resumePlan?: ResumedPlan } | null)?.resumePlan ?? null;

  const [selectedDay, setSelectedDay] = useState<DailyForecastDay | null>(resume?.day ?? null);
  const [leverPlan, setLeverPlan] = useState<EwrbPlanResult | null>(null);
  const [leverValues, setLeverValues] = useState<EwrbLevers | null>(resume?.levers ?? null);
  const [weatherEnabled, setWeatherEnabled] = useState(resume?.weatherEnabled ?? true);

  const [comfort, setComfort] = useState(
    resume?.comfort ?? { temperature: 22, airQuality: 88, lighting: 96 },
  );
  const [flex, setFlex] = useState(resume?.flex ?? { ev: 60, hvac: 45, industrial: 25 });


  // Baseline and plan come from the lever panel, which runs them over reported
  // building energy. The old projection here scaled dispatch by renewable share
  // with hand-picked coefficients and could not respond to the levers at all.
  const rows = leverPlan
    ? [
        {
          label: 'Site energy',
          unit: 'MWh/yr',
          base: leverPlan.baseline.site_mwh,
          now: leverPlan.planned.site_mwh,
          lowerIsBetter: true,
        },
        {
          label: 'Emissions',
          unit: 'tCO₂e/yr',
          base: leverPlan.baseline.emissions_tco2e,
          now: leverPlan.planned.emissions_tco2e,
          lowerIsBetter: true,
        },
        {
          label: 'Electrified share',
          unit: '%',
          base: leverPlan.baseline.electrified_pct ?? 0,
          now: leverPlan.planned.electrified_pct ?? 0,
          lowerIsBetter: false,
        },
      ]
    : [];

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)]">
      <CityPageBackdrop />

      <div className="relative z-10">
        {!selectedDay ? (
          <PlanWeatherDayPicker
            days={forecast.days}
            status={forecast.status}
            error={forecast.error}
            source={forecast.source}
            onPick={(day) => setSelectedDay(day)}
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <WeatherDayBar day={selectedDay} onChangeDay={() => setSelectedDay(null)} />
            <Panel title="Weather impact" subtitle="Experiment with weather-sensitive demand">
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="block text-nc-text">Apply weather to energy consumption</span>
                  <span className="text-xs text-nc-muted">
                    Uses the selected day&apos;s backend-derived demand factor.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={weatherEnabled}
                  onChange={(event) => setWeatherEnabled(event.target.checked)}
                  className="h-5 w-5 accent-nc-renew"
                />
              </label>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-4">
        {/*
          Replaces the grid load profile and the synthetic supply-mix sliders.
          Those moved emissions per kWh around; these change the kWh, and every
          one is driven by intensities buildings actually reported.
        */}
        <EnergyLeversPanel
          className="xl:col-span-4"
          initialLevers={resume?.levers}
          day={
            weatherEnabled && selectedDay
              ? {
                  // Degree-days want a daily mean, not the high.
                  day_temp_c: (selectedDay.tempMaxC + selectedDay.tempMinC) / 2,
                  day_weather_code: selectedDay.weatherCode,
                  day_wind_kmh: selectedDay.windMaxKmh,
                  day_precip_mm: selectedDay.precipMm,
                  day_hourly_temps_c: selectedDay.hourlyTempsC,
                }
              : null
          }
          extra={{
            // Target temperature is the single setpoint control. Heating energy
            // tracks degree-days, so holding the district cooler than the 22 °C
            // reference removes load; we do not model a penalty for going warmer.
            setpoint_widen_c: Math.max(0, 22 - comfort.temperature),
            air_quality_floor_pct: comfort.airQuality,
            lighting_floor_pct: comfort.lighting,
            flex_ev_pct: flex.ev,
            flex_hvac_pct: flex.hvac,
            flex_industrial_pct: flex.industrial,
          }}
          onPlanChange={(values, result) => {
            setLeverValues(values);
            setLeverPlan(result);
          }}
        />

        <Panel title="Comfort Constraints" subtitle="Bounds the optimizer may not cross">
          <div className="space-y-4">
            <Slider
              label="Target temperature"
              tip={
                <>
                  The indoor temperature the optimizer must hold while it shifts load
                  around.
                  <br />
                  Heating energy tracks heating degree-days, so every degree below the
                  22 °C reference removes roughly 6% of the district's heating load.
                  <TipNote>
                    Lowering it saves real energy and costs occupant comfort. Going above
                    22 °C is not modelled as a penalty here.
                  </TipNote>
                                  </>
              }
              value={comfort.temperature}
              min={18}
              max={26}
              suffix="°C"
              leading="❄"
              trailing="☀"
              onChange={(v) => setComfort((c) => ({ ...c, temperature: v }))}
            />
            <Slider
              label="Air quality floor"
              tip={
                <>
                  Minimum ventilation performance the plan may not drop below.
                  <br />
                  Ventilation is a large and very shiftable electrical load, which makes
                  it tempting to cut. This sets the point past which cutting it stops
                  being a saving and starts being a transfer onto the people inside.
                                  </>
              }
              value={comfort.airQuality}
              leading="◌"
              trailing="◉"
              onChange={(v) => setComfort((c) => ({ ...c, airQuality: v }))}
            />
            <Slider
              label="Lighting floor"
              tip={
                <>
                  Minimum lighting level the plan may not dim below during a peak event.
                                  </>
              }
              value={comfort.lighting}
              leading="◑"
              trailing="☀"
              onChange={(v) => setComfort((c) => ({ ...c, lighting: v }))}
            />
          </div>
          <p className="text-[11px] text-nc-muted">
            Comfort is a hard constraint: a plan may not cross these bounds. The floors are
            headroom — an 88% air-quality floor lets the optimizer shed 12% of ventilation at
            the peak and no more.
          </p>
        </Panel>

        <Panel title="Demand Adjustments" subtitle="How much load may be moved">
          <div className="space-y-4">
            <Slider
              label="Flexible EV charging"
              tip={
                <>
                  Share of EV charging the optimizer may move to another hour.
                  <br />
                  Most vehicles sit plugged in far longer than they need to charge, so
                  this is usually the cheapest flexibility in a district.
                  <TipNote>
                    Shifts energy in time — it lowers peak demand, not total consumption.
                  </TipNote>
                </>
              }
              value={flex.ev}
              onChange={(v) => setFlex((f) => ({ ...f, ev: v }))}
            />
            <Slider
              label="HVAC pre-cooling"
              tip={
                <>
                  Runs cooling early and stores the coolness in the building's own
                  thermal mass, so it can coast through the peak with equipment off.
                  <TipNote>
                    Costs slightly more total energy than doing nothing, and buys a lower
                    peak in exchange.
                  </TipNote>
                </>
              }
              value={flex.hvac}
              onChange={(v) => setFlex((f) => ({ ...f, hvac: v }))}
            />
            <Slider
              label="Deferrable industrial load"
              tip={
                <>
                  Share of industrial process load that can be postponed to a cheaper or
                  cleaner hour without disrupting production.
                  <TipNote>
                    Shifts energy in time rather than reducing it. Downtown has almost no
                    deferrable process load, so expect this one to stay near zero here.
                  </TipNote>
                </>
              }
              value={flex.industrial}
              onChange={(v) => setFlex((f) => ({ ...f, industrial: v }))}
            />
          </div>
          <p className="text-[11px] text-nc-muted">
            These move load between hours rather than removing it, so they lower peak demand
            without changing annual energy. Only the shed share is avoided outright.
          </p>
        </Panel>

        <Panel
          title="Scenario Comparison"
          subtitle="Baseline vs your plan"
          className="xl:col-span-2"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-nc-muted">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 text-right font-medium">Baseline</th>
                <th className="pb-2 text-right font-medium">Your plan</th>
                <th className="pb-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct = Math.round(((row.now - row.base) / row.base) * 100);
                const good = row.lowerIsBetter ? pct < 0 : pct > 0;
                return (
                  <tr key={row.label} className="border-t border-nc-border/60">
                    <td className="py-2 text-nc-muted">{row.label}</td>
                    <td className="py-2 text-right tabular-nums text-nc-muted">
                      {Math.round(row.base)} {row.unit}
                    </td>
                    <td className="py-2 text-right text-base font-semibold tabular-nums">
                      {row.now} {row.unit}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${good ? 'text-nc-renew' : 'text-nc-flex'}`}
                    >
                      {pct > 0 ? '+' : ''}
                      {pct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-nc-muted">
            Your-plan figures are scaled from the current dispatch by renewable share — a placeholder
            until the optimizer accepts these as run parameters.
          </p>
          <button
            type="button"
            onClick={() =>
              navigate('/plan/simulate', {
                state: {
                  fromPlanApply: true,
                  appliedPlanDay: selectedDay,
                  // The results page reruns these rather than re-deriving them.
                  levers: leverValues,
                  plan: leverPlan,
                  // Handed straight back by the results page's Edit plan button.
                  planSettings: { weatherEnabled, comfort, flex },
                },
              })
            }
            className="rounded-xl bg-nc-renew px-4 py-3 text-sm font-medium text-nc-bg shadow-lg shadow-nc-renew/20 transition hover:brightness-110"
          >
            Apply plan
          </button>
        </Panel>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The Plan page's forecast.
 *
 * Shares `fetchDailyForecast` with the results page so both read the same
 * cached data through the same endpoint — previously this page went through
 * the backend and the results page called Open-Meteo straight from the
 * browser, which meant the two could legitimately disagree.
 */
function usePlanForecast() {
  const [days, setDays] = useState<DailyForecastDay[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [source, setSource] = useState<ForecastSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDailyForecast(16)
      .then((forecast) => {
        if (cancelled) return;
        setDays(forecast.days);
        setSource(forecast.source);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Could not load forecast');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const demandFactors = Object.fromEntries(
    days.map((day) => [day.date, day.weatherDemandFactor ?? 1]),
  );
  return { days, demandFactors, status, error, source };
}
