import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import TorontoCityViewer, { type CityViewMode } from '@/components/map/TorontoCityViewer';

const MODES = [
  { to: '/simulate', label: 'Simulate', chip: 'MODE' },
  { to: '/explore', label: 'Explore City', chip: 'CITY', explore: true },
  { to: '/plan', label: 'Plan', chip: 'MODE' },
];

const plateClass =
  'group relative flex min-w-[14rem] items-center justify-center overflow-hidden px-10 py-7 text-center ' +
  'rounded-xl transition duration-300 sm:min-w-[15.5rem] sm:px-12 sm:py-8 ' +
  'bg-[linear-gradient(145deg,rgba(8,24,36,0.78),rgba(4,14,24,0.72))] ' +
  'shadow-[0_0_20px_rgba(34,211,238,0.1),inset_0_1px_0_rgba(186,230,253,0.14)] ' +
  'hover:-translate-y-0.5 hover:bg-[linear-gradient(145deg,rgba(12,36,52,0.88),rgba(6,20,32,0.8))] ' +
  'hover:shadow-[0_0_32px_rgba(34,211,238,0.28),inset_0_1px_0_rgba(186,230,253,0.22)]';

/** HUD nameplate chrome matching the 3D building signs. */
function ModePlate({
  label,
  chip,
  onClick,
  to,
}: {
  label: string;
  chip: string;
  onClick?: () => void;
  to?: string;
}) {
  const inner = (
    <>
      {/* Glass sheen */}
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.1)_0%,transparent_42%,transparent_58%,rgba(34,211,238,0.06)_100%)]" />
      {/* Cyan frame */}
      <span className="pointer-events-none absolute inset-0 rounded-xl border border-cyan-300/55 group-hover:border-cyan-300/90" />
      {/* Corner brackets */}
      <span className="pointer-events-none absolute left-1 top-1 h-3 w-3 border-l-2 border-t-2 border-emerald-300/80" />
      <span className="pointer-events-none absolute right-1 top-1 h-3 w-3 border-r-2 border-t-2 border-emerald-300/80" />
      <span className="pointer-events-none absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2 border-emerald-300/80" />
      <span className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-emerald-300/80" />
      {/* Soft outer glow */}
      <span className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-cyan-400/10 opacity-70 blur-md group-hover:opacity-100" />

      <span className="relative flex flex-col items-center gap-2 font-mode">
        <span className="rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-200/90">
          {chip}
        </span>
        <span className="text-2xl font-semibold tracking-[-0.02em] text-[#e8f7ff] sm:text-[1.75rem]">
          {label}
        </span>
        <span className="h-px w-16 bg-gradient-to-r from-transparent via-sky-300/55 to-transparent" />
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={plateClass}>
        {inner}
      </button>
    );
  }

  return (
    <Link to={to!} className={plateClass}>
      {inner}
    </Link>
  );
}

/**
 * Shared 3D city stage for Home + Explore City so the zoom transition
 * never unloads the WebGL scene.
 */
export default function CityExperience() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onExplorePath = pathname === '/explore';

  const [mode, setMode] = useState<CityViewMode>(() => (onExplorePath ? 'explore' : 'preview'));

  // Browser back/forward + direct URL hits (never interrupt an in-flight zoom)
  useEffect(() => {
    if (onExplorePath) setMode('explore');
    else setMode((m) => (m === 'zoom' ? m : 'preview'));
  }, [onExplorePath]);

  const startExploreZoom = () => {
    if (mode === 'zoom' || mode === 'explore') return;
    setMode('zoom');
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-nc-bg">
      <TorontoCityViewer
        mode={mode}
        onZoomComplete={() => {
          navigate('/explore');
          setMode('explore');
        }}
      />

      {mode === 'preview' && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-nc-bg/60 via-nc-bg/10 to-nc-bg/75" />

          <div className="pointer-events-none relative flex h-full min-h-screen flex-col items-center justify-center px-6 text-center">
            <div className="pointer-events-auto flex flex-col items-center gap-10 sm:gap-12">
              <img
                src="/nightcity-logo.png"
                alt="Night City"
                className="h-auto w-[min(80vw,32rem)] object-contain drop-shadow-[0_0_28px_rgba(34,211,238,0.25)]"
              />

              <nav className="m-0 flex flex-wrap items-center justify-center gap-4 p-0 sm:gap-5">
                {MODES.map((item) => (
                  <ModePlate
                    key={item.to}
                    label={item.label}
                    chip={item.chip}
                    to={item.explore ? undefined : item.to}
                    onClick={item.explore ? startExploreZoom : undefined}
                  />
                ))}
              </nav>
            </div>
          </div>
        </div>
      )}

      {mode === 'zoom' && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-transparent via-transparent to-nc-bg/30 transition-opacity" />
      )}

      <Outlet />
    </div>
  );
}
