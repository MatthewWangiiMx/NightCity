import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A question mark that explains what a control actually does.
 *
 * Click rather than hover: these explanations run two or three sentences, and a
 * hover tooltip that vanishes when you move toward it cannot be read. Clicking
 * also works on touch, where hover does not exist.
 *
 * The popover renders in a portal on document.body with fixed positioning
 * rather than absolutely inside the panel. Every panel sets backdrop-blur,
 * which creates a stacking context, so a z-index inside one can never rise
 * above a sibling panel that paints later - the popover slid underneath the
 * widget next to it. A portal escapes all of that.
 *
 * Position is measured from the trigger and flipped or clamped to stay on
 * screen, then recomputed on scroll and resize while open.
 */

const WIDTH = 288; // px, matches w-72
const GAP = 8;
const MARGIN = 8; // keep this far from the viewport edge

type Pos = { top: number; left: number; placement: 'above' | 'below' };

export default function InfoTip({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = popRef.current?.offsetHeight ?? 160;

    // Prefer above; flip below when there is not room.
    const fitsAbove = r.top - GAP - height > MARGIN;
    const top = fitsAbove ? r.top - GAP - height : r.bottom + GAP;

    // Centre on the trigger, then clamp inside the viewport.
    const raw = r.left + r.width / 2 - WIDTH / 2;
    const left = Math.min(
      Math.max(MARGIN, raw),
      Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN),
    );

    setPos({ top, left, placement: fitsAbove ? 'above' : 'below' });
  }, []);

  // Measure after the popover has rendered, so its real height is known.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onMove = () => place();

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Capture phase: catches scrolling inside panels, not just the page.
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`What does ${title} do?`}
        onClick={(e) => {
          // The control is usually inside a <label>; without this the click
          // falls through and drags the slider.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border align-middle text-[9px] font-semibold leading-none transition ${
          open
            ? 'border-cyan-300/80 bg-cyan-400/20 text-cyan-100'
            : 'border-nc-border text-nc-muted hover:border-cyan-300/70 hover:text-cyan-200'
        }`}
      >
        ?
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: WIDTH,
              // Above every panel, HUD and the 3D canvas.
              zIndex: 9999,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="rounded-xl border border-cyan-400/30 bg-[#061018]/97 p-3 text-left shadow-2xl shadow-black/60 backdrop-blur-md"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
              {title}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-nc-text/90">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A muted line inside a tip for the assumption or caveat behind a control. */
export function TipNote({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 block text-[10px] leading-snug text-nc-muted">{children}</span>;
}
