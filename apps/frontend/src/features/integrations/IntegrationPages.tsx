import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiClientView,
  CreateApiKeyResult,
  IntegrationDetail,
  IntegrationMonitoringView,
  IntegrationView,
  WebhookEndpointView,
} from '@examnexus/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';

function notice(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

interface OneTimeSecretValue {
  title: string;
  description?: string;
  value: string;
}

function OneTimeSecretDialog({ title, description, value, onAcknowledge }: OneTimeSecretValue & { onAcknowledge: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted">This secret is returned once. Copy and store it before acknowledging; it cannot be retrieved later.</p>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 p-2 text-xs">{value}</code>
          <Button variant="secondary" onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy'}</Button>
        </div>
        {copyState === 'failed' && <p className="mt-1 text-xs text-danger">Clipboard unavailable—select the value manually.</p>}
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I have copied and stored this secret securely.
        </label>
        <div className="mt-4 flex justify-end">
          <Button disabled={!acknowledged} onClick={onAcknowledge}>Done — clear secret</Button>
        </div>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecretValue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['integrations'],
    queryFn: ({ signal }) => apiGet<IntegrationView[]>('/integrations', { signal }),
  });
  const detail = useQuery({
    queryKey: ['integrations', selectedId],
    queryFn: ({ signal }) => apiGet<IntegrationDetail>(`/integrations/${selectedId}`, { signal }),
    enabled: Boolean(selectedId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['integrations'] });
  const storeCredential = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      apiPost(`/integrations/${id}/credentials`, { keyId: 'primary', secret: value }),
    onSuccess: () => { setSecret(''); setMessage('Credential stored securely.'); setError(null); invalidate(); },
    onError: (err) => setError(notice(err)),
  });
  const test = useMutation({
    mutationFn: (id: string) => apiPost<{ ok: boolean; message: string }>(`/integrations/${id}/test`, {}),
    onSuccess: (result) => { setMessage(result.message); setError(null); invalidate(); },
    onError: (err) => setError(notice(err)),
  });
  const sync = useMutation({
    mutationFn: ({ id, dryRun }: { id: string; dryRun: boolean }) => apiPost<{ processed: number; created: number; updated: number; failed: number }>(`/integrations/${id}/sync`, { dryRun }),
    onSuccess: (result) => { setMessage(`Processed ${result.processed}; created ${result.created}; updated ${result.updated}; failed ${result.failed}.`); setError(null); invalidate(); },
    onError: (err) => setError(notice(err)),
  });
  const createWebhook = useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) =>
      apiPost<WebhookEndpointView>(`/integrations/${id}/webhook`, { url, events: ['candidate.created', 'candidate.updated'] }),
    onSuccess: (result) => {
      setWebhookUrl('');
      if (result.secret) {
        setOneTimeSecret({ title: 'Webhook signing secret', value: result.secret, description: 'Send this value as the HMAC secret for x-examnexus-signature.' });
      }
      setMessage('Webhook endpoint created. Acknowledge the secret dialog when you have saved it.');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(notice(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/integrations/${id}`),
    onSuccess: () => { setSelectedId(null); setMessage('Integration deleted.'); setError(null); invalidate(); },
    onError: (err) => setError(notice(err)),
  });

  if (list.isError) return <ErrorBanner error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Application integrations" subtitle="Configure encrypted connections, scopes, webhooks and synchronisation." />
      {message && <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{message}</p>}
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Integrations" subtitle="Select an integration to inspect its live state.">
          {list.isLoading ? <LoadingRows count={5} /> : !list.data?.length ? <EmptyState message="No integrations configured." /> : (
            <div className="space-y-2">
              {list.data.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === item.id ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{item.provider} · {item.healthStatus}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title="Integration detail" className="xl:col-span-2">
          {!selectedId ? <EmptyState message="Select an integration to continue." /> : detail.isError ? <ErrorBanner error={detail.error} /> : detail.isLoading || !detail.data ? <LoadingRows count={6} /> : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Provider" value={detail.data.provider} />
                <Field label="Auth type" value={detail.data.authType} />
                <Field label="Active credentials" value={String(detail.data.activeCredentialCount ?? 0)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(detail.data.id)}>Test connection</Button>
                <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate({ id: detail.data.id, dryRun: false })}>Run sync</Button>
                <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate({ id: detail.data.id, dryRun: true })}>Dry run</Button>
                <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(detail.data.id)}>Delete</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Store credential</p>
                  <input className="w-full rounded-lg border border-line bg-surface-2 p-2 text-sm" type="password" placeholder="Secret value" value={secret} onChange={(event) => setSecret(event.target.value)} />
                  <Button disabled={!secret || storeCredential.isPending} onClick={() => storeCredential.mutate({ id: detail.data.id, value: secret })}>Encrypt and store</Button>
                </div>
                <div className="space-y-2 rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Add webhook endpoint</p>
                  <input className="w-full rounded-lg border border-line bg-surface-2 p-2 text-sm" type="url" placeholder="https://example.com/webhook" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
                  <Button disabled={!webhookUrl || createWebhook.isPending} onClick={() => createWebhook.mutate({ id: detail.data.id, url: webhookUrl })}>Create signed webhook</Button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent events</p>
                {!detail.data.recentEvents?.length ? <EmptyState message="No integration events recorded." /> : (
                  <div className="space-y-1">
                    {detail.data.recentEvents.map((event) => (
                      <div key={event.id} className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-xs">
                        <span>{event.eventType}</span>
                        <Badge tone={statusTone(event.status)}>{event.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
      {oneTimeSecret && (
        <OneTimeSecretDialog {...oneTimeSecret} onAcknowledge={() => setOneTimeSecret(null)} />
      )}
    </div>
  );
}

export function ApiManagementPage() {
  const queryClient = useQueryClient();
  const [clientName, setClientName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['candidates:write']);
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecretValue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clients = useQuery({
    queryKey: ['api', 'clients'],
    queryFn: ({ signal }) => apiGet<ApiClientView[]>('/integrations/api/clients', { signal }),
  });
  const createClient = useMutation({
    mutationFn: (name: string) => apiPost<ApiClientView & { secret: string }>('/integrations/api/clients', { name }),
    onSuccess: (result) => {
      setClientName('');
      setOneTimeSecret({
        title: 'API client secret',
        description: `Client ID: ${result.clientId}. Send the pair as HTTP Basic, x-client-id/x-client-secret headers, or clientId/clientSecret in the request body.`,
        value: result.secret,
      });
      setMessage('API client created. Acknowledge the secret dialog when you have saved it.');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['api', 'clients'] });
    },
    onError: (err) => setError(notice(err)),
  });
  const createKey = useMutation({
    mutationFn: ({ clientId, scopes }: { clientId: string; scopes: string[] }) =>
      apiPost<CreateApiKeyResult>(`/integrations/api/clients/${clientId}/keys`, { scopes }),
    onSuccess: (result) => {
      setOneTimeSecret({ title: 'New API key', value: result.secret, description: 'Use it in the x-api-key header.' });
      setMessage('API key created. Acknowledge the secret dialog when you have saved it.');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['api', 'clients'] });
    },
    onError: (err) => setError(notice(err)),
  });
  const revokeClient = useMutation({
    mutationFn: (clientId: string) => apiPost(`/integrations/api/clients/${clientId}/revoke`, {}),
    onSuccess: () => { setMessage('API client revoked.'); setError(null); void queryClient.invalidateQueries({ queryKey: ['api', 'clients'] }); },
    onError: (err) => setError(notice(err)),
  });

  if (clients.isError) return <ErrorBanner error={clients.error} onRetry={() => void clients.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="API management" subtitle="Scoped API clients and hashed keys for inbound integrations." />
      {message && <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{message}</p>}
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <Card title="Create API client" subtitle="Choose the scopes granted to keys created for this client.">
        <div className="flex flex-wrap gap-2">
          <input className="flex-1 rounded-lg border border-line bg-surface-2 p-2 text-sm" placeholder="Client name" value={clientName} onChange={(event) => setClientName(event.target.value)} />
          <Button disabled={!clientName || createClient.isPending} onClick={() => createClient.mutate(clientName)}>Create client</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          {['candidates:read', 'candidates:write', 'webhooks:read'].map((scope) => (
            <label key={scope} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={keyScopes.includes(scope)}
                onChange={(event) => setKeyScopes((current) =>
                  event.target.checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope),
                )}
              />
              {scope}
            </label>
          ))}
        </div>
      </Card>
      <Card title="API clients">
        {clients.isLoading ? <LoadingRows count={4} /> : !clients.data?.length ? <EmptyState message="No API clients created." /> : (
          <div className="space-y-3">
            {clients.data.map((client) => (
              <div key={client.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{client.name}</p>
                    <p className="text-xs text-muted">{client.clientId}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={statusTone(client.status)}>{client.status}</Badge>
                    <Button variant="secondary" disabled={createKey.isPending || keyScopes.length === 0} onClick={() => createKey.mutate({ clientId: client.clientId, scopes: keyScopes })}>Create key</Button>
                    <Button variant="ghost" disabled={revokeClient.isPending} onClick={() => revokeClient.mutate(client.clientId)}>Revoke</Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {client.keys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{key.prefix}…</span>
                      <span className="text-muted">{key.scopes.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {oneTimeSecret && (
        <OneTimeSecretDialog {...oneTimeSecret} onAcknowledge={() => setOneTimeSecret(null)} />
      )}
    </div>
  );
}

export function IntegrationMonitoringPage() {
  const query = useQuery({
    queryKey: ['integrations', 'monitoring'],
    queryFn: ({ signal }) => apiGet<IntegrationMonitoringView>('/platform/integrations/monitoring', { signal }),
    refetchInterval: 30_000,
  });
  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Integration monitoring" subtitle="Cross-tenant integration, API and webhook health from live records." />
      {query.isLoading || !query.data ? <LoadingRows count={8} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Integrations" value={query.data.totals.integrations} />
            <Metric label="Connected" value={query.data.totals.connected} />
            <Metric label="Failed" value={query.data.totals.failed} />
            <Metric label="API requests (24h)" value={query.data.apiRequests24Hours} />
          </div>
          <Card title="By provider">
            {!query.data.byProvider.length ? <EmptyState message="No integrations recorded." /> : (
              <div className="space-y-2">
                {query.data.byProvider.map((row) => (
                  <div key={row.provider} className="flex justify-between text-sm"><span>{row.provider}</span><span>{row.count}</span></div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Recent events">
            {!query.data.recentEvents.length ? <EmptyState message="No recent integration events." /> : (
              <div className="space-y-1">
                {query.data.recentEvents.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-xs">
                    <span>{event.eventType}</span><Badge tone={statusTone(event.status)}>{event.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p>
    </Card>
  );
}
