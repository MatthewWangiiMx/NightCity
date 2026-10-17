import { Link } from 'react-router-dom';
import DistrictMap from '@/components/map/DistrictMap';
import Panel from '@/components/Panel';
import GridStatusPanel from '@/components/panels/GridStatusPanel';
import DemandVsRenewables from '@/components/charts/DemandVsRenewables';
import ScenarioComparison from '@/components/panels/ScenarioComparison';
import { Wordmark } from '@/components/AppShell';
import { demoRun } from '@/demo/fixtures';

const MODES = [
  { to: '/simulate', icon: '▶', label: 'Simulate', blurb: 'Trigger an event' },
  { to: '/explore', icon: '◎', label: 'Explore', blurb: 'Inspect the district' },
  { to: '/plan', icon: '⚙', label: 'Plan', blurb: 'Tune and apply' },
];

/**
 * The city is the home screen: the live dashboard sits behind, inert, and the
 * three modes are the only things you can click.
 */
export default function Home() {
  const run = demoRun();

  return (
    <div className="relative min-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-nc-border">
      <DistrictMap
        district={run.district}
        className="absolute inset-0 h-full w-full rounded-none border-0"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-nc-bg/75 via-nc-bg/25 to-nc-bg/85" />

      {/* Dashboard preview — visible, not interactive */}
      {/* Panels start below the wordmark, which is pinned to the same corner */}
      <div className="pointer-events-none absolute inset-0 hidden flex-col justify-between p-5 pt-28 opacity-70 lg:flex">
        <div className="flex items-start justify-between gap-4">
          <div className="w-[320px] space-y-4">
            <GridStatusPanel status={run.grid_status} scenario={run.scenario} />
            <Panel title="Demand vs Renewable Generation" subtitle="MW across the evening window">
              <DemandVsRenewables steps={run.optimized} height={150} />
            </Panel>
          </div>
          <div className="w-[340px]">
            <ScenarioComparison
              baseline={run.baseline_metrics}
              optimized={run.optimized_metrics}
            />
          </div>
        </div>
      </div>

      {/* Foreground */}
      <div className="relative flex min-h-[calc(100vh-2rem)] flex-col items-center justify-center gap-12 px-6 py-16 text-center">
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
