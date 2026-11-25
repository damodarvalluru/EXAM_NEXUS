import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@examnexus/shared';
import type {
  AnalyticsReportView,
  LiveAttemptView,
  NotificationView,
  PlatformSettingView,
  SecurityAlertView,
  SecurityIncidentView,
  SubscriptionView,
  SupportTicketView,
  SystemHealthView,
} from '@examnexus/shared';
import { apiDownload, apiGet, apiPatch, apiPost } from '../../lib/api-client';
import { hasPermission } from '../../components/auth/PermissionGate';
import { useAuth } from '../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';

interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function usePaged<T>(key: string, path: string) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [key, page],
    queryFn: ({ signal }) => apiGet<Paged<T>>(`${path}?page=${page}&pageSize=25`, { signal }),
  });
  return { ...query, page, setPage };
}

export function AdminAnalyticsPage() {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const query = useQuery({
    queryKey: ['admin', 'analytics', range],
    queryFn: ({ signal }) => apiGet<AnalyticsReportView>(`/admin/analytics?range=${range}`, { signal }),
  });
  const download = async () => {
    const blob = await apiDownload(`/admin/analytics/export?kind=attempts&range=${range}`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `examnexus-attempts-${range}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };

  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Reports and analytics" subtitle="Computed from live organisational, examination and attempt records." action={
        <div className="flex gap-2">
          <select className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
          </select>
          <Button variant="secondary" onClick={() => void download()}>Export CSV</Button>
        </div>
      } />
      {query.isLoading || !query.data ? <LoadingRows count={8} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Organisations" value={query.data.summary.organisations} />
            <Metric label="Examinations" value={query.data.summary.examinations} />
            <Metric label="Attempts" value={query.data.summary.attempts} />
            <Metric label="Average score" value={query.data.summary.averageScore} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Attempts by day"><Series rows={query.data.series.attempts} /></Card>
            <Card title="Failed logins by day"><Series rows={query.data.series.failedLogins} /></Card>
          </div>
          <Card title="By organisation">
            {!query.data.byOrganisation.length ? <EmptyState message="No organisations recorded." /> : (
              <div className="space-y-2">
                {query.data.byOrganisation.map((row) => (
                  <div key={row.tenantId} className="flex justify-between text-sm"><span>{row.organisation}</span><span>{row.attempts} attempts</span></div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export function AdminSecurityCentrePage() {
  const alerts = usePaged<SecurityAlertView>('security-alerts', '/admin/security/alerts');
  const incidents = usePaged<SecurityIncidentView>('security-incidents', '/admin/security/incidents');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // The API enforces platform.security.manage on every alert/incident mutation;
  // read-only users must not be offered the matching controls.
  const canManageSecurity = hasPermission(user?.permissions ?? [], PERMISSIONS.PLATFORM_SECURITY_MANAGE);
  const [error, setError] = useState<string | null>(null);
  const updateAlert = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/admin/security/alerts/${id}`, { status }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['security-alerts'] }); },
    onError: (err) => setError(messageOf(err)),
  });
  if (alerts.isError) return <ErrorBanner error={alerts.error} onRetry={() => void alerts.refetch()} />;
  if (incidents.isError) return <ErrorBanner error={incidents.error} onRetry={() => void incidents.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Security centre" subtitle="Real alerts and incidents recorded by the platform." />
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <Card title="Security alerts">
        {alerts.isLoading ? <LoadingRows count={5} /> : !alerts.data?.items.length ? <EmptyState message="No security alerts." /> : (
          <div className="space-y-2">
            {alerts.data.items.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                <div><p className="font-medium">{alert.title}</p><p className="text-xs text-muted">{alert.category} · {alert.organisation ?? 'Platform'} · {alert.createdAt.slice(0, 10)}</p></div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(alert.status)}>{alert.status}</Badge>
                  {alert.status === 'OPEN' && canManageSecurity && <Button variant="secondary" disabled={updateAlert.isPending} onClick={() => updateAlert.mutate({ id: alert.id, status: 'INVESTIGATING' })}>Investigate</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Security incidents">
        {incidents.isLoading ? <LoadingRows count={5} /> : !incidents.data?.items.length ? <EmptyState message="No security incidents." /> : (
          <div className="space-y-2">
            {incidents.data.items.map((incident) => (
              <div key={incident.id} className="flex items-center justify-between rounded-lg border border-line p-3 text-sm">
                <span>{incident.classification}</span><Badge tone={statusTone(incident.status)}>{incident.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminSystemHealthPage() {
  const query = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: ({ signal }) => apiGet<SystemHealthView>('/admin/health', { signal }),
    refetchInterval: 15_000,
  });
  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="System health" subtitle="Live database, Redis, queue and storage checks." />
      {query.isLoading || !query.data ? <LoadingRows count={6} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="API status" value={query.data.api.status} />
            <Metric label="Uptime (s)" value={query.data.api.uptimeSeconds} />
            <Metric label="Storage objects" value={query.data.storage.objects} />
            <Metric label="Storage bytes" value={query.data.storage.bytes} />
          </div>
          <Card title="Components">
            <div className="space-y-2">
              {query.data.components.map((component) => (
                <div key={component.component} className="flex items-center justify-between rounded border border-line p-2 text-sm">
                  <span>{component.component}</span>
                  <span className="flex items-center gap-2"><span className="text-xs text-muted">{component.latencyMs ?? 0} ms</span><Badge tone={statusTone(component.status)}>{component.status}</Badge></span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Queues">
            {!query.data.queues.length ? <EmptyState message="No queues registered." /> : (
              <div className="space-y-2">
                {query.data.queues.map((queue) => (
                  <div key={queue.name} className="flex justify-between text-sm"><span>{queue.name}</span><span>{queue.waiting} waiting · {queue.failed} failed</span></div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export function AdminNotificationsPage() {
  const notifications = usePaged<NotificationView>('notifications', '/admin/notifications');
  if (notifications.isError) return <ErrorBanner error={notifications.error} onRetry={() => void notifications.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" subtitle="Delivery records from the platform notification system." />
      <Card title="Notification log">
        {notifications.isLoading ? <LoadingRows count={6} /> : !notifications.data?.items.length ? <EmptyState message="No notifications recorded." /> : (
          <div className="space-y-2">
            {notifications.data.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded border border-line p-2 text-sm">
                <span>{item.subject ?? item.templateKey ?? item.channel}</span><Badge tone={statusTone(item.status)}>{item.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

interface CheckoutResult {
  provider: string;
  sessionId: string | null;
  checkoutUrl: string;
  expiresAt: string | null;
}

export function AdminSubscriptionsPage() {
  const query = useQuery({ queryKey: ['admin', 'subscriptions'], queryFn: ({ signal }) => apiGet<SubscriptionView[]>('/admin/subscriptions', { signal }) });
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = hasPermission(user?.permissions ?? [], PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const refetchSubscriptions = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });

  const checkout = useMutation({
    mutationFn: (input: { tenantId: string; plan: string; billingCycle: string }) =>
      apiPost<CheckoutResult>('/admin/billing/checkout', input),
    onSuccess: (result) => { setError(null); setCheckoutUrl(result.checkoutUrl); refetchSubscriptions(); },
    onError: (err) => setError(messageOf(err)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {}),
    onSuccess: () => { setError(null); refetchSubscriptions(); },
    onError: (err) => setError(messageOf(err)),
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/billing/subscriptions/${encodeURIComponent(id)}/restore`, {}),
    onSuccess: () => { setError(null); refetchSubscriptions(); },
    onError: (err) => setError(messageOf(err)),
  });

  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Subscription and billing" subtitle="Organisation subscription records and provider-hosted checkout." />
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {checkoutUrl && (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          Checkout session created by the provider.{' '}
          <a className="text-brand underline" href={checkoutUrl} target="_blank" rel="noopener noreferrer">Open provider checkout</a>
        </p>
      )}
      <Card title="Subscriptions">
        {query.isLoading ? <LoadingRows count={5} /> : !query.data?.length ? <EmptyState message="No subscriptions recorded." /> : (
          <div className="space-y-2">
            {query.data.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between rounded border border-line p-3 text-sm">
                <span>{item.organisation} · {item.plan}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  {canManage && (
                    <>
                      <Button variant="secondary" disabled={checkout.isPending} onClick={() => checkout.mutate({ tenantId: item.tenantId, plan: item.plan, billingCycle: item.billingCycle })}>
                        Checkout
                      </Button>
                      {item.status === 'CANCELLED' || item.status === 'EXPIRED' ? (
                        <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate(item.id)}>Restore</Button>
                      ) : (
                        <Button variant="secondary" disabled={cancel.isPending || item.status === 'CANCELLED'} onClick={() => cancel.mutate(item.id)}>Cancel</Button>
                      )}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminSupportPage() {
  const tickets = usePaged<SupportTicketView>('support-tickets', '/admin/support/tickets');
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => apiPost('/admin/support/tickets', { subject, body, category: 'GENERAL', priority: 'MEDIUM' }),
    onSuccess: () => { setSubject(''); setBody(''); setError(null); void queryClient.invalidateQueries({ queryKey: ['support-tickets'] }); },
    onError: (err) => setError(messageOf(err)),
  });
  if (tickets.isError) return <ErrorBanner error={tickets.error} onRetry={() => void tickets.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Support and complaints" subtitle="Track and resolve support requests." />
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <Card title="New ticket">
        <div className="space-y-2">
          <input className="w-full rounded-lg border border-line bg-surface-2 p-2 text-sm" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <textarea className="w-full rounded-lg border border-line bg-surface-2 p-2 text-sm" placeholder="Describe the issue" value={body} onChange={(event) => setBody(event.target.value)} />
          <Button disabled={!subject || !body || create.isPending} onClick={() => create.mutate()}>Create ticket</Button>
        </div>
      </Card>
      <Card title="Tickets">
        {tickets.isLoading ? <LoadingRows count={5} /> : !tickets.data?.items.length ? <EmptyState message="No support tickets." /> : (
          <div className="space-y-2">
            {tickets.data.items.map((ticket) => (
              <div key={ticket.id} className="flex items-center justify-between rounded border border-line p-3 text-sm">
                <span>{ticket.subject}</span><Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminConfigurationPage() {
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: ({ signal }) => apiGet<PlatformSettingView[]>('/admin/settings', { signal }) });
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiPatch(`/admin/settings/${encodeURIComponent(key)}`, { value: JSON.parse(value) as Record<string, unknown> }),
    onSuccess: () => { setKey(''); setError(null); void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }); },
    onError: (err) => setError(messageOf(err)),
  });
  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform configuration" subtitle="Versioned platform settings stored in the database." />
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <Card title="Update setting">
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-line bg-surface-2 p-2 text-sm" placeholder="Setting key" value={key} onChange={(event) => setKey(event.target.value)} />
          <input className="rounded-lg border border-line bg-surface-2 p-2 text-sm" placeholder='{"enabled":true}' value={value} onChange={(event) => setValue(event.target.value)} />
        </div>
        <Button className="mt-2" disabled={!key || save.isPending} onClick={() => save.mutate()}>Save setting</Button>
      </Card>
      <Card title="Settings">
        {query.isLoading ? <LoadingRows count={5} /> : !query.data?.length ? <EmptyState message="No platform settings." /> : (
          <div className="space-y-2">
            {query.data.map((setting) => (
              <div key={setting.key} className="rounded border border-line p-3 text-sm">
                <p className="font-medium">{setting.key}</p>
                <pre className="mt-1 overflow-auto text-xs text-muted">{JSON.stringify(setting.value, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminLiveAttemptsPage() {
  const query = useQuery({
    queryKey: ['admin', 'live-attempts'],
    queryFn: ({ signal }) => apiGet<LiveAttemptView[]>('/admin/live/attempts', { signal }),
    refetchInterval: 10_000,
  });
  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Live examination attempts" subtitle="Active attempts across all tenants." />
      <Card title="Active attempts">
        {query.isLoading ? <LoadingRows count={6} /> : !query.data?.length ? <EmptyState message="No active attempts." /> : (
          <div className="space-y-2">
            {query.data.map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between rounded border border-line p-3 text-sm">
                <span>{attempt.candidate} · {attempt.examination}</span>
                <span className="flex items-center gap-2"><Badge tone={attempt.riskScore > 60 ? 'danger' : 'neutral'}>Risk {attempt.riskScore}</Badge><span className="text-xs text-muted">{attempt.organisation}</span></span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className="mt-2 text-2xl font-semibold">{String(value)}</p></Card>
  );
}

function Series({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (!rows.length) return <EmptyState message="No data in this range." />;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-1.5">
      {rows.slice(-14).map((row) => (
        <div key={row.label} className="grid grid-cols-[80px_1fr_40px] items-center gap-2 text-xs">
          <span className="text-muted">{row.label.slice(5)}</span>
          <div className="h-2 rounded bg-surface-2"><div className="h-2 rounded bg-brand" style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <span className="text-right">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
