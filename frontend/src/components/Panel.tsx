import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export default function Panel({ title, subtitle, actions, className = '', children }: Props) {
  return (
    <section
      className={`bg-nc-panel/80 border border-nc-border rounded-xl p-4 flex flex-col gap-3 ${className}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="text-xs text-nc-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
