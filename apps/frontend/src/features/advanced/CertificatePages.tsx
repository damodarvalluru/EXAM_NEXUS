import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  CertificateVerificationView,
  CertificateView,
} from '@examnexus/shared';
import { apiDownload, apiGet, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, LoadingRows, PageHeader } from '../../components/ui/DataState';
import { AdvancedErrorBanner, downloadBlob, formatDate, Notice } from './common';

function verificationMessage(view: CertificateVerificationView): string {
  if (view.valid) return 'This certificate matches current issuing records.';
  switch (view.reason) {
    case 'NOT_FOUND': return 'No certificate was found for this verification code.';
    case 'REVOKED': return 'This certificate has been revoked by the issuing organisation.';
    case 'RESULT_NOT_PUBLISHED': return 'The underlying result has not been published yet.';
    default: return 'This certificate could not be verified against current records.';
  }
}

export function CertificatesPage() {
  const invalidate = useInvalidate();
  const [resultIdFilter, setResultIdFilter] = useState('');
  const [issueResultId, setIssueResultId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (resultIdFilter.trim()) params.set('resultId', resultIdFilter.trim());
  const queryString = params.toString();

  const certificates = useQuery({
    queryKey: ['advanced', 'certificates', resultIdFilter],
    queryFn: ({ signal }) => apiGet<CertificateView[]>(`/advanced/certificates${queryString ? `?${queryString}` : ''}`, { signal }),
  });

  const rows = certificates.data ?? [];
  const selected = rows.find((certificate) => certificate.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && rows.length > 0) setSelectedId(rows[0]!.id);
    if (selectedId && rows.length > 0 && !rows.some((certificate) => certificate.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
    setRevokeReason('');
  }, [rows, selectedId]);

  const issue = useMutation({
    mutationFn: (resultId: string) => apiPost<CertificateView>('/advanced/certificates/issue', { resultId }),
    onSuccess: (result) => {
      setNotice(`Certificate ${result.certificateNumber} issued.`);
      setActionError(null);
      setIssueResultId('');
      setSelectedId(result.id);
      invalidate();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Could not issue certificate');
      setNotice(null);
    },
  });

  const download = useMutation({
    mutationFn: (id: string) => apiDownload(`/advanced/certificates/${encodeURIComponent(id)}/pdf`),
    onSuccess: (blob, id) => {
      downloadBlob(blob, `examnexus-certificate-${id}.pdf`);
      setNotice('Certificate PDF downloaded.');
      setActionError(null);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Could not download PDF');
      setNotice(null);
    },
  });

  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<CertificateView>(`/advanced/certificates/${encodeURIComponent(id)}/revoke`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      setNotice('Certificate revoked. Public verification will reflect the new state.');
      setActionError(null);
      setRevokeReason('');
      invalidate();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Could not revoke certificate');
      setNotice(null);
    },
  });

  if (certificates.isError) {
    return <AdvancedErrorBanner error={certificates.error} onRetry={() => void certificates.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        subtitle="Issue, download and revoke certificates from published results."
        action={<Link to="/verify-certificate" className="text-sm text-brand no-underline">Open public verification ↗</Link>}
      />
      <Notice message={notice} />
      <Notice message={actionError} tone="danger" />

      <Card title="Issue a certificate" subtitle="Requires a published result identifier.">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            value={issueResultId}
            onChange={(event) => { setIssueResultId(event.target.value); setActionError(null); }}
            placeholder="Result ID"
            aria-label="Result ID to issue"
          />
          <Button
            disabled={!issueResultId.trim() || issue.isPending}
            onClick={() => issue.mutate(issueResultId.trim())}
          >
            {issue.isPending ? 'Issuing…' : 'Issue certificate'}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Issued certificates">
          <div className="mb-3">
            <input
              className="input"
              value={resultIdFilter}
              onChange={(event) => setResultIdFilter(event.target.value)}
              placeholder="Filter by result ID"
              aria-label="Filter certificates by result ID"
            />
          </div>
          {certificates.isLoading ? <LoadingRows count={5} /> : rows.length === 0 ? (
            <EmptyState message="No certificates match this filter." />
          ) : (
            <div className="space-y-2">
              {rows.map((certificate) => (
                <button
                  key={certificate.id}
                  type="button"
                  onClick={() => { setSelectedId(certificate.id); setRevokeReason(''); }}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    selectedId === certificate.id ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{certificate.certificateNumber}</span>
                    <Badge tone={certificate.revokedAt ? 'danger' : 'success'}>
                      {certificate.revokedAt ? 'REVOKED' : 'ACTIVE'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{certificate.candidateName} · {certificate.examinationTitle}</p>
                  <p className="mt-1 text-[11px] text-muted">Issued {formatDate(certificate.issuedAt)}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Certificate detail" className="xl:col-span-2">
          {!selected ? <EmptyState message="Select a certificate to continue." /> : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Certificate number</p>
                  <p className="mt-1 text-sm font-medium">{selected.certificateNumber}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Candidate</p>
                  <p className="mt-1 text-sm font-medium">{selected.candidateName}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Score</p>
                  <p className="mt-1 text-sm font-medium">{selected.score}/{selected.maxScore}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Issued</p>
                  <p className="mt-1 text-sm font-medium">{formatDate(selected.issuedAt)}</p>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted">
                <p>Examination: <span className="text-ink">{selected.examinationTitle}</span></p>
                <p>Result ID: <span className="font-mono text-ink">{selected.resultId}</span></p>
                <p>Verification code: <span className="break-all font-mono text-ink">{selected.verificationCode}</span></p>
                {selected.revokedAt && <p className="text-danger">Revoked {formatDate(selected.revokedAt)}</p>}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <Button
                  variant="secondary"
                  disabled={!selected.pdfAvailable || download.isPending}
                  onClick={() => download.mutate(selected.id)}
                  title={selected.pdfAvailable ? undefined : 'No PDF is available for this certificate'}
                >
                  {download.isPending ? 'Preparing PDF…' : 'Download PDF'}
                </Button>
                {!selected.pdfAvailable && (
                  <span className="self-center text-xs text-muted">PDF not available for this certificate.</span>
                )}
              </div>

              <div className="space-y-2 border-t border-line pt-4">
                <label className="mb-1 block text-xs font-medium" htmlFor="certificate-revoke-reason">
                  Revocation reason (optional)
                </label>
                <textarea
                  id="certificate-revoke-reason"
                  className="input"
                  rows={2}
                  value={revokeReason}
                  disabled={Boolean(selected.revokedAt)}
                  onChange={(event) => setRevokeReason(event.target.value)}
                />
                <Button
                  variant="ghost"
                  disabled={Boolean(selected.revokedAt) || revoke.isPending}
                  onClick={() => revoke.mutate({ id: selected.id, reason: revokeReason })}
                >
                  {selected.revokedAt ? 'Already revoked' : 'Revoke certificate'}
                </Button>
                <p className="text-xs text-muted">
                  Revocation is sent to the audited API and immediately affects public verification.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Custom hook kept local to the certificate feature so the shared API client stays untouched. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['advanced', 'certificates'] });
    void queryClient.invalidateQueries({ queryKey: ['advanced', 'reports'] });
  };
}

export function CertificateVerificationPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [submittedCode, setSubmittedCode] = useState(searchParams.get('code') ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const verification = useQuery({
    queryKey: ['advanced', 'certificate-verification', submittedCode],
    queryFn: ({ signal }) => apiGet<CertificateVerificationView>(
      `/advanced/certificates/verify?code=${encodeURIComponent(submittedCode)}`,
      { signal },
    ),
    enabled: Boolean(submittedCode),
    retry: false,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim()) {
      setSubmitError('Enter the verification code printed on the certificate.');
      return;
    }
    setSubmitError(null);
    setSubmittedCode(code.trim());
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <PageHeader
        title="Verify a certificate"
        subtitle="Public verification against current issuing records. No sign-in is required."
      />
      <Notice message={submitError} tone="danger" />
      <Card title="Certificate verification">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Verification code"
            aria-label="Certificate verification code"
          />
          <Button type="submit" disabled={verification.isFetching}>Verify</Button>
        </form>
        <p className="mt-3 text-xs text-muted">
          Codes are supplied by the certificate holder. This screen reports only what the verification API returns.
        </p>
      </Card>

      {submittedCode && verification.isError && (
        <AdvancedErrorBanner error={verification.error} onRetry={() => void verification.refetch()} />
      )}
      {submittedCode && verification.isLoading && <LoadingRows count={4} />}
      {submittedCode && verification.data && (
        <Card title="Verification result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={verification.data.valid ? 'success' : 'danger'}>
              {verification.data.valid ? 'VALID' : 'NOT VERIFIED'}
            </Badge>
            <span className="text-xs text-muted">Checked against live records</span>
          </div>
          <p className={`mt-3 text-sm ${verification.data.valid ? 'text-success' : 'text-danger'}`}>
            {verificationMessage(verification.data)}
          </p>
          {verification.data.valid && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Certificate number</p>
                <p className="mt-1 text-sm font-medium">{verification.data.certificateNumber ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Candidate</p>
                <p className="mt-1 text-sm font-medium">{verification.data.candidateName ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Examination</p>
                <p className="mt-1 text-sm font-medium">{verification.data.examinationTitle ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Score</p>
                <p className="mt-1 text-sm font-medium">
                  {verification.data.score ?? '—'}/{verification.data.maxScore ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3 sm:col-span-2">
                <p className="text-xs text-muted">Issued</p>
                <p className="mt-1 text-sm font-medium">{formatDate(verification.data.issuedAt)}</p>
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            Verification reflects current records only. Contact the issuing organisation about disputes or changes.
          </p>
        </Card>
      )}
    </div>
  );
}
