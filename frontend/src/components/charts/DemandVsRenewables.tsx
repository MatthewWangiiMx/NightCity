import Placeholder from '@/components/Placeholder';
import type { TimeStep } from '@/api/types';

/** TODO: Recharts area/line — total demand, renewables, solar, event marker. */
export default function DemandVsRenewables({ steps }: { steps?: TimeStep[] }) {
  if (!steps?.length) return <Placeholder label="Demand vs renewable generation" />;
  return <Placeholder label={`Demand vs renewables (${steps.length} steps)`} />;
}
