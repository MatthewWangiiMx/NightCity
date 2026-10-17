import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import TorontoCityViewer, { type CityViewMode } from '@/components/map/TorontoCityViewer';

const MODES = [
  { to: '/simulate', label: 'Simulate' },
  { to: '/explore', label: 'Explore City', explore: true },
  { to: '/plan', label: 'Plan' },
];

const plateClass =
  'min-w-[12rem] px-8 py-5 text-center font-mode text-xl font-medium tracking-[-0.02em] text-nc-text ' +
  'rounded-lg border border-white/15 bg-[#0a1620]/88 transition ' +
  'hover:border-white/30 hover:bg-[#0e1e2a]/94 sm:min-w-[13.5rem] sm:text-[1.35rem]';

function ModePlate({
  label,
  onClick,
  to,
}: {
  label: string;
  onClick?: () => void;
  to?: string;
}) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={plateClass}>
        {label}
      </button>
    );
  }

  return (
    <Link to={to!} className={plateClass}>
      {label}
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
