import { useState } from 'react';
import DistrictMap from '@/components/map/DistrictMap';
import Timeline from '@/components/map/Timeline';
import Panel from '@/components/Panel';
import CityPageBackdrop from '@/components/map/CityPageBackdrop';
import DispatchPlanPanel from '@/components/panels/DispatchPlanPanel';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import EmissionsAvoided from '@/components/panels/EmissionsAvoided';
import ComfortConstraints from '@/components/panels/ComfortConstraints';
import ReportedStockPanel from '@/components/panels/ReportedStockPanel';
import GridLoadProfile from '@/components/charts/GridLoadProfile';
import EventDialog from '@/components/EventDialog';
import { usePlayback } from '@/hooks/usePlayback';
import { useRun } from '@/hooks/useRun';
import type { ScenarioKind } from '@/api/types';

/**
 * Simulate: trigger a disruption and read the consequences.
 *
 * Event-first. The dialog opens on arrival, and what follows is the cascade —
 * playback, the plan the optimizer chose, and what it bought against baseline.
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
  const [dialogOpen, setDialogOpen] = useState(true);
  const steps = result.optimized;
  const { step, setStep, playing, togglePlay } = usePlayback(steps.length);
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

  async function handleRun(kind: ScenarioKind) {
    await run(kind);
    setDialogOpen(false);
    setStep(0);
  }

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)]">
      <CityPageBackdrop />

      <div className="relative z-10 flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-nc-alert/40 bg-nc-alert/10 px-4 py-3">
        <span className="rounded bg-nc-alert/20 px-2 py-1 text-xs font-medium text-nc-alert">
          Event · {result.scenario.event_time ?? result.scenario.label}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{result.scenario.label}</div>
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
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-lg border border-nc-border px-3 py-1.5 text-xs transition hover:border-nc-renew hover:text-nc-renew"
          >
            Change event
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <DistrictMap district={result.district} className="relative h-[340px]" />
          <Timeline
            step={step}
            total={steps.length}
            playing={playing}
            onTogglePlay={togglePlay}
            onScrub={setStep}
            labels={labels}
            eventLabel={result.scenario.event_time ? String(result.scenario.event_time) : result.scenario.label}
          />
          <Panel
            title="Grid Load Profile"
            subtitle={live ? 'TigerData telemetry baseline vs plan' : 'Baseline vs plan, identical inputs'}
          >
            <GridLoadProfile baseline={result.baseline} optimized={result.optimized} height={220} />
          </Panel>
        </div>

        <DispatchPlanPanel
          actions={result.actions}
          baseline={result.baseline_metrics}
          optimized={result.optimized_metrics}
          gridStatus={result.grid_status}
          explanation={result.explanation}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
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

      {/* The one measured reference on this page: what the real stock reports. */}
      <ReportedStockPanel />

      <EventDialog
        open={dialogOpen}
        loading={loading}
        initial={result.scenario.kind}
        onRun={handleRun}
        onClose={() => setDialogOpen(false)}
      />
      </div>
    </div>
  );
}
