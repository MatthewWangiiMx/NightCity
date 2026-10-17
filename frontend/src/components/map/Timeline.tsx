import { EVENT_LABEL, EVENT_STEP, EVENT_TIME, TIME_LABELS } from '@/demo/fixtures';

/**
 * Playback scrubber under the map. The track is split at the disruption:
 * amber before it, green after, with the event called out above the marker.
 */
export default function Timeline({
  step,
  total,
  playing,
  onTogglePlay,
  onScrub,
}: {
  step: number;
  total: number;
  playing: boolean;
  onTogglePlay: () => void;
  onScrub: (step: number) => void;
}) {
  const eventPct = total > 1 ? (EVENT_STEP / (total - 1)) * 100 : 50;
  const ticks = [0, 4, 8, 12, 16, 20].filter((i) => i < total);

  return (
    <div className="rounded-xl border border-nc-border/80 bg-nc-panel/75 px-4 pb-3 pt-2 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-nc-border text-xs text-nc-text transition hover:border-nc-renew hover:text-nc-renew"
          aria-label={playing ? 'Pause playback' : 'Play playback'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="relative flex-1 pt-6">
          {/* Event callout, pinned over the marker */}
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-nc-alert/15 px-2 py-0.5 text-[11px] text-nc-alert"
            style={{ left: `${eventPct}%` }}
          >
            {EVENT_TIME} {EVENT_LABEL}
          </span>

          <div className="relative">
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
              style={{
                background: `linear-gradient(90deg, var(--color-nc-flex) 0%, var(--color-nc-flex) ${eventPct}%, var(--color-nc-renew) ${eventPct}%, var(--color-nc-renew) 100%)`,
              }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-nc-alert"
              style={{ left: `${eventPct}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(total - 1, 0)}
              value={step}
              onChange={(e) => onScrub(Number(e.target.value))}
              className="nc-track-none relative block w-full"
              aria-label="Playback position"
            />
          </div>

          <div className="relative mt-1 h-4 text-[10px] text-nc-muted">
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2"
                style={{ left: `${(i / (total - 1)) * 100}%` }}
              >
                {TIME_LABELS[i]}
              </span>
            ))}
          </div>
        </div>

        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-nc-text">
          {TIME_LABELS[step] ?? '—'}
        </span>
      </div>
    </div>
  );
}
