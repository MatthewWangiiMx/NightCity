/**
 * Playback scrubber under the map. Labels come from the live/demo step series
 * so TigerData windows are not forced onto the hardcoded 16:00–21:00 demo grid.
 */
export default function Timeline({
  step,
  total,
  playing,
  onTogglePlay,
  onScrub,
  labels = [],
  eventLabel,
  eventIndex,
}: {
  step: number;
  total: number;
  playing: boolean;
  onTogglePlay: () => void;
  onScrub: (step: number) => void;
  labels?: string[];
  eventLabel?: string | null;
  eventIndex?: number | null;
}) {
  const eventStep =
    eventIndex != null && eventIndex >= 0 && eventIndex < total
      ? eventIndex
      : Math.floor((total - 1) * 0.55);
  const eventPct = total > 1 ? (eventStep / (total - 1)) * 100 : 50;
  const tickCount = Math.min(6, Math.max(total, 1));
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    total <= 1 ? 0 : Math.round((i * (total - 1)) / (tickCount - 1)),
  );

  const labelAt = (i: number) => labels[i] ?? '—';
  const eventText = eventLabel?.trim() || null;

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
          {eventText && (
            <span
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-nc-alert/15 px-2 py-0.5 text-[11px] text-nc-alert"
              style={{ left: `${eventPct}%` }}
            >
              {eventText}
            </span>
          )}

          <div className="relative">
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
              style={{
                background: eventText
                  ? `linear-gradient(90deg, var(--color-nc-flex) 0%, var(--color-nc-flex) ${eventPct}%, var(--color-nc-renew) ${eventPct}%, var(--color-nc-renew) 100%)`
                  : 'var(--color-nc-renew)',
              }}
            />
            {eventText && (
              <div
                className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-nc-alert"
                style={{ left: `${eventPct}%` }}
              />
            )}
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
                key={`${i}-${labelAt(i)}`}
                className="absolute -translate-x-1/2"
                style={{ left: `${total > 1 ? (i / (total - 1)) * 100 : 0}%` }}
              >
                {labelAt(i)}
              </span>
            ))}
          </div>
        </div>

        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-nc-text">
          {labelAt(step)}
        </span>
      </div>
    </div>
  );
}
