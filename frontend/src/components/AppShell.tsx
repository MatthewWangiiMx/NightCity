import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Command Center', end: true },
  { to: '/what-if', label: 'What-if Lab' },
  { to: '/dispatch', label: 'Dispatch Review' },
  { to: '/results', label: 'Results' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 border-b border-nc-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            NIGHT<span className="text-nc-renew">CITY</span>
          </h1>
          <p className="text-xs text-nc-muted">AI-powered energy grid digital twin</p>
        </div>
        <nav className="flex gap-1 text-sm">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md ${isActive ? 'bg-nc-panel text-nc-text' : 'text-nc-muted hover:text-nc-text'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto text-[11px] uppercase tracking-wide text-nc-muted border border-nc-border rounded px-2 py-1">
          Simulated digital twin — illustrative data
        </span>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
