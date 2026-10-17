import { useState } from 'react';
import Panel from '@/components/Panel';
import GridLoadProfile from '@/components/charts/GridLoadProfile';
import EnergyMixDonut from '@/components/charts/EnergyMixDonut';
import CityPageBackdrop from '@/components/map/CityPageBackdrop';
import {
  PlanWeatherDayPicker,
  WeatherDayBar,
  useTorontoForecast,
} from '@/components/panels/WeatherForecastPanel';
import { useRun } from '@/hooks/useRun';
import { ENERGY_MIX } from '@/demo/fixtures';
import type { DailyForecastDay } from '@/api/openMeteo';

function Slider({
  label,
  value,
  onChange,
  suffix = '%',
  min = 0,
  max = 100,
  leading,
  trailing,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  leading?: string;
  trailing?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-nc-muted">{label}</span>
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
 * Plan: pick an Open-Meteo forecast day first, then author a dispatch posture.
 *
 * The sliders are local state today; wiring them to a rerun means passing them
 * as `params` on the run request. Projected figures are scaled from the current
 * plan and labeled as such — they are not simulator output.
 */
export default function Plan() {
  const { result } = useRun();
  const forecast = useTorontoForecast();
  const [selectedDay, setSelectedDay] = useState<DailyForecastDay | null>(null);

  const [mix, setMix] = useState(
    () => Object.fromEntries(ENERGY_MIX.map((m) => [m.name, m.share])) as Record<string, number>,
  );
  const [comfort, setComfort] = useState({ temperature: 22, airQuality: 88, lighting: 96 });
  const [flex, setFlex] = useState({ ev: 60, hvac: 45, industrial: 25 });
  const [applied, setApplied] = useState(false);

  const mixRows = ENERGY_MIX.map((m) => ({ name: m.name, share: mix[m.name] }));
  const total = mixRows.reduce((sum, m) => sum + m.share, 0);
  // Battery is storage, not generation, so it is not counted as renewable supply.
  const renewablePct = total ? Math.round(((mix.Solar + mix.Wind) / total) * 100) : 0;

  const plan = result.optimized_metrics;
  const baseline = result.baseline_metrics;
  const lift = renewablePct - plan.renewable_share_pct;

  const projected = {
    peak: Math.round(plan.peak_demand_mw * (1 - lift * 0.004)),
    renewable: renewablePct,
    emissions: Math.round(plan.emissions_tco2e * (1 - lift * 0.008)),
  };

  const rows = [
    { label: 'Peak load', unit: 'MW', base: baseline.peak_demand_mw, now: projected.peak, lowerIsBetter: true },
    { label: 'Renewable share', unit: '%', base: baseline.renewable_share_pct, now: projected.renewable, lowerIsBetter: false },
    { label: 'Emissions', unit: 'tCO₂e', base: baseline.emissions_tco2e, now: projected.emissions, lowerIsBetter: true },
  ];

  function setMixValue(name: string, value: number) {
    setMix((prev) => ({ ...prev, [name]: value }));
    setApplied(false);
  }

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)]">
      <CityPageBackdrop />

      <div className="relative z-10">
        {!selectedDay ? (
          <PlanWeatherDayPicker
            days={forecast.days}
            status={forecast.status}
            error={forecast.error}
            onPick={setSelectedDay}
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <WeatherDayBar day={selectedDay} onChangeDay={() => setSelectedDay(null)} />

            <div className="grid gap-4 xl:grid-cols-4">
        <Panel
          title="Grid Load Profile"
          subtitle="Baseline vs plan, identical inputs"
          className="xl:col-span-2"
        >
          <GridLoadProfile baseline={result.baseline} optimized={result.optimized} height={250} />
        </Panel>

        <Panel title="Energy Mix" subtitle="Adjust the supply shares">
          <div className="space-y-4">
            {ENERGY_MIX.map((m) => (
              <Slider
                key={m.name}
                label={m.name}
                value={mix[m.name]}
                onChange={(v) => setMixValue(m.name, v)}
              />
            ))}
          </div>
          {total !== 100 && (
            <p className="text-[11px] text-nc-flex">
              Shares total {total}% — the simulator normalizes to 100% before dispatch.
            </p>
          )}
        </Panel>

        <Panel title="Energy Mix" subtitle="Resulting share of supply">
          <EnergyMixDonut mix={mixRows} renewablePct={renewablePct} size={140} />
        </Panel>

        <Panel title="Comfort Constraints" subtitle="Bounds the optimizer may not cross">
          <div className="space-y-4">
            <Slider
              label="Target temperature"
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
              value={comfort.airQuality}
              leading="◌"
              trailing="◉"
              onChange={(v) => setComfort((c) => ({ ...c, airQuality: v }))}
            />
            <Slider
              label="Lighting floor"
              value={comfort.lighting}
              leading="◑"
              trailing="☀"
              onChange={(v) => setComfort((c) => ({ ...c, lighting: v }))}
            />
          </div>
          <p className="text-[11px] text-nc-muted">
            Comfort is a hard constraint: a plan that crosses these bounds is rejected, not traded
            off against cost or emissions.
          </p>
        </Panel>

        <Panel title="Demand Adjustments" subtitle="How much load may be moved">
          <div className="space-y-4">
            <Slider
              label="Flexible EV charging"
              value={flex.ev}
              onChange={(v) => setFlex((f) => ({ ...f, ev: v }))}
            />
            <Slider
              label="HVAC pre-cooling"
              value={flex.hvac}
              onChange={(v) => setFlex((f) => ({ ...f, hvac: v }))}
            />
            <Slider
              label="Deferrable industrial load"
              value={flex.industrial}
              onChange={(v) => setFlex((f) => ({ ...f, industrial: v }))}
            />
          </div>
          <p className="text-[11px] text-nc-muted">
            Placeholders until the optimizer accepts flexibility parameters.
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
            onClick={() => setApplied(true)}
            className="rounded-xl bg-nc-renew px-4 py-3 text-sm font-medium text-nc-bg shadow-lg shadow-nc-renew/20 transition hover:brightness-110"
          >
            {applied ? 'Plan applied ✓' : 'Apply plan'}
          </button>
        </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
