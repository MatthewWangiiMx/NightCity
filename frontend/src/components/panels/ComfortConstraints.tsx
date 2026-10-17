import Panel from '@/components/Panel';
import type { Metrics } from '@/api/types';

/** Comfort is a hard constraint — violations are shown, never hidden. */
export default function ComfortConstraints({ metrics }: { metrics?: Metrics }) {
  const minutes = metrics?.comfort_violation_minutes;
  const ok = minutes === 0;
  return (
    <Panel title="Comfort Constraints" subtitle="Hard constraint: 20-24 C indoors">
      <div className={`text-3xl font-semibold ${ok ? 'text-nc-renew' : 'text-nc-flex'}`}>
        {minutes === undefined ? '—' : ok ? '100%' : `${minutes} min`}
      </div>
      <p className="text-xs text-nc-muted">
        {minutes === undefined
          ? 'Awaiting run'
          : ok
            ? 'Within comfort range for the whole window'
            : 'Minutes outside configured temperature bounds'}
      </p>
    </Panel>
  );
}
