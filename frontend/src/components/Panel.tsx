import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Glass control-room panel: translucent surface, thin lit edge, quiet title. */
export default function Panel({ title, subtitle, actions, className = '', children }: Props) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-nc-border/80 bg-nc-panel/75 p-4 shadow-lg shadow-black/30 ring-1 ring-inset ring-white/5 backdrop-blur-md ${className}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-nc-text/90">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-nc-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
