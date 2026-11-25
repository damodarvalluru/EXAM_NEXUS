import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  PERMISSIONS,
  ResultStatus,
  type ExamView,
  type PublishDueView,
  type RankListView,
  type ResultAnalyticsView,
  type ScorecardView,
} from '@examnexus/shared';
import { apiGet, apiPost } from '../../lib/api-client';
import { hasPermission } from '../../components/auth/PermissionGate';
import { useAuth } from '../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, LoadingRows, PageHeader } from '../../components/ui/DataState';
import {
  AdvancedErrorBanner,
  AdvisoryNote,
  formatDate,
  Notice,
  resultTone,
  useInvalidateAdvanced,
} from './common';

/**
 * The API returns result views; the exact projection is owned by the backend,
 * so this local interface models the fields the approval screen consumes and
 * tolerates both the `id` and `resultId` naming conventions.
 */
interface ResultView {
  id?: string;
  resultId?: string;
  attemptId?: string;
  candidateName?: string;
  candidate?: string;
  examinationTitle?: string;
  examTitle?: string;
  status?: ResultStatus | string;
  resultStatus?: ResultStatus | string;
  score?: number | null;
  maxScore?: number;
  totalMarks?: number;
  percentage?: number;
  passed?: boolean;
  version?: number;
  resultVersion?: number;
  publishedAt?: string | null;
  approvedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  note?: string | null;
  certificateId?: string | null;
  certificateVerificationCode?: string | null;
  scheduledPublishAt?: string | null;
  examinationId?: string;
  rank?: number | null;
}

type ResultsResponse = ResultView[] | { items?: ResultView[]; results?: ResultView[] };

type ResultAction = 'approve' | 'publish' | 'reject' | 'withhold';

interface ActionInput {
  id: string;
  action: ResultAction;
  note: string;
  publish: boolean;
}

function rowsFrom(data: ResultsResponse | undefined): ResultView[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items ?? data.results ?? [];
}

function keyOf(row: ResultView): string {
  return row.id ?? row.resultId ?? '';
}

function statusOf(row: ResultView): string {
  return row.resultStatus ?? row.status ?? 'UNKNOWN';
}

function candidateOf(row: ResultView): string {
  return row.candidateName ?? row.candidate ?? 'Unnamed candidate';
}

function examOf(row: ResultView): string {
  return row.examinationTitle ?? row.examTitle ?? 'Examination';
}

const ACTION_LABELS: Record<ResultAction, string> = {
  approve: 'Approve',
  publish: 'Publish',
  reject: 'Reject',
  withhold: 'Withhold',
};

