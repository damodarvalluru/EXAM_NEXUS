import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganisationDetail, OrganisationView, ReviewDecision } from '@examnexus/shared';
import { Download, ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiDownload, apiGet, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Pagination, statusTone } from '../../components/ui/DataState';

interface OrganisationList {
  items: OrganisationView[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const DECISIONS: ReviewDecision[] = ['APPROVE', 'REQUEST_INFO', 'REJECT', 'SUSPEND', 'REACTIVATE'];

export function AdminOrganisationsPage({ verificationOnly = false }: { verificationOnly?: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(verificationOnly ? 'SUBMITTED' : '');
  const query = useQuery({
    queryKey: ['admin', 'organisations', page, search, status],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      return apiGet<OrganisationList>(`/organisations?${params.toString()}`, { signal });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={verificationOnly ? 'Organisation verification queue' : 'Organisation management'}
        subtitle="Live organisation records and verification state from the platform database."
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            className="input max-w-xs"
            placeholder="Search name, slug or email"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
          <select className="input max-w-xs" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {query.isError ? (
          <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading || !query.data ? (
          <LoadingRows />
        ) : query.data.items.length === 0 ? (
          <EmptyState message="No organisations match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Organisation</th>
                  <th className="py-2">Official email</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Submitted</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((organisation) => (
                  <tr key={organisation.id} className="border-b border-line/60 last:border-0">
                    <td className="py-3">
                      <p className="font-medium">{organisation.name}</p>
                      <p className="text-xs text-muted">{organisation.slug}</p>
                    </td>
                    <td className="py-3 text-muted">{organisation.officialEmail}</td>
                    <td className="py-3"><Badge tone={statusTone(organisation.status)}>{organisation.status}</Badge></td>
                    <td className="py-3 text-xs text-muted">
                      {organisation.verificationSubmittedAt ? new Date(organisation.verificationSubmittedAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-3 text-right">
                      <Link className="inline-flex items-center gap-1 text-xs text-brand no-underline" to={`/admin/organisations/${organisation.id}`}>
                        Review <ExternalLink size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4">
              <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminOrganisationDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'organisation', id],
    queryFn: ({ signal }) => apiGet<OrganisationDetail>(`/organisations/${id}`, { signal }),
    enabled: Boolean(id),
  });
  const [decision, setDecision] = useState<ReviewDecision>('APPROVE');
  const [reason, setReason] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: () => apiPost(`/organisations/${id}/review`, { decision, reason: reason || undefined }),
    onSuccess: async () => {
      setReviewError(null);
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'organisation', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'organisations'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ]);
    },
    onError: (error) => setReviewError(error instanceof Error ? error.message : 'Review failed'),
  });

  const download = async (key: string) => {
    const blob = await apiDownload(`/organisations/${id}/document?key=${encodeURIComponent(key)}`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = key.split('/').pop() ?? 'document';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <LoadingRows count={6} />;
  const organisation = query.data;

  return (
    <div className="space-y-5">
      <PageHeader title={organisation.name} subtitle={`${organisation.slug} · ${organisation.officialEmail}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Registration">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="Status" value={<Badge tone={statusTone(organisation.status)}>{organisation.status}</Badge>} />
            <Detail label="Registration number" value={organisation.registrationNumber ?? '—'} />
            <Detail label="Phone" value={organisation.contactPhone ?? '—'} />
            <Detail label="Website" value={organisation.website ?? '—'} />
            <Detail label="Users" value={String(organisation.counts.users)} />
            <Detail label="Candidates" value={String(organisation.counts.candidates)} />
            <Detail label="Examinations" value={String(organisation.counts.examinations)} />
            <Detail label="Integrations" value={String(organisation.counts.integrations)} />
          </dl>
        </Card>
        <Card title="Review decision" subtitle="Writes an audit event and changes the organisation status.">
          <div className="space-y-3">
            <select className="input" value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
              {DECISIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <textarea className="input min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (optional)" />
            {reviewError && <p className="text-xs text-danger">{reviewError}</p>}
            <Button onClick={() => review.mutate()} disabled={review.isPending}>
              {review.isPending ? 'Saving…' : 'Submit decision'}
            </Button>
          </div>
        </Card>
      </div>
      <Card title="Verification history">
        {organisation.verifications.length === 0 ? (
          <EmptyState message="No verification submissions recorded." />
        ) : (
          <div className="space-y-4">
            {organisation.verifications.map((verification) => (
              <div key={verification.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{verification.stage}</span>
                  <Badge tone={statusTone(verification.status)}>{verification.status}</Badge>
                </div>
                {verification.notes && <p className="mt-2 text-xs text-muted">{verification.notes}</p>}
                {verification.documentKeys.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {verification.documentKeys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void download(key)}
                        className="flex items-center gap-2 text-xs text-brand underline"
                      >
                        <Download size={13} /> {key}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
