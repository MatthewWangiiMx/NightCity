/**
 * Playback scrubber under the map. TODO: drive the map + charts from `step`,
 * mark the event time (e.g. the 18:42 solar drop) on the track.
 */
export default function Timeline({
  step = 0,
  total = 0,
  playing = false,
  onTogglePlay,
  onScrub,
}: {
  step?: number;
  total?: number;
  playing?: boolean;
  onTogglePlay?: () => void;
  onScrub?: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-nc-border bg-nc-panel/80 px-4 py-3">
      <button
        type="button"
        onClick={onTogglePlay}
        className="h-8 w-8 rounded-full border border-nc-border text-xs"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        value={step}
        onChange={(e) => onScrub?.(Number(e.target.value))}
        className="flex-1 accent-nc-renew"
      />
      <span className="w-20 text-right text-xs text-nc-muted">
        {total ? `${step + 1} / ${total}` : '—'}
      </span>
    </div>
  );
}