export function ResultApprovalPage() {
  const { user } = useAuth();
  const invalidateAdvanced = useInvalidateAdvanced();
  const canManage = hasPermission(user?.permissions ?? [], PERMISSIONS.ORG_EVALUATION_MANAGE);
  const [status, setStatus] = useState('');
  const [examinationId, setExaminationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [publish, setPublish] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishAt, setPublishAt] = useState('');

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (examinationId) params.set('examinationId', examinationId);
  if (departmentId) params.set('departmentId', departmentId);
  const queryString = params.toString();

  const results = useQuery({
    queryKey: ['advanced', 'results', status, examinationId, departmentId],
    queryFn: ({ signal }) => apiGet<ResultsResponse>(`/advanced/results${queryString ? `?${queryString}` : ''}`, { signal }),
  });
  const analytics = useQuery({
    queryKey: ['advanced', 'results', 'analytics'],
    queryFn: ({ signal }) => apiGet<ResultAnalyticsView>('/advanced/results/analytics', { signal }),
  });
  const exams = useQuery({
    queryKey: ['examinations', 'filter-list'],
    queryFn: ({ signal }) => apiGet<{ items: ExamView[] }>('/examinations?pageSize=100', { signal }),
  });

  const rows = rowsFrom(results.data);
  const selected = rows.find((row) => keyOf(row) === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && rows.length > 0) setSelectedId(keyOf(rows[0]!));
    if (selectedId && rows.length > 0 && !rows.some((row) => keyOf(row) === selectedId)) {
      setSelectedId(keyOf(rows[0]!));
    }
  }, [rows, selectedId]);

  useEffect(() => {
    setNote('');
    setPublish(false);
    setActionError(null);
  }, [selectedId]);

  const actionMutation = useMutation({
    mutationFn: ({ id, action, note: actionNote, publish: shouldPublish }: ActionInput) => {
      if (!id) throw new Error('This result does not expose an identifier.');
      const trimmed = actionNote.trim();
      if ((action === 'reject' || action === 'withhold') && !trimmed) {
        throw new Error(`A note is required to ${action} a result.`);
      }
      const path = `/advanced/results/${encodeURIComponent(id)}/${action}`;
      if (action === 'reject' || action === 'withhold') return apiPost(path, { note: trimmed });
      if (action === 'approve') return apiPost(path, { ...(trimmed ? { note: trimmed } : {}), ...(shouldPublish ? { publish: true } : {}) });
      return apiPost(path, trimmed ? { note: trimmed } : {});
    },
    onSuccess: (_data, variables) => {
      setNotice(`${ACTION_LABELS[variables.action]} action recorded.`);
      setActionError(null);
      setNote('');
      setPublish(false);
      invalidateAdvanced();
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Result action failed');
      setNotice(null);
    },
  });

  const runAction = (action: ResultAction) => {
    if (!selected) return;
    actionMutation.mutate({ id: keyOf(selected), action, note, publish });
  };

  const scorecard = useQuery({
    queryKey: ['advanced', 'scorecard', selectedId],
    queryFn: ({ signal }) => apiGet<ScorecardView>(`/advanced/results/${encodeURIComponent(selectedId!)}/scorecard`, { signal }),
    enabled: Boolean(selectedId),
  });
  const rankList = useQuery({
    queryKey: ['advanced', 'rank', selected?.examinationId],
    queryFn: ({ signal }) => apiGet<RankListView>(`/advanced/results/rank/${encodeURIComponent(selected!.examinationId!)}`, { signal }),
    enabled: Boolean(selected?.examinationId),
  });
  const scheduleMutation = useMutation({
    mutationFn: ({ id, publishAt: when }: { id: string; publishAt: string }) =>
      apiPost(`/advanced/results/${encodeURIComponent(id)}/schedule`, { publishAt: when }),
    onSuccess: () => {
      setNotice('Publication scheduled. Run the due-publication sweep after the configured time.');
      setActionError(null);
      setPublishAt('');
      invalidateAdvanced();
    },
    onError: (error) => { setActionError(error instanceof Error ? error.message : 'Scheduling failed'); setNotice(null); },
  });
  const publishDueMutation = useMutation({
    mutationFn: () => apiPost<PublishDueView>('/advanced/results/publish-due', {}),
    onSuccess: (data) => {
      setNotice(`Due-publication sweep complete: ${data.published} published, ${data.skipped} skipped.`);
      setActionError(null);
      invalidateAdvanced();
    },
    onError: (error) => { setActionError(error instanceof Error ? error.message : 'Publication sweep failed'); setNotice(null); },
  });

  if (results.isError) {
    return <AdvancedErrorBanner error={results.error} onRetry={() => void results.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Result approval"
        subtitle="Approve, publish, reject or withhold computed results with an auditable reviewer decision."
        action={<Link to="/verify-certificate" className="text-sm text-brand no-underline">Public certificate verification ↗</Link>}
      />
      <Notice message={notice} />
      <Notice message={actionError} tone="danger" />
      {!canManage && (
        <AdvisoryNote>
          <strong>Read-only view.</strong> Result decisions require evaluation management permission. The API also enforces this on every action.
        </AdvisoryNote>
      )}

      <Card title="Filters">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="result-status-filter">Result status</label>
            <select id="result-status-filter" className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {Object.values(ResultStatus).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="result-exam-filter">Examination ID</label>
            <input
              id="result-exam-filter"
              className="input"
              value={examinationId}
              onChange={(event) => setExaminationId(event.target.value)}
              placeholder="Filter by examination"
            />
            {exams.data?.items?.length ? (
              <select
                className="input mt-2"
                aria-label="Choose an examination"
                value={examinationId}
                onChange={(event) => setExaminationId(event.target.value)}
              >
                <option value="">All examinations</option>
                {exams.data.items.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
              </select>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="result-department-filter">Department ID</label>
            <input
              id="result-department-filter"
              className="input"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              placeholder="Filter by department"
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Results" subtitle="Select a result to review its decision state.">
          {results.isLoading ? <LoadingRows count={6} /> : rows.length === 0 ? (
            <EmptyState message="No results match these filters." />
          ) : (
            <div className="space-y-2">
              {rows.map((row, index) => (
                <button
                  key={keyOf(row) || `result-${index}`}
                  type="button"
                  disabled={!keyOf(row)}
                  onClick={() => setSelectedId(keyOf(row))}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    selectedId === keyOf(row) ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{candidateOf(row)}</span>
                    <Badge tone={resultTone(statusOf(row))}>{statusOf(row)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{examOf(row)}</p>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
                    <span>{row.score ?? '—'}/{row.maxScore ?? row.totalMarks ?? '—'}</span>
                    <span>Version {row.version ?? row.resultVersion ?? '—'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Decision" className="xl:col-span-2">
          {!selected ? <EmptyState message="Select a result to continue." /> : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Candidate</p>
                  <p className="mt-1 text-sm font-medium">{candidateOf(selected)}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Status</p>
                  <p className="mt-1 text-sm font-medium">{statusOf(selected)}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Score</p>
                  <p className="mt-1 text-sm font-medium">{selected.score ?? '—'}/{selected.maxScore ?? selected.totalMarks ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Published</p>
                  <p className="mt-1 text-sm font-medium">{formatDate(selected.publishedAt)}</p>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted">
                <p>Result ID: <span className="font-mono text-ink">{keyOf(selected)}</span></p>
                {selected.attemptId && <p>Attempt ID: <span className="font-mono text-ink">{selected.attemptId}</span></p>}
                {selected.approvedBy && <p>Approved by: <span className="font-mono text-ink">{selected.approvedBy}</span></p>}
                {selected.createdAt && <p>Created {formatDate(selected.createdAt)}</p>}
                {selected.updatedAt && <p>Updated {formatDate(selected.updatedAt)}</p>}
                {selected.note && <p>Last note: {selected.note}</p>}
                {selected.rank && <p>Rank: {selected.rank}</p>}
                {selected.scheduledPublishAt && <p>Scheduled publication: {formatDate(selected.scheduledPublishAt)}</p>}
                {selected.certificateVerificationCode && (
                  <p>Certificate: <Link className="text-brand" to={`/verify-certificate?code=${encodeURIComponent(selected.certificateVerificationCode)}`}>Verify certificate</Link></p>
                )}
                {!selected.certificateVerificationCode && selected.certificateId && (
                  <p>Certificate: <Link className="text-brand" to="/certificates">{selected.certificateId}</Link></p>
                )}
              </div>

              <div className="space-y-2 border-t border-line pt-4">
                <label className="mb-1 block text-xs font-medium" htmlFor="result-action-note">
                  Reviewer note {statusOf(selected) === 'REVISION' || statusOf(selected) === 'WITHHELD' ? '(required for revision/withhold)' : '(optional)'}
                </label>
                <textarea
                  id="result-action-note"
                  className="input"
                  rows={3}
                  value={note}
                  disabled={!canManage}
                  onChange={(event) => { setNote(event.target.value); setActionError(null); }}
                  placeholder="Record the reason for this decision"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publish}
                    disabled={!canManage}
                    onChange={(event) => setPublish(event.target.checked)}
                  />
                  Publish after approval
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(Object.keys(ACTION_LABELS) as ResultAction[]).map((action) => (
                    <Button
                      key={action}
                      variant={action === 'approve' ? 'primary' : 'secondary'}
                      disabled={!canManage || actionMutation.isPending}
                      title={!canManage ? 'Requires evaluation management permission' : undefined}
                      onClick={() => runAction(action)}
                    >
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  Approve records acceptance; publishing releases the result. Reject and withhold require a note.
                  All decisions are sent to the audited API rather than applied locally.
                </p>
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <input
                    className="input"
                    type="datetime-local"
                    aria-label="Scheduled publication time"
                    value={publishAt}
                    disabled={!canManage || statusOf(selected) !== 'APPROVED'}
                    onChange={(event) => setPublishAt(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={!canManage || !publishAt || statusOf(selected) !== 'APPROVED' || scheduleMutation.isPending}
                    onClick={() => scheduleMutation.mutate({ id: keyOf(selected), publishAt: new Date(publishAt).toISOString() })}
                  >
                    Schedule publication
                  </Button>
                  <Button variant="secondary" disabled={!canManage || publishDueMutation.isPending} onClick={() => publishDueMutation.mutate()}>
                    Run due-publication sweep
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Scorecard" subtitle="Frozen-question marks and accepted evaluation state.">
          {scorecard.isError ? <AdvancedErrorBanner error={scorecard.error} /> : scorecard.isLoading || !scorecard.data ? (
            <EmptyState message={selectedId ? 'Loading scorecard…' : 'Select a result to view its scorecard.'} />
          ) : scorecard.data.answers.length === 0 ? <EmptyState message="No answers recorded for this attempt." /> : (
            <div className="space-y-2">
              {scorecard.data.answers.map((answer) => (
                <div key={answer.questionId} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{answer.prompt}</span>
                    <Badge tone={answer.evaluationStatus === 'COMPLETED' ? 'success' : 'warning'}>
                      {answer.evaluationStatus}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {answer.marksAwarded ?? '—'} / {answer.maxMarks} · {answer.evaluationCount} evaluation(s) · {answer.type}
                  </p>
                  {answer.feedback && <p className="mt-1 text-xs text-muted">{answer.feedback}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Rank list" subtitle="Competition ranks from the latest published results.">
          {rankList.isError ? <AdvancedErrorBanner error={rankList.error} /> : !selected?.examinationId ? (
            <EmptyState message="Select a result to view its examination rank list." />
          ) : rankList.isLoading || !rankList.data ? <LoadingRows count={5} /> : rankList.data.entries.length === 0 ? (
            <EmptyState message="No published results to rank yet." />
          ) : (
            <div className="space-y-1">
              {rankList.data.entries.map((entry) => (
                <div key={entry.resultId} className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-xs">
                  <span>#{entry.rank} {entry.candidateName} ({entry.candidateCode})</span>
                  <span className="text-muted">{entry.score}/{entry.maxScore} · {entry.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Published result analytics" subtitle="Aggregates computed from published, tenant-scoped results.">
        {analytics.isError ? <AdvancedErrorBanner error={analytics.error} onRetry={() => void analytics.refetch()} /> : analytics.isLoading || !analytics.data ? (
          <LoadingRows count={4} />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Published</p>
                <p className="mt-1 text-lg font-semibold">{analytics.data.totals.publishedResults}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Passed</p>
                <p className="mt-1 text-lg font-semibold">{analytics.data.totals.passed}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Pass rate</p>
                <p className="mt-1 text-lg font-semibold">{analytics.data.totals.passRate}%</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Average score</p>
                <p className="mt-1 text-lg font-semibold">{analytics.data.totals.averageScore}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-muted">Average percentage</p>
                <p className="mt-1 text-lg font-semibold">{analytics.data.totals.averagePercentage}%</p>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {[
                { title: 'By department', rows: analytics.data.byDepartment },
                { title: 'By examination', rows: analytics.data.byExamination },
              ].map((group) => (
                <div key={group.title}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</p>
                  {group.rows.length === 0 ? <EmptyState message="No published results in this group." /> : (
                    <div className="space-y-1">
                      {group.rows.map((row) => (
                        <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-2 py-1.5 text-xs">
                          <span>{row.label}</span>
                          <span className="text-muted">
                            {row.results} result(s) · {row.passed} passed · {row.passRate}% · avg {row.averageScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
