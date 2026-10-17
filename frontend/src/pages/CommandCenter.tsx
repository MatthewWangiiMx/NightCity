import DistrictMap from '@/components/map/DistrictMap';
import Timeline from '@/components/map/Timeline';
import GridStatusPanel from '@/components/panels/GridStatusPanel';
import DispatchPlanPanel from '@/components/panels/DispatchPlanPanel';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import ComfortConstraints from '@/components/panels/ComfortConstraints';
import EmissionsAvoided from '@/components/panels/EmissionsAvoided';
import EnergyMix from '@/components/panels/EnergyMix';
import DemandVsRenewables from '@/components/charts/DemandVsRenewables';
import GridLoadProfile from '@/components/charts/GridLoadProfile';
import Panel from '@/components/Panel';
import { useDistrict } from '@/hooks/useDistrict';
import { useSimulation } from '@/hooks/useSimulation';
import { usePlayback } from '@/hooks/usePlayback';

export default function CommandCenter() {
  const { district } = useDistrict();
  const { result } = useSimulation();
  const steps = result?.optimized ?? [];
  const { step, setStep, playing, togglePlay } = usePlayback(steps.length);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {/* Left rail */}
      <div className="flex flex-col gap-4">
        <GridStatusPanel status={result?.grid_status} />
        <Panel title="Demand vs Renewable Generation">
          <DemandVsRenewables steps={steps} />
        </Panel>
      </div>

      {/* Center: the district twin */}
      <div className="flex min-h-[520px] flex-col gap-4">
        <DistrictMap district={district} />
        <Timeline
          step={step}
          total={steps.length}
          playing={playing}
          onTogglePlay={togglePlay}
          onScrub={setStep}
        />
      </div>

      {/* Right rail */}
      <DispatchPlanPanel actions={result?.actions} explanation={result?.explanation} />

      {/* Bottom strip */}
      <div className="grid gap-4 lg:grid-cols-4 xl:col-span-3">
        <ScenarioComparison
          baseline={result?.baseline_metrics}
          optimized={result?.optimized_metrics}
        />
        <Panel title="Grid Load Profile">
          <GridLoadProfile baseline={result?.baseline} optimized={result?.optimized} />
        </Panel>
        <div className="flex flex-col gap-4">
          <EmissionsAvoided
            baseline={result?.baseline_metrics}
            optimized={result?.optimized_metrics}
          />
          <ComfortConstraints metrics={result?.optimized_metrics} />
        </div>
        <EnergyMix steps={steps} />
      </div>
    </div>
  );
}
