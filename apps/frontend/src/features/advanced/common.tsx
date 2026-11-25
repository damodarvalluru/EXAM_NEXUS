import { useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { ErrorBanner } from '../../components/ui/DataState';

type Tone = 'success' | 'danger' | 'warning' | 'info';

/** Turns API status codes and transport failures into actionable UI copy. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session has expired. Sign in again and retry.';
    if (error.status === 403) return 'You do not have permission for this action.';
    if (error.status === 0 || error.code === 'NETWORK_ERROR') {
      return 'Network unavailable. Check your connection and retry.';
    }
    return error.message;
  }
  if (error instanceof TypeError) return 'Network unavailable. Check your connection and retry.';
  return error instanceof Error ? error.message : 'Request failed';
}

export function AdvancedErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <ErrorBanner error={new Error(describeError(error))} onRetry={onRetry} />;
}

export function Notice({ message, tone = 'success' }: { message: string | null; tone?: Tone }) {
  if (!message) return null;
  const classes: Record<Tone, string> = {
    success: 'border-success/30 bg-success/10 text-success',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    info: 'border-brand/30 bg-brand/10 text-brand',
  };
  return (
    <p className={`rounded-lg border p-3 text-sm ${classes[tone]}`} role="status" aria-live="polite">
      {message}
    </p>
  );
}

export function AdvisoryNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
      <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">ⓘ</span>
      <div>{children}</div>
    </div>
  );
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Renders only values returned by the API; never invents placeholder evidence. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function riskTone(level: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (level === 'HIGH' || level === 'CRITICAL') return 'danger';
  if (level === 'MODERATE') return 'warning';
  if (level === 'LOW' || level === 'NORMAL') return 'success';
  return 'neutral';
}

export function resultTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'APPROVED' || status === 'PUBLISHED') return 'success';
  if (status === 'REJECTED' || status === 'WITHHELD') return 'danger';
  if (status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'REVISION') return 'warning';
  return 'neutral';
}

/** Creates and revokes a blob URL for authenticated CSV/PDF downloads. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useInvalidateAdvanced() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['advanced'] });
  }, [queryClient]);
}
