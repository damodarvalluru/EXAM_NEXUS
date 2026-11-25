import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  ProctorAttemptView,
  ReviewRiskDto,
  RiskAssessmentView,
  SecurityEventView,
} from '@examnexus/shared';
import { apiGet, apiPatch, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, LoadingRows, PageHeader } from '../../components/ui/DataState';
import {
  AdvancedErrorBanner,
  AdvisoryNote,
  formatDate,
  formatValue,
  Notice,
  riskTone,
  useInvalidateAdvanced,
} from './common';

interface ReviewState {
  assessmentId: string;
  investigated: boolean;
  appealStatus: string;
  note: string;
}

function emptyReview(assessment: RiskAssessmentView | undefined): ReviewState {
  return {
    assessmentId: assessment?.id ?? '',
    investigated: Boolean(assessment?.reviewedBy),
    appealStatus: assessment?.appealStatus ?? '',
    note: '',
  };
}

export function ProctoringPage() {
  const { attemptId: paramAttemptId } = useParams();
  const navigate = useNavigate();
  const invalidateAdvanced = useInvalidateAdvanced();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState>(emptyReview(undefined));

  const attempts = useQuery({
    queryKey: ['advanced', 'proctoring', 'attempts'],
    queryFn: ({ signal }) => apiGet<ProctorAttemptView[]>('/advanced/proctoring/attempts', { signal }),
  });
  const selectedAttemptId = paramAttemptId ?? attempts.data?.[0]?.attemptId ?? null;
  const detail = useQuery({
    queryKey: ['advanced', 'proctoring', 'attempts', selectedAttemptId],
    queryFn: ({ signal }) => {
      if (!selectedAttemptId) throw new Error('Select an attempt first.');
      return apiGet<ProctorAttemptView>(`/advanced/proctoring/attempts/${encodeURIComponent(selectedAttemptId)}`, { signal });
    },
    enabled: Boolean(selectedAttemptId),
  });

  useEffect(() => {
    setReview(emptyReview(detail.data?.assessments[0]));
  }, [detail.data]);

  const investigate = useMutation({
    mutationFn: ({ eventId, investigated }: { eventId: string; investigated: boolean }) =>
      apiPatch<SecurityEventView>(`/advanced/proctoring/events/${encodeURIComponent(eventId)}`, { investigated }),
    onSuccess: (result) => {
      setNotice(`Event marked ${result.investigated ? 'investigated' : 'not investigated'}.`);
      setMutationError(null);
      invalidateAdvanced();
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'proctoring', 'attempts', selectedAttemptId] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not update event');
      setNotice(null);
    },
  });

  const assess = useMutation({
    mutationFn: (attemptId: string) =>
      apiPost<RiskAssessmentView>(`/advanced/proctoring/attempts/${encodeURIComponent(attemptId)}/assess`),
    onSuccess: (result) => {
      setNotice(`Advisory assessment recorded: ${result.level} (${result.score}).`);
      setMutationError(null);
      setReview(emptyReview(result));
      invalidateAdvanced();
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'proctoring', 'attempts', selectedAttemptId] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not create assessment');
      setNotice(null);
    },
  });

  const reviewRisk = useMutation({
    mutationFn: ({ assessmentId, payload }: { assessmentId: string; payload: ReviewRiskDto }) =>
      apiPost<RiskAssessmentView>(`/advanced/proctoring/assessments/${encodeURIComponent(assessmentId)}/review`, payload),
    onSuccess: () => {
      setNotice('Human review of the risk assessment saved.');
      setMutationError(null);
      setReview((current) => ({ ...current, note: '' }));
      invalidateAdvanced();
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'proctoring', 'attempts', selectedAttemptId] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not save risk review');
      setNotice(null);
    },
  });

  const submitReview = () => {
    if (!review.assessmentId) return;
    const payload: ReviewRiskDto = {
      investigated: review.investigated,
      ...(review.appealStatus.trim() ? { appealStatus: review.appealStatus.trim() } : {}),
      ...(review.note.trim() ? { note: review.note.trim() } : {}),
    };
    reviewRisk.mutate({ assessmentId: review.assessmentId, payload });
  };

  if (attempts.isError) {
    return <AdvancedErrorBanner error={attempts.error} onRetry={() => void attempts.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proctoring review"
        subtitle="Recorded session events and explainable risk assessments for human review."
      />
      <Notice message={notice} />
      <Notice message={mutationError} tone="danger" />
      <AdvisoryNote>
        <strong>Advisory signals only.</strong> Browser, device and connection events are indicators, not proof of misconduct.
        Risk scores never automatically disqualify a candidate. Reviewers inspect the recorded evidence and rules, then record
        their own decision and appeal status; no action is inferred or applied by this screen.
      </AdvisoryNote>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Attempts" subtitle="Select an attempt to inspect its event trail.">
          {attempts.isLoading ? <LoadingRows count={6} /> : !attempts.data?.length ? (
            <EmptyState message="No proctored attempts recorded." />
          ) : (
            <div className="space-y-2">
              {attempts.data.map((attempt) => (
                <button
                  key={attempt.attemptId}
                  type="button"
                  onClick={() => navigate(`/org/proctoring/${encodeURIComponent(attempt.attemptId)}`)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    selectedAttemptId === attempt.attemptId ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{attempt.candidateName}</span>
                    <Badge tone={riskTone(attempt.assessments[0]?.level ?? '')}>
                      Risk {attempt.riskScore}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{attempt.examinationTitle}</p>
                  <p className="mt-2 text-[11px] text-muted">
                    {attempt.events.length} event{attempt.events.length === 1 ? '' : 's'} · {attempt.assessments.length} assessment{attempt.assessments.length === 1 ? '' : 's'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card title="Attempt detail">
            {!selectedAttemptId ? <EmptyState message="Select an attempt to continue." /> : detail.isError ? (
              <AdvancedErrorBanner error={detail.error} onRetry={() => void detail.refetch()} />
            ) : detail.isLoading || !detail.data ? <LoadingRows count={8} /> : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-xs text-muted">Candidate</p>
                    <p className="mt-1 text-sm font-medium">{detail.data.candidateName}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-xs text-muted">Attempt risk score</p>
                    <p className="mt-1 text-sm font-medium">{detail.data.riskScore} <span className="text-xs text-muted">(advisory)</span></p>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-xs text-muted">Session profile</p>
                    <p className="mt-1 text-sm font-medium">{detail.data.session?.securityProfile ?? 'No session recorded'}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-xs text-muted">Device</p>
                    <p className="mt-1 break-all text-sm font-medium">{detail.data.session?.deviceId ?? '—'}</p>
                  </div>
                </div>

                {detail.data.session && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                    <span>Session ID: <span className="font-mono text-ink">{detail.data.session.id}</span></span>
                    <span>Client: {detail.data.session.secureClientVersion ?? '—'}</span>
                    <span>Last heartbeat: {formatDate(detail.data.session.heartbeatAt)}</span>
                    <span>Disconnected: {formatDate(detail.data.session.disconnectedAt)}</span>
                    <span>Terminated: {formatDate(detail.data.session.terminatedAt)}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button
                    variant="secondary"
                    disabled={assess.isPending}
                    onClick={() => selectedAttemptId && assess.mutate(selectedAttemptId)}
                  >
                    {assess.isPending ? 'Assessing…' : 'Run advisory assessment'}
                  </Button>
                  <span className="self-center text-xs text-muted">
                    Recomputes risk from recorded events; it does not change candidate status.
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card title="Recorded security events" subtitle="Evidence is shown exactly as captured by the exam client.">
            {detail.isLoading || !detail.data ? <LoadingRows count={5} /> : detail.data.events.length === 0 ? (
              <EmptyState message="No security events recorded for this attempt." />
            ) : (
              <div className="space-y-2">
                {detail.data.events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{event.eventType}</span>
                        <span className="ml-2 text-xs text-muted">{event.category} · weight {event.riskWeight}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={riskTone(event.severity)}>{event.severity}</Badge>
                        <Badge tone={event.investigated ? 'success' : 'neutral'}>
                          {event.investigated ? 'Investigated' : 'Awaiting review'}
                        </Badge>
                        <Button
                          variant="secondary"
                          disabled={investigate.isPending}
                          onClick={() => investigate.mutate({ eventId: event.id, investigated: !event.investigated })}
                        >
                          {event.investigated ? 'Reopen' : 'Mark investigated'}
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Server: {formatDate(event.serverTime)} · Client: {formatDate(event.clientTime)}
                    </p>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted">Recorded evidence</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-2 p-2 text-[11px]">
                        {formatValue(event.evidence)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Risk assessments and human review" subtitle="Rules and model output are displayed for inspection.">
            {detail.isLoading || !detail.data ? <LoadingRows count={5} /> : detail.data.assessments.length === 0 ? (
              <EmptyState message="No assessments recorded. Run an advisory assessment to generate one." />
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {detail.data.assessments.map((assessment) => (
                    <div
                      key={assessment.id}
                      className={`rounded-lg border p-3 text-sm ${
                        review.assessmentId === assessment.id ? 'border-brand bg-brand/5' : 'border-line'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">Assessment {assessment.id.slice(0, 8)}</span>
                          <Badge tone={riskTone(assessment.level)}>{assessment.level}</Badge>
                          <span className="text-xs text-muted">Score {assessment.score}</span>
                        </div>
                        <Button variant="ghost" onClick={() => setReview(emptyReview(assessment))}>
                          Review this assessment
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Created {formatDate(assessment.createdAt)} · model {assessment.modelVersion ?? 'rule-based'}
                      </p>
                      <p className="mt-1 text-xs">
                        Human review: {assessment.reviewedBy ?? 'Not recorded'}
                        {assessment.reviewedAt ? ` at ${formatDate(assessment.reviewedAt)}` : ''} · Appeal: {assessment.appealStatus ?? 'Not recorded'}
                      </p>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted">Explainable rules</summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-2 p-2 text-[11px]">
                          {formatValue(assessment.rules)}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-line pt-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted">
                    <Info size={14} /> Human review decision
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor="risk-assessment-select">Assessment</label>
                    <select
                      id="risk-assessment-select"
                      className="input"
                      value={review.assessmentId}
                      onChange={(event) => {
                        const assessment = detail.data.assessments.find((item) => item.id === event.target.value);
                        setReview(emptyReview(assessment));
                      }}
                    >
                      {detail.data.assessments.map((assessment) => (
                        <option key={assessment.id} value={assessment.id}>{assessment.id} · {assessment.level}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={review.investigated}
                      onChange={(event) => setReview((current) => ({ ...current, investigated: event.target.checked }))}
                    />
                    Mark this assessment as reviewed by a human
                  </label>
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor="risk-appeal-status">Appeal status (optional)</label>
                    <input
                      id="risk-appeal-status"
                      className="input"
                      value={review.appealStatus}
                      onChange={(event) => setReview((current) => ({ ...current, appealStatus: event.target.value }))}
                      placeholder="e.g. OPEN, UPHELD, OVERTURNED — use your organisation's values"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor="risk-review-note">Review note (optional)</label>
                    <textarea
                      id="risk-review-note"
                      className="input"
                      rows={2}
                      value={review.note}
                      onChange={(event) => setReview((current) => ({ ...current, note: event.target.value }))}
                    />
                  </div>
                  <Button disabled={!review.assessmentId || reviewRisk.isPending} onClick={submitReview}>
                    {reviewRisk.isPending ? 'Saving review…' : 'Save human review'}
                  </Button>
                  <p className="text-xs text-muted">
                    This records reviewer context only. It does not create a finding, sanction or automatic disqualification.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
