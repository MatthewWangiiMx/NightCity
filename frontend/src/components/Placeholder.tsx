/** Marks a region of the skeleton that still needs real data or visuals. */
export default function Placeholder({ label, height = 140 }: { label: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-nc-border text-xs text-nc-muted"
      style={{ height }}
    >
      {label}
    </div>
  );
}
