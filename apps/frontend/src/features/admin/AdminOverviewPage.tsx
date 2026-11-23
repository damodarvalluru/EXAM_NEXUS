import { useQuery } from '@tanstack/react-query';
import type { PlatformOverview } from '@examnexus/shared';
import { apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ErrorBanner, LoadingRows, PageHeader } from '../../components/ui/DataState';
import { Skeleton } from '../../components/ui/Skeleton';

export function AdminOverviewPage() {
  const query = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: ({ signal }) => apiGet<PlatformOverview>('/admin/overview', { signal }),
  });

  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" subtitle="Live counts computed from the database on every request." />
      {query.isLoading || !query.data ? <LoadingRows count={8} /> : <Overview data={query.data} />}
    </div>
  );
}

function Overview({ data }: { data: PlatformOverview }) {
  const metrics = [
    { label: 'Organisations', value: data.organisations.total },
    { label: 'Pending verification', value: data.organisations.pending },
    { label: 'Users', value: data.users.total },
    { label: 'Super Admins', value: data.users.superAdmins },
    { label: 'Examinations', value: data.examinations.total },
    { label: 'Live exams', value: data.examinations.live },
    { label: 'Integrations', value: data.integrations.total },
    { label: 'Auth events (24h)', value: data.authentication.last24Hours },
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold">{metric.value.toLocaleString()}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Organisations by status">
          <Breakdown rows={data.organisations.byStatus} />
        </Card>
        <Card title="Authentication outcomes (24h)">
          <Breakdown rows={data.authentication.byOutcome} />
        </Card>
      </div>
      <Card title="Operational signals">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Signal label="Failed logins (24h)" value={data.authentication.failedLast24Hours} />
          <Signal label="Audit events (24h)" value={data.audit.last24Hours} />
          <Signal label="Exam attempts" value={data.examinations.attempts} />
        </div>
      </Card>
    </>
  );
}

function Breakdown({ rows }: { rows: Array<{ status?: string; outcome?: string; count: number }> }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted">No data recorded.</p>;
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${row.status ?? row.outcome}-${index}`} className="flex items-center justify-between text-sm">
          <Badge tone="neutral">{row.status ?? row.outcome}</Badge>
          <span className="font-medium">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

export function AdminOverviewSkeleton() {
  return <Skeleton className="h-24 w-full" />;
}
