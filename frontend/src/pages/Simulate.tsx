import { useState } from 'react';
import Timeline from '@/components/map/Timeline';
import Panel from '@/components/Panel';
import CityPageBackdrop from '@/components/map/CityPageBackdrop';
import TorontoCityViewer from '@/components/map/TorontoCityViewer';
import DispatchPlanPanel from '@/components/panels/DispatchPlanPanel';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import EmissionsAvoided from '@/components/panels/EmissionsAvoided';
import ComfortConstraints from '@/components/panels/ComfortConstraints';
import ReportedStockPanel from '@/components/panels/ReportedStockPanel';
import GridLoadProfile from '@/components/charts/GridLoadProfile';
import {
  PlanWeatherDayPicker,
  SimulateWeatherEventBar,
  useTorontoForecast,
} from '@/components/panels/WeatherForecastPanel';
import { usePlayback } from '@/hooks/usePlayback';
import { useRun } from '@/hooks/useRun';
import {
  scenarioKindFromForecastDay,
  weatherEventTitle,
  type DailyForecastDay,
} from '@/api/openMeteo';

/**
 * Simulate: pick a Toronto weather day, press Simulate, then orbit a 2.5D
 * view of the real downtown massing (rotate only — no fly-through).
 */
function clockLabel(iso: string) {
  try {
    return new Date(iso).toISOString().slice(11, 16);
  } catch {
    return '—';
  }
}

