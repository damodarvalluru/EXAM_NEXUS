import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, children, className = '' }: CardProps) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-5 shadow-card transition-colors ${className}`}
    >
      {(title || subtitle) && (
        <header className="mb-4">
          {title && <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>}
          {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
