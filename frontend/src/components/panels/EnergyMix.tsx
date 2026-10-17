import Panel from '@/components/Panel';
import EnergyMixDonut from '@/components/charts/EnergyMixDonut';
import { ENERGY_MIX } from '@/demo/fixtures';

export default function EnergyMix({ renewablePct }: { renewablePct: number }) {
  return (
    <Panel title="Energy Mix" subtitle="Share of supply across the window">
      <EnergyMixDonut mix={ENERGY_MIX} renewablePct={renewablePct} />
    </Panel>
  );
}