export default function Simulate() {
  const { result, loading, live, run } = useRun();
  const forecast = useTorontoForecast();
  /** Day highlighted on the picker (not yet confirmed). */
  const [draftDay, setDraftDay] = useState<DailyForecastDay | null>(null);
  /** Confirmed day — advances to the city results stage. */
  const [activeDay, setActiveDay] = useState<DailyForecastDay | null>(null);
  const [confirming, setConfirming] = useState(false);

  const steps = result.optimized;
  const { step, setStep, playing, play, togglePlay } = usePlayback(steps.length);
  const labels = steps.map((s) => clockLabel(s.t));
  const currentT = steps[step]?.t ? new Date(steps[step].t).getTime() : null;
  const weatherNow =
    result.weather?.length && currentT != null
      ? result.weather.reduce((best, w) => {
          const dt = Math.abs(new Date(w.observation_time).getTime() - currentT);
          if (!best) return w;
          const bestDt = Math.abs(new Date(best.observation_time).getTime() - currentT);
          return dt < bestDt ? w : best;
        }, result.weather[0])
      : null;

  const scenarioKind = activeDay
    ? scenarioKindFromForecastDay(activeDay)
    : result.scenario.kind;
  const eventTitle = activeDay ? weatherEventTitle(activeDay) : result.scenario.label;

  const effectIntensity = activeDay
    ? Math.min(1, Math.max(0.4, (step - 6) / 10))
    : 0;

  async function handleConfirmSimulate() {
    if (!draftDay) return;
    setConfirming(true);
    setStep(0);
    try {
      await run(scenarioKindFromForecastDay(draftDay));
      setActiveDay(draftDay);
      play();
    } finally {
      setConfirming(false);
    }
  }

  function handleChangeEvent() {
    setActiveDay(null);
    setDraftDay(null);
    setStep(0);
  }

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)]">
      {!activeDay && <CityPageBackdrop />}

      <div className="relative z-10">
        {!activeDay ? (
          <PlanWeatherDayPicker
            days={forecast.days}
            status={forecast.status}
            error={forecast.error}
            selected={draftDay}
            onPick={setDraftDay}
            notableOnly
            confirmLabel="Simulate"
            confirmLoading={confirming || loading}
            onConfirm={handleConfirmSimulate}
            title="Choose a weather event"
            subtitle="Toronto forecast from Open-Meteo — select a thunderstorm, heat spike, or any day, then simulate the grid response on the city."
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <SimulateWeatherEventBar
              day={activeDay}
              scenarioKind={scenarioKind}
              loading={loading}
              onChangeEvent={handleChangeEvent}
            />

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-nc-alert/40 bg-nc-alert/10 px-4 py-3">
              <span className="rounded bg-nc-alert/20 px-2 py-1 text-xs font-medium text-nc-alert">
                Event · {activeDay.date}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{eventTitle}</div>
                <div className="text-xs text-nc-muted">{result.scenario.description}</div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-1 text-[11px] uppercase tracking-wide ${
                    live
                      ? 'bg-nc-renew/15 text-nc-renew'
                      : 'bg-nc-muted/15 text-nc-muted'
                  }`}
                >
                  {live
                    ? result.source?.startsWith('buildings')
                      ? 'Buildings · live demand'
                      : `TigerData · ${result.source ?? 'live'}`
                    : 'Demo fixtures'}
                </span>
                {weatherNow?.temperature_2m_c != null && (
                  <span className="rounded border border-nc-border/70 bg-nc-panel/60 px-2 py-1 text-xs text-nc-text">
                    {weatherNow.temperature_2m_c.toFixed(1)}°C outdoor
                    {weatherNow.wind_speed_10m_kmh != null
                      ? ` · ${weatherNow.wind_speed_10m_kmh.toFixed(0)} km/h`
                      : ''}
                  </span>
                )}
                <span className="rounded bg-nc-renew/15 px-2 py-1 text-[11px] uppercase tracking-wide text-nc-renew">
                  Live on city
                </span>
              </div>
            </div>

            {/* Full-width 2.5D orbit of Toronto massing */}
            <div className="relative h-[min(72vh,780px)] w-full overflow-hidden rounded-xl border border-nc-border shadow-lg shadow-black/40">
              <TorontoCityViewer
                key={activeDay.date}
                variant="simulate"
                scenarioKind={scenarioKind}
                effectIntensity={effectIntensity}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-md border border-nc-border/70 bg-nc-panel/85 px-2.5 py-1.5 text-[11px] text-nc-muted backdrop-blur-sm">
                {scenarioKind === 'storm' && 'Blackout cascade · building lights failing'}
                {scenarioKind === 'heat_wave' && 'Heat stress · warm window glow'}
                {scenarioKind === 'solar_drop' && 'Cloud bank · city dimmed'}
                {scenarioKind === 'ev_surge' && 'Peak demand · amber street glow'}
                {scenarioKind === 'battery_outage' && 'Storage offline · partial blackout'}
                {scenarioKind === 'baseline' && 'Baseline evening · no disruption'}
              </div>
            </div>

            <Timeline
              step={step}
              total={steps.length}
              playing={playing}
              onTogglePlay={togglePlay}
              onScrub={setStep}
              labels={labels}
              eventLabel={eventTitle}
            />

            <div className="flex flex-col gap-4">
              <DispatchPlanPanel
                actions={result.actions}
                baseline={result.baseline_metrics}
                optimized={result.optimized_metrics}
                gridStatus={result.grid_status}
                explanation={result.explanation}
                className="w-full"
              />

              <Panel
                title="Grid Load Profile"
                subtitle={
                  live ? 'TigerData telemetry baseline vs plan' : 'Baseline vs plan, identical inputs'
                }
                className="w-full"
              >
                <GridLoadProfile
                  baseline={result.baseline}
                  optimized={result.optimized}
                  height={220}
                />
              </Panel>

              <div className="grid w-full gap-4 md:grid-cols-3">
                <ScenarioComparison
                  baseline={result.baseline_metrics}
                  optimized={result.optimized_metrics}
                />
                <EmissionsAvoided
                  baseline={result.baseline_metrics}
                  optimized={result.optimized_metrics}
                />
                <ComfortConstraints metrics={result.optimized_metrics} />
              </div>

              <ReportedStockPanel className="w-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
