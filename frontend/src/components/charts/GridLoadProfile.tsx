import Placeholder from '@/components/Placeholder';
import type { TimeStep } from '@/api/types';

/** TODO: Recharts — baseline (dashed) vs optimized plan (solid). */
export default function GridLoadProfile({
  baseline,
  optimized,
}: {
  baseline?: TimeStep[];
  optimized?: TimeStep[];
}) {
  const n = optimized?.length ?? baseline?.length ?? 0;
  return <Placeholder label={n ? `Grid load profile (${n} steps)` : 'Grid load profile'} />;
}
