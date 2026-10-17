import Panel from '@/components/Panel';
import type { Metrics } from '@/api/types';
import { COMFORT_CHANNELS } from '@/demo/fixtures';

/**
 * Comfort is a hard constraint, so violations are stated, never hidden.
 * The per-channel bars use the status role, with a label and a check mark —
 * never colour alone.
 */
export default function ComfortConstraints({ metrics }: { metrics: Metrics }) {
  const ok = metrics.comfort_violation_minutes === 0;

  return (
    <Panel title="Comfort Constraints" subtitle="Hard constraint: 20–24°C indoors">
      <div>
        <div className={`text-3xl font-semibold ${ok ? 'text-nc-renew' : 'text-nc-flex'}`}>
          {ok ? '100%' : `${metrics.comfort_violation_minutes} min`}
        </div>
        <p className="text-xs text-nc-muted">
          {ok ? 'within comfort range' : 'outside configured temperature bounds'}
        </p>
      </div>
      <ul className="space-y-2">
        {COMFORT_CHANNELS.map((channel) => (
          <li key={channel.name} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-nc-muted">{channel.name}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-nc-panel-2">
              <span
                className="block h-full rounded-full bg-nc-renew"
                style={{ width: `${channel.value}%` }}
              />
            </span>
            <span className="text-nc-renew" aria-label={channel.status}>
              ✓
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
