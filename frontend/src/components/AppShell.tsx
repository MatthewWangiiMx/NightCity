import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const NAV = [
  { to: '/simulate', label: 'Simulate' },
  { to: '/explore', label: 'Explore City' },
  { to: '/plan', label: 'Plan' },
];

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div className="leading-tight">
      <div className={big ? 'text-5xl font-bold tracking-tight sm:text-6xl' : 'text-2xl font-bold tracking-tight'}>
        NIGHT<span className="text-nc-renew">CITY</span>
      </div>
      <div
        className={`uppercase tracking-[0.22em] text-nc-muted ${big ? 'mt-2 text-[11px]' : 'text-[9px]'}`}
      >
        AI-powered energy grid digital twin
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const path = useLocation().pathname;
  const onHome = path === '/';
  const onExploreCity = path === '/explore';
  const fullBleed = onHome || onExploreCity;

  return (
    <div className="flex min-h-full flex-col">
      {!fullBleed && (
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-nc-border/80 bg-nc-panel/40 px-6 py-3 backdrop-blur-md">
          <NavLink to="/">
            <Wordmark />
          </NavLink>

          <div className="hidden h-8 w-px bg-nc-border sm:block" />
          <p className="hidden text-xs text-nc-muted sm:block">
            Smarter dispatch. Cleaner energy.
            <span className="block text-[11px] text-nc-muted/70">A more resilient tomorrow.</span>
          </p>

          <nav className="flex gap-1 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 transition ${
                    isActive
                      ? 'bg-nc-panel text-nc-text ring-1 ring-nc-renew/40'
                      : 'text-nc-muted hover:bg-nc-panel/60 hover:text-nc-text'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <span className="ml-auto rounded border border-nc-border px-2 py-1 text-[10px] uppercase tracking-wide text-nc-muted">
            Simulated digital twin — illustrative data
          </span>
        </header>
      )}

      <main className={`flex-1 ${fullBleed ? '' : 'p-4'}`}>{children}</main>
    </div>
  );
}
