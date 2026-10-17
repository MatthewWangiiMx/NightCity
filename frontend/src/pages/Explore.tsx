import { useState } from 'react';
import DistrictMap from '@/components/map/DistrictMap';
import Timeline from '@/components/map/Timeline';
import Panel from '@/components/Panel';
import GridStatusPanel from '@/components/panels/GridStatusPanel';
import AssetInspector from '@/components/panels/AssetInspector';
import EnergyMix from '@/components/panels/EnergyMix';
import DemandVsRenewables from '@/components/charts/DemandVsRenewables';
import { usePlayback } from '@/hooks/usePlayback';
import { useRun } from '@/hooks/useRun';
import type { Asset } from '@/api/types';

/**
 * Explore: understand the district as it stands.
 *
 * Map-first and asset-first — no dispatch plan and no baseline comparison;
 * those belong to Simulate. Scrubbing the timeline moves every reading here.
 */
export default function Explore() {
  const { result, run } = useRun();
  const steps = result.optimized;
  const { step, setStep, playing, togglePlay } = usePlayback(steps.length);
  const [selected, setSelected] = useState<Asset | null>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <GridStatusPanel
          status={result.grid_status}
          scenario={result.scenario}
          onScenarioChange={run}
        />
        <EnergyMix renewablePct={result.optimized_metrics.renewable_share_pct} />
      </div>

      <div className="flex min-h-[600px] flex-col gap-4">
        <DistrictMap district={result.district} onSelectAsset={setSelected} className="relative flex-1" />
        <Timeline
          step={step}
          total={steps.length}
          playing={playing}
          onTogglePlay={togglePlay}
          onScrub={setStep}
        />
      </div>

      <AssetInspector
        district={result.district}
        asset={selected}
        step={steps[step]}
        onSelect={setSelected}
      />

      <Panel
        title="Demand vs Renewable Generation"
        subtitle="MW across the evening window"
        className="xl:col-span-3"
      >
        <DemandVsRenewables steps={steps} height={220} />
      </Panel>
    </div>
  );
}
