import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';

interface ModuleStatus {
  module: string;
  phase: number;
  implemented: boolean;
}

interface DependencyCheck {
  status: string;
  latencyMs?: number;
}

interface HealthPayload {
  status: string;
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    storage: { status: string };
  };
}

export function PlatformPage() {
  const modules = useQuery({
    queryKey: ['platform', 'modules'],
    queryFn: ({ signal }) => apiGet<ModuleStatus[]>('/modules', { signal }),
  });
  const health = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: ({ signal }) => apiGet<HealthPayload>('/health/ready', { signal, raw: true }),
  });

  const implemented = modules.data?.filter((item) => item.implemented).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
        <p className="mt-1 text-sm text-muted">
          Live backend status. All values on this page come from the API — no demo figures.
        </p>
      </div>

      {(modules.isError || health.isError) && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Backend unreachable</p>
            <p className="mt-1 text-xs opacity-90">
              {modules.error?.message ?? health.error?.message ?? 'Unknown error'}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void modules.refetch();
              void health.refetch();
            }}
          >
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="API status" loading={health.isLoading}>
          {health.data ? (
            <Badge tone={health.data.status === 'ready' ? 'success' : 'danger'}>
              {health.data.status}
            </Badge>
          ) : (
            <span className="text-sm text-muted">Unavailable</span>
          )}
        </MetricCard>
        <MetricCard label="Database" loading={health.isLoading}>
          {health.data ? (
            <div className="text-sm">
              <Badge tone={health.data.checks.database.status === 'up' ? 'success' : 'danger'}>
                {health.data.checks.database.status}
              </Badge>
              {health.data.checks.database.latencyMs !== undefined && (
                <span className="ml-2 text-xs text-muted">
                  {health.data.checks.database.latencyMs} ms
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted">Unavailable</span>
          )}
        </MetricCard>
        <MetricCard label="Redis" loading={health.isLoading}>
          {health.data ? (
            <Badge tone={health.data.checks.redis.status === 'up' ? 'success' : 'danger'}>
              {health.data.checks.redis.status}
            </Badge>
          ) : (
            <span className="text-sm text-muted">Unavailable</span>
          )}
        </MetricCard>
        <MetricCard label="Modules implemented" loading={modules.isLoading}>
          <span className="text-2xl font-semibold">
            {implemented}
            <span className="text-sm font-normal text-muted"> / {modules.data?.length ?? '—'}</span>
          </span>
        </MetricCard>
      </div>

      <Card
        title="Backend modules"
        subtitle="Implementation status reported by the API. Future phases flip these flags as code ships."
      >
        {modules.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-10 w-full" />
            ))}
          </div>
        ) : modules.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Module</th>
                  <th className="py-2">Target phase</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {modules.data.map((item) => (
                  <tr key={item.module} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5 font-medium">{item.module}</td>
                    <td className="py-2.5 text-muted">Phase {item.phase}</td>
                    <td className="py-2.5">
                      <Badge tone={item.implemented ? 'success' : 'neutral'}>
                        {item.implemented ? 'Implemented' : 'Planned'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">No module metadata available.</p>
        )}
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  loading,
  children,
}: {
  label: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-3 min-h-8">
        {loading ? <Skeleton className="h-7 w-24" /> : children}
      </div>
    </Card>
  );
}
