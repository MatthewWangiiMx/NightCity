import ScenarioComparison from '@/components/panels/ScenarioComparison';
import Panel from '@/components/Panel';
import GridLoadProfile from '@/components/charts/GridLoadProfile';
import { useSimulation } from '@/hooks/useSimulation';

export default function Results() {
  const { result } = useSimulation();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ScenarioComparison
        baseline={result?.baseline_metrics}
        optimized={result?.optimized_metrics}
      />
      <Panel title="Grid Load Profile" subtitle="Baseline vs plan on identical inputs">
        <GridLoadProfile baseline={result?.baseline} optimized={result?.optimized} />
      </Panel>
      <p className="text-xs text-nc-muted lg:col-span-2">
        All figures are produced by the deterministic simulator from synthetic inputs and are
        labeled estimates, not measured results. See docs/METRICS.md for every equation.
      </p>
    </div>
  );
}
