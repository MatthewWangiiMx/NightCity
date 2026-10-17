import { useState } from 'react';
import DistrictMap from '@/components/map/DistrictMap';
import Timeline from '@/components/map/Timeline';
import Panel from '@/components/Panel';
import DispatchPlanPanel from '@/components/panels/DispatchPlanPanel';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import EmissionsAvoided from '@/components/panels/EmissionsAvoided';
import ComfortConstraints from '@/components/panels/ComfortConstraints';
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
export default function Simulate() {
  const { result, loading, run } = useRun();
  const [dialogOpen, setDialogOpen] = useState(true);
  const steps = result.optimized;
  const { step, setStep, playing, togglePlay } = usePlayback(steps.length);

  async function handleRun(kind: ScenarioKind) {
    await run(kind);
    setDialogOpen(false);
    setStep(0);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-nc-alert/40 bg-nc-alert/10 px-4 py-3">
        <span className="rounded bg-nc-alert/20 px-2 py-1 text-xs font-medium text-nc-alert">
          Event · {result.scenario.event_time}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{result.scenario.label}</div>
          <div className="text-xs text-nc-muted">{result.scenario.description}</div>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="ml-auto rounded-lg border border-nc-border px-3 py-1.5 text-xs transition hover:border-nc-renew hover:text-nc-renew"
        >
          Change event
        </button>
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
          />
          <Panel title="Grid Load Profile" subtitle="Baseline vs plan, identical inputs">
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

      <EventDialog
        open={dialogOpen}
        loading={loading}
        initial={result.scenario.kind}
        onRun={handleRun}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
