import Panel from '@/components/Panel';
import Placeholder from '@/components/Placeholder';
import type { TimeStep } from '@/api/types';

/** TODO: donut of solar / wind / battery / imported mix over the window. */
export default function EnergyMix({ steps }: { steps?: TimeStep[] }) {
  return (
    <Panel title="Energy Mix">
      <Placeholder label={steps?.length ? 'Energy mix donut' : 'Awaiting run'} height={120} />
    </Panel>
  );
}
