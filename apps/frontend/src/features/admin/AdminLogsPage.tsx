import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Pagination, statusTone } from '../../components/ui/DataState';

interface AuthEventRow {
  id: string;
  email: string | null;
  method: string;
  outcome: string;
  ip: string | null;
  location: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  tenantId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  ip: string | null;
  correlationId: string | null;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function useFilters() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [action, setAction] = useState('');
  return { page, setPage, search, setSearch, outcome, setOutcome, action, setAction };
}

function FilterBar({ filters, showAction = false }: { filters: ReturnType<typeof useFilters>; showAction?: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap gap-3">
      <input
        className="input max-w-xs"
        placeholder="Search"
        value={filters.search}
        onChange={(event) => { filters.setSearch(event.target.value); filters.setPage(1); }}
      />
      <select
        className="input max-w-xs"
        value={filters.outcome}
        onChange={(event) => { filters.setOutcome(event.target.value); filters.setPage(1); }}
      >
        <option value="">All outcomes</option>
        {['SUCCESS', 'FAILURE', 'DENIED', 'ERROR', 'MFA_REQUIRED'].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      {showAction && (
        <input
          className="input max-w-xs"
          placeholder="Action contains"
          value={filters.action}
          onChange={(event) => { filters.setAction(event.target.value); filters.setPage(1); }}
        />
      )}
    </div>
  );
}

export function AdminAuthLogsPage() {
  const filters = useFilters();
  const query = useQuery({
    queryKey: ['admin', 'auth-events', filters.page, filters.search, filters.outcome],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
      if (filters.search) params.set('search', filters.search);
      if (filters.outcome) params.set('outcome', filters.outcome);
      return apiGet<Page<AuthEventRow>>(`/admin/auth-events?${params.toString()}`, { signal });
    },
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Authentication logs" subtitle="Real sign-in, PIN, MFA and recovery events." />
      <Card>
        <FilterBar filters={filters} />
        {query.isError ? (
          <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading || !query.data ? (
          <LoadingRows />
        ) : query.data.items.length === 0 ? (
          <EmptyState message="No authentication events match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">When</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Method</th>
                  <th className="py-2">Outcome</th>
                  <th className="py-2">IP / location</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((event) => (
                  <tr key={event.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="py-2">{event.email ?? '—'}</td>
                    <td className="py-2 text-xs">{event.method}</td>
                    <td className="py-2"><Badge tone={statusTone(event.outcome)}>{event.outcome}</Badge></td>
                    <td className="py-2 text-xs text-muted">{event.ip ?? '—'}{event.location ? ` · ${event.location}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4"><Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={filters.setPage} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminAuditLogsPage() {
  const filters = useFilters();
  const query = useQuery({
    queryKey: ['admin', 'audit-logs', filters.page, filters.search, filters.outcome, filters.action],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
      if (filters.search) params.set('search', filters.search);
      if (filters.outcome) params.set('outcome', filters.outcome);
      if (filters.action) params.set('action', filters.action);
      return apiGet<Page<AuditRow>>(`/admin/audit-logs?${params.toString()}`, { signal });
    },
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Audit logs" subtitle="Elevated, tamper-resistant record of privileged actions." />
      <Card>
        <FilterBar filters={filters} showAction />
        {query.isError ? (
          <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading || !query.data ? (
          <LoadingRows />
        ) : query.data.items.length === 0 ? (
          <EmptyState message="No audit events match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">When</th>
                  <th className="py-2">Actor</th>
                  <th className="py-2">Action</th>
                  <th className="py-2">Resource</th>
                  <th className="py-2">Outcome</th>
                  <th className="py-2">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((event) => (
                  <tr key={event.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="py-2">{event.actorEmail ?? '—'}</td>
                    <td className="py-2 font-mono text-xs">{event.action}</td>
                    <td className="py-2 text-xs text-muted">{event.resourceType}{event.resourceId ? `: ${event.resourceId}` : ''}</td>
                    <td className="py-2"><Badge tone={statusTone(event.outcome)}>{event.outcome}</Badge></td>
                    <td className="py-2 font-mono text-[10px] text-muted">{event.correlationId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4"><Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={filters.setPage} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}
