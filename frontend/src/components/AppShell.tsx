import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const NAV = [
  { to: '/explore', label: 'Explore City' },
  { to: '/plan', label: 'Plan' },
];

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  return (
    <img
      src="/nightcity-logo.png"
      alt="Night City"
      className={big ? 'h-16 w-auto sm:h-24' : 'h-8 w-auto'}
    />
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const path = useLocation().pathname;
  const onHome = path === '/';
  const onExploreCity = path === '/explore';
  const onPlan = path === '/plan';
  const onSimulate = path === '/simulate';
  const fullBleed = onHome || onExploreCity;
  const cityBackdrop = onPlan || onSimulate;

  return (
    <div className="flex min-h-full flex-col">
      {!fullBleed && (
        <header className="relative z-20 flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-nc-border/60 bg-nc-panel/55 px-6 py-3">
          <NavLink to="/">
            <Wordmark />
          </NavLink>

          <nav className="flex items-center gap-6 text-sm font-mode">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `pb-0.5 transition-colors ${
                    isActive
                      ? 'text-nc-text border-b border-nc-text'
                      : 'text-nc-muted border-b border-transparent hover:text-nc-text'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
      )}

      <main className={`flex-1 ${fullBleed || cityBackdrop ? '' : 'p-4'} ${cityBackdrop ? 'relative' : ''}`}>
        {children}
      </main>
    </div>
  );
}
