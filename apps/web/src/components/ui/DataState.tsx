import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import type { ApiError } from '../../lib/api-client';
import { Button } from './Button';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : (error as ApiError)?.message ?? 'Request failed';
  return (
    <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Unable to load live data</p>
        <p className="mt-1 text-xs opacity-90">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted">
      <Inbox size={22} />
      <p>{message}</p>
    </div>
  );
}

export function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (['APPROVED', 'ACTIVE', 'CONNECTED', 'SUCCESS', 'VERIFIED'].includes(status)) return 'success';
  if (['REJECTED', 'SUSPENDED', 'LOCKED', 'FAILED', 'DENIED', 'ERROR'].includes(status)) return 'danger';
  if (['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'PENDING_VERIFICATION', 'WARNING'].includes(status)) return 'warning';
  return 'neutral';
}
