import { Link } from 'react-router-dom';
import DistrictMap from '@/components/map/DistrictMap';
import { Wordmark } from '@/components/AppShell';
import { demoRun } from '@/demo/fixtures';

const MODES = [
  { to: '/simulate', icon: '▶', label: 'Simulate', blurb: 'Trigger an event' },
  { to: '/explore', icon: '◎', label: 'Explore City', blurb: 'Fly Toronto massing' },
  { to: '/plan', icon: '⚙', label: 'Plan', blurb: 'Tune and apply' },
];

/**
 * The city is the home screen: buildings fill the viewport as the background,
 * and the three modes are the only things you can click.
 */
export default function Home() {
  const run = demoRun();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <DistrictMap
        district={run.district}
        className="absolute inset-0 h-full w-full rounded-none border-0"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-nc-bg/55 via-nc-bg/15 to-nc-bg/70" />

      {/* Foreground */}
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-12 px-6 py-16 text-center">
        <div className="lg:absolute lg:left-6 lg:top-5 lg:text-left">
          <Wordmark size="lg" />
        </div>

        <nav className="flex flex-wrap items-stretch justify-center gap-5">
          {MODES.map((mode) => (
            <Link
              key={mode.to}
              to={mode.to}
              className="group w-44 rounded-2xl border border-nc-border/80 bg-nc-panel/70 p-6 shadow-xl shadow-black/40 ring-1 ring-inset ring-white/10 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-nc-renew hover:bg-nc-panel/90 sm:w-52"
            >
              <span className="block text-4xl text-nc-renew drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]" aria-hidden>
                {mode.icon}
              </span>
              <span className="mt-4 block text-2xl font-semibold">{mode.label}</span>
              <span className="mt-1 block text-xs text-nc-muted">{mode.blurb}</span>
            </Link>
          ))}
        </nav>

        <p className="absolute bottom-6 text-[11px] uppercase tracking-[0.18em] text-nc-muted">
          Simulated digital twin · synthetic data
        </p>
      </div>
    </div>
  );
}
