import Panel from '@/components/Panel';
import Placeholder from '@/components/Placeholder';
import ScenarioPicker from '@/components/panels/ScenarioPicker';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import { useSimulation } from '@/hooks/useSimulation';

/** Trigger a disruption, rerun, compare. TODO: severity/duration sliders. */
export default function WhatIfLab() {
  const { result, loading, run } = useSimulation();

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Panel title="Trigger an Event" subtitle="Pick a disruption and rerun the window">
        <ScenarioPicker onChange={(kind) => run(kind)} />
        <Placeholder label="Severity / duration controls" height={100} />
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-nc-renew px-3 py-2 text-sm text-nc-renew disabled:opacity-50"
          onClick={() => run('solar_drop')}
        >
          {loading ? 'Simulating…' : 'Run scenario'}
        </button>
      </Panel>
      <ScenarioComparison
        baseline={result?.baseline_metrics}
        optimized={result?.optimized_metrics}
      />
    </div>
  );
}
