import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PERMISSIONS,
  type AiSuggestionView,
  type EvaluatorAssignmentDto,
  type EvaluatorAssignmentView,
  type EvaluationDetailView,
  type EvaluationQueueItem,
  type MarkChangeView,
  type MemberView,
  type ReviewEvaluationDto,
  type ReviewOutcomeView,
  type SubjectiveAnswerView,
} from '@examnexus/shared';
import { apiGet, apiPost } from '../../lib/api-client';
import { hasPermission } from '../../components/auth/PermissionGate';
import { useAuth } from '../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';
import {
  AdvancedErrorBanner,
  AdvisoryNote,
  formatDate,
  formatValue,
  Notice,
  useInvalidateAdvanced,
} from './common';

interface ReviewDraft {
  marks: string;
  feedback: string;
  status: 'COMPLETED' | 'REVISION';
}

interface AssignmentDraft {
  evaluatorId: string;
  blind: boolean;
}

type DraftMap = Record<string, ReviewDraft>;
type AssignmentDraftMap = Record<string, AssignmentDraft>;

const DECIMAL_MARKS = /^\d+(?:\.\d{1,2})?$/;

function draftFor(answer: SubjectiveAnswerView): ReviewDraft {
  return {
    marks: answer.marksAwarded === null ? '' : String(answer.marksAwarded),
    feedback: answer.feedback ?? '',
    status: 'COMPLETED',
  };
}

function shortPrompt(prompt: string): string {
  return prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
}

function validateDrafts(answers: SubjectiveAnswerView[], drafts: DraftMap): string | null {
  if (answers.length === 0) return 'This attempt has no subjective answers to review.';
  for (const answer of answers) {
    const draft = drafts[answer.questionId];
    if (!draft) return `Missing review entry for "${shortPrompt(answer.prompt)}".`;
    if (draft.marks.trim() === '') {
      return `Enter marks for "${shortPrompt(answer.prompt)}" before submitting.`;
    }
    const marks = Number(draft.marks);
    if (!Number.isFinite(marks) || !DECIMAL_MARKS.test(draft.marks.trim()) || marks < 0 || marks > answer.maxMarks) {
      return `Marks for "${shortPrompt(answer.prompt)}" must be between 0 and ${answer.maxMarks} with at most two decimal places.`;
    }
  }
  return null;
}

function SuggestionCard({ suggestion, onApply }: { suggestion: AiSuggestionView; onApply?: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles size={16} /> AI suggestion
          <Badge tone={suggestion.confidence === 'LOW' ? 'warning' : 'neutral'}>
            {suggestion.confidence.toLowerCase()} confidence
          </Badge>
        </div>
        <span className="text-xs text-muted">
          {suggestion.suggestedMarks}/{suggestion.maxMarks} marks · model {suggestion.modelVersion}
        </span>
      </div>
      <p className="mt-2 text-sm">{suggestion.rationale}</p>
      {suggestion.rubricBreakdown.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestion.rubricBreakdown.map((criterion, index) => (
            <li key={`${criterion.criterion}-${index}`} className="rounded-lg border border-line bg-surface p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{criterion.criterion}</span>
                <Badge tone={criterion.met ? 'success' : 'neutral'}>
                  {criterion.met ? 'Met' : 'Not met'} · weight {criterion.weight}
                </Badge>
              </div>
              <p className="mt-1 text-muted">{criterion.reason}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        Advisory only. The API does not apply these marks; {suggestion.requiresHumanReview ? 'a human reviewer must accept or change them.' : 'reviewer confirmation is still required.'}
      </p>
      {onApply && (
        <Button variant="secondary" className="mt-3" onClick={onApply}>
          Apply suggested marks to draft
        </Button>
      )}
    </div>
  );
}

export function AdvancedEvaluationPage() {
  const { attemptId: paramAttemptId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const invalidateAdvanced = useInvalidateAdvanced();
  const queryClient = useQueryClient();
  const canManage = hasPermission(user?.permissions ?? [], PERMISSIONS.ORG_EVALUATION_MANAGE);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [suggestionMap, setSuggestionMap] = useState<Record<string, AiSuggestionView>>({});
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReviewOutcomeView | null>(null);
  const [blind, setBlind] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraftMap>({});
  const [assignments, setAssignments] = useState<EvaluatorAssignmentView[]>([]);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenQuestionIds, setReopenQuestionIds] = useState<string[]>([]);

  const queue = useQuery({
    queryKey: ['advanced', 'evaluations', 'queue'],
    queryFn: ({ signal }) => apiGet<EvaluationQueueItem[]>('/advanced/evaluations/queue', { signal }),
  });

  const selectedAttemptId = paramAttemptId ?? queue.data?.[0]?.attemptId ?? null;
  const detail = useQuery({
    queryKey: ['advanced', 'evaluations', selectedAttemptId, blind],
    queryFn: ({ signal }) => {
      if (!selectedAttemptId) throw new Error('Select an attempt first.');
      const suffix = blind ? '?blind=true' : '';
      return apiGet<EvaluationDetailView>(`/advanced/evaluations/${encodeURIComponent(selectedAttemptId)}${suffix}`, { signal });
    },
    enabled: Boolean(selectedAttemptId),
  });
  const members = useQuery({
    queryKey: ['tenant', 'users', 'evaluator-options'],
    queryFn: ({ signal }) => apiGet<{ items: MemberView[]; total: number }>('/organisations/me/users?pageSize=100', { signal }),
    enabled: canManage,
  });
  const history = useQuery({
    queryKey: ['advanced', 'evaluations', selectedAttemptId, 'history'],
    queryFn: ({ signal }) => {
      if (!selectedAttemptId) throw new Error('Select an attempt first.');
      return apiGet<MarkChangeView[]>(`/advanced/evaluations/${encodeURIComponent(selectedAttemptId)}/history`, { signal });
    },
    enabled: Boolean(selectedAttemptId),
  });

  useEffect(() => {
    if (!detail.data) return;
    setDrafts(Object.fromEntries(detail.data.answers.map((answer) => [answer.questionId, draftFor(answer)])));
    setAssignmentDrafts(Object.fromEntries(
      detail.data.answers.map((answer) => [answer.questionId, { evaluatorId: '', blind: true }]),
    ));
    setSuggestionMap({});
    setValidationError(null);
    setOutcome(null);
    setAssignments([]);
    setReopenReason('');
    setReopenQuestionIds([]);
  }, [detail.data]);

  const suggestionMutation = useMutation({
    mutationFn: (questionId: string) => {
      if (!selectedAttemptId) throw new Error('Select an attempt first.');
      return apiPost<AiSuggestionView>(
        `/advanced/evaluations/${encodeURIComponent(selectedAttemptId)}/ai-suggestions/${encodeURIComponent(questionId)}`,
      );
    },
    onSuccess: (result) => {
      setNotice('AI suggestion generated. It is advisory until a reviewer accepts the marks.');
      setMutationError(null);
      setSuggestionMap((current) => ({ ...current, [result.questionId]: result }));
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not generate suggestion');
      setNotice(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ attemptId, payload }: { attemptId: string; payload: ReviewEvaluationDto }) =>
      apiPost<ReviewOutcomeView>(`/advanced/evaluations/${encodeURIComponent(attemptId)}/review`, payload),
    onSuccess: (result, variables) => {
      setOutcome(result);
      setNotice('Review submitted. Result values have been recomputed from the recorded marks.');
      setMutationError(null);
      setValidationError(null);
      invalidateAdvanced();
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'evaluations', variables.attemptId] });
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'evaluations', variables.attemptId, 'history'] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not submit review');
      setNotice(null);
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ attemptId, payload }: { attemptId: string; payload: { assignments: EvaluatorAssignmentDto[] } }) =>
      apiPost<EvaluatorAssignmentView[]>(`/advanced/evaluations/${encodeURIComponent(attemptId)}/assign`, payload),
    onSuccess: (result, variables) => {
      setAssignments(result);
      setNotice(result.length ? `Assigned ${result.length} question(s) to evaluators.` : 'No new assignments were needed.');
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'evaluations', variables.attemptId, 'history'] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not assign evaluators');
      setNotice(null);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: ({ attemptId, payload }: { attemptId: string; payload: { questionIds?: string[]; reason: string } }) =>
      apiPost<ReviewOutcomeView>(`/advanced/evaluations/${encodeURIComponent(attemptId)}/reopen`, payload),
    onSuccess: (result, variables) => {
      setOutcome(result);
      setNotice('Marks reopened and a fresh human evaluation is pending. Result values were recomputed.');
      setMutationError(null);
      setReopenReason('');
      setReopenQuestionIds([]);
      invalidateAdvanced();
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'evaluations', variables.attemptId] });
      void queryClient.invalidateQueries({ queryKey: ['advanced', 'evaluations', variables.attemptId, 'history'] });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Could not reopen evaluation');
      setNotice(null);
    },
  });

  const submitAssignments = () => {
    if (!detail.data || !selectedAttemptId) return;
    const selectedAssignments: EvaluatorAssignmentDto[] = detail.data.answers.flatMap((answer) => {
      const draft = assignmentDrafts[answer.questionId];
      return draft?.evaluatorId.trim()
        ? [{ questionId: answer.questionId, evaluatorId: draft.evaluatorId.trim(), blind: draft.blind }]
        : [];
    });
    if (!selectedAssignments.length) {
      setMutationError('Enter an evaluator user ID for at least one question before assigning.');
      setNotice(null);
      return;
    }
    assignMutation.mutate({ attemptId: selectedAttemptId, payload: { assignments: selectedAssignments } });
  };

  const submitReopen = () => {
    if (!selectedAttemptId) return;
    if (reopenReason.trim().length < 3) {
      setMutationError('A reopen reason of at least three characters is required.');
      setNotice(null);
      return;
    }
    reopenMutation.mutate({
      attemptId: selectedAttemptId,
      payload: {
        ...(reopenQuestionIds.length ? { questionIds: reopenQuestionIds } : {}),
        reason: reopenReason.trim(),
      },
    });
  };

  const submitReview = () => {
    if (!detail.data || !selectedAttemptId) return;
    const error = validateDrafts(detail.data.answers, drafts);
    if (error) {
      setValidationError(error);
      setNotice(null);
      return;
    }
    const payload: ReviewEvaluationDto = {
      answers: detail.data.answers.map((answer) => {
        const draft = drafts[answer.questionId]!;
        return {
          questionId: answer.questionId,
          marks: Number(draft.marks),
          ...(draft.feedback.trim() ? { feedback: draft.feedback.trim() } : {}),
          status: draft.status,
        };
      }),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    reviewMutation.mutate({ attemptId: selectedAttemptId, payload });
  };

  const selectAttempt = (attemptId: string) => {
    setNotice(null);
    setMutationError(null);
    navigate(`/org/evaluation/advanced/${encodeURIComponent(attemptId)}`);
  };

  if (queue.isError) {
    return <AdvancedErrorBanner error={queue.error} onRetry={() => void queue.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced evaluation"
        subtitle="Human-led review of subjective answers. AI output is a suggestion and never changes marks by itself."
      />
      <Notice message={notice} />
      <Notice message={mutationError} tone="danger" />
      <AdvisoryNote>
        <strong>Reviewer-controlled marking.</strong> Generate an explainable suggestion, then enter the marks you accept.
        Marks accept up to two decimal places; only a reviewer with evaluation management permission can submit a review.
      </AdvisoryNote>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Evaluation queue" subtitle="Select a submitted attempt to inspect its subjective answers.">
          {queue.isLoading ? <LoadingRows count={6} /> : !queue.data?.length ? (
            <EmptyState message="No attempts are waiting for evaluation." />
          ) : (
            <div className="space-y-2">
              {queue.data.map((item) => (
                <button
                  key={item.attemptId}
                  type="button"
                  onClick={() => selectAttempt(item.attemptId)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    selectedAttemptId === item.attemptId ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.candidateName}</span>
                    <Badge tone={statusTone(item.attemptStatus)}>{item.attemptStatus}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{item.examinationTitle}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>{item.pendingSubjective} subjective pending</span>
                    <span>{item.score ?? '—'}/{item.totalMarks} marks</span>
                    {item.resultStatus && <Badge tone={statusTone(item.resultStatus)}>{item.resultStatus}</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted">Submitted {formatDate(item.submittedAt)}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Attempt detail" className="xl:col-span-2">
          {!selectedAttemptId ? <EmptyState message="Select an attempt from the queue." /> : detail.isError ? (
            <AdvancedErrorBanner error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.isLoading || !detail.data ? <LoadingRows count={8} /> : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Candidate</p>
                  <p className="mt-1 text-sm font-medium">{detail.data.candidateName}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Score</p>
                  <p className="mt-1 text-sm font-medium">{detail.data.score ?? '—'}/{detail.data.totalMarks}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Result version</p>
                  <p className="mt-1 text-sm font-medium">{detail.data.resultVersion ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs text-muted">Result</p>
                  <p className="mt-1 text-sm font-medium">{detail.data.resultId ?? 'Not created'}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 p-3">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={blind}
                    onChange={(event) => { setBlind(event.target.checked); setNotice(null); setMutationError(null); }}
                  />
                  Blind review — withhold candidate identity
                </label>
                <datalist id="evaluator-options">
                  {(members.data?.items ?? []).map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || member.userId}
                    </option>
                  ))}
                </datalist>
                {canManage && members.isError && (
                  <span className="text-[11px] text-muted">
                    Evaluator directory unavailable; enter a user ID manually.
                  </span>
                )}
              </div>

              {outcome && (
                <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
                  <p className="font-medium">
                    Review recorded · {outcome.reviewedAnswers} answer{outcome.reviewedAnswers === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-xs">
                    Score {outcome.previousScore ?? '—'} → {outcome.score} · result version {outcome.resultVersion}
                    {outcome.resultId ? ` · ${outcome.resultId}` : ''}
                  </p>
                </div>
              )}

              {detail.data.answers.length === 0 ? <EmptyState message="No subjective answers recorded for this attempt." /> : (
                <div className="space-y-4">
                  {detail.data.answers.map((answer) => {
                    const draft = drafts[answer.questionId] ?? draftFor(answer);
                    const suggestion = suggestionMap[answer.questionId];
                    return (
                      <div key={answer.questionId} className="rounded-xl border border-line p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{answer.prompt}</p>
                            <p className="mt-1 text-xs text-muted">
                              {answer.questionType} · maximum {answer.maxMarks} marks · current {answer.marksAwarded ?? '—'}
                            </p>
                          </div>
                          <Badge tone={answer.evaluations.length ? 'success' : 'neutral'}>
                            {answer.evaluations.length} evaluation{answer.evaluations.length === 1 ? '' : 's'}
                          </Badge>
                        </div>
                        <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Candidate answer</p>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm">{formatValue(answer.answer)}</pre>
                        </div>

                        {canManage && (
                          <div className="mt-3 rounded-lg border border-line p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Assign this question</p>
                            <div className="mt-2 flex flex-wrap items-end gap-3">
                              <div className="min-w-[240px] flex-1">
                                <label className="mb-1 block text-xs font-medium" htmlFor={`evaluator-${answer.questionId}`}>
                                  Evaluator user ID
                                </label>
                                <input
                                  id={`evaluator-${answer.questionId}`}
                                  list="evaluator-options"
                                  className="input"
                                  placeholder="Select or paste a user ID"
                                  value={assignmentDrafts[answer.questionId]?.evaluatorId ?? ''}
                                  onChange={(event) => setAssignmentDrafts((current) => ({
                                    ...current,
                                    [answer.questionId]: {
                                      evaluatorId: event.target.value,
                                      blind: current[answer.questionId]?.blind ?? true,
                                    },
                                  }))}
                                />
                              </div>
                              <label className="flex items-center gap-2 pb-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={assignmentDrafts[answer.questionId]?.blind ?? true}
                                  onChange={(event) => setAssignmentDrafts((current) => ({
                                    ...current,
                                    [answer.questionId]: {
                                      evaluatorId: current[answer.questionId]?.evaluatorId ?? '',
                                      blind: event.target.checked,
                                    },
                                  }))}
                                />
                                Blind assignment
                              </label>
                            </div>
                          </div>
                        )}

                        {answer.evaluations.length > 0 && (
                          <details className="mt-3 text-xs">
                            <summary className="cursor-pointer text-muted">Recorded evaluations</summary>
                            <div className="mt-2 space-y-1">
                              {answer.evaluations.map((evaluation) => (
                                <div key={evaluation.id} className="rounded border border-line p-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span>{evaluation.mode} · {evaluation.status}</span>
                                    <span>{evaluation.score ?? '—'}/{evaluation.maxScore ?? answer.maxMarks}</span>
                                  </div>
                                  <p className="mt-1 text-muted">
                                    {evaluation.blind ? 'Blind review' : 'Identified review'} · created {formatDate(evaluation.createdAt)}
                                  </p>
                                  {evaluation.feedback && <p className="mt-1">{evaluation.feedback}</p>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {suggestion && (
                          <SuggestionCard
                            suggestion={suggestion}
                            onApply={canManage ? () => {
                              setDrafts((current) => ({
                                ...current,
                                [answer.questionId]: {
                                  ...(current[answer.questionId] ?? draft),
                                  marks: String(Math.min(answer.maxMarks, Math.round(suggestion.suggestedMarks * 100) / 100)),
                                },
                              }));
                              setValidationError(null);
                              setNotice('Suggestion copied to the draft. Review or change it before submitting.');
                            } : undefined}
                          />
                        )}

                        <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr_180px]">
                          <div>
                            <label className="mb-1 block text-xs font-medium" htmlFor={`marks-${answer.questionId}`}>
                              Marks (0–{answer.maxMarks})
                            </label>
                            <input
                              id={`marks-${answer.questionId}`}
                              type="number"
                              min={0}
                              max={answer.maxMarks}
                              step="0.01"
                              className="input"
                              value={draft.marks}
                              disabled={!canManage}
                              onChange={(event) => {
                                setDrafts((current) => ({
                                  ...current,
                                  [answer.questionId]: { ...draft, marks: event.target.value },
                                }));
                                setValidationError(null);
                              }}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium" htmlFor={`feedback-${answer.questionId}`}>
                              Feedback to candidate
                            </label>
                            <textarea
                              id={`feedback-${answer.questionId}`}
                              rows={2}
                              className="input"
                              value={draft.feedback}
                              disabled={!canManage}
                              onChange={(event) => setDrafts((current) => ({
                                ...current,
                                [answer.questionId]: { ...draft, feedback: event.target.value },
                              }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium" htmlFor={`status-${answer.questionId}`}>
                              Decision
                            </label>
                            <select
                              id={`status-${answer.questionId}`}
                              className="input"
                              value={draft.status}
                              disabled={!canManage}
                              onChange={(event) => setDrafts((current) => ({
                                ...current,
                                [answer.questionId]: {
                                  ...draft,
                                  status: event.target.value as ReviewDraft['status'],
                                },
                              }))}
                            >
                              <option value="COMPLETED">COMPLETED</option>
                              <option value="REVISION">REVISION</option>
                            </select>
                          </div>
                        </div>

                        {canManage && (
                          <Button
                            variant="secondary"
                            className="mt-3"
                            disabled={suggestionMutation.isPending}
                            onClick={() => suggestionMutation.mutate(answer.questionId)}
                          >
                            <Sparkles size={14} /> Request AI suggestion
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {canManage && detail.data.answers.length > 0 && (
                <div className="space-y-2 rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Evaluator assignments</p>
                      <p className="text-xs text-muted">Assignments are audited and blind assignments stay withheld from the named evaluator.</p>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={assignMutation.isPending}
                      onClick={submitAssignments}
                    >
                      {assignMutation.isPending ? 'Assigning…' : 'Assign selected evaluators'}
                    </Button>
                  </div>
                  {assignments.length > 0 && (
                    <div className="space-y-1">
                      {assignments.map((assignment) => (
                        <p key={`${assignment.questionId}-${assignment.evaluatorId}`} className="text-xs text-muted">
                          {shortPrompt(detail.data?.answers.find((answer) => answer.questionId === assignment.questionId)?.prompt ?? assignment.questionId)}
                          {' → '}{assignment.evaluatorId} · {assignment.blind ? 'blind' : 'identified'} · {assignment.status}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!canManage && (
                <p className="text-xs text-muted">
                  You have evaluation read access. Management permission is required to assign evaluators, request suggestions,
                  reopen marks or submit reviews.
                </p>
              )}

              {canManage && detail.data.answers.length > 0 && (
                <div className="space-y-3 border-t border-line pt-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor="review-note">Review note (optional)</label>
                    <textarea
                      id="review-note"
                      className="input"
                      rows={2}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Context for other reviewers"
                    />
                  </div>
                  {validationError && <p className="text-xs text-danger">{validationError}</p>}
                  <Button disabled={reviewMutation.isPending} onClick={submitReview}>
                    {reviewMutation.isPending ? 'Submitting review…' : 'Submit review'}
                  </Button>
                  <p className="text-xs text-muted">
                    REVISION returns an answer for re-evaluation; COMPLETED records the marks shown above.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Moderation and reopen" subtitle="Reopen accepted marks with a recorded reason before re-evaluation.">
          {!canManage ? <EmptyState message="Evaluation management permission is required to reopen marks." /> : !selectedAttemptId ? (
            <EmptyState message="Select an attempt first." />
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="reopen-reason">Reopen reason</label>
                <textarea
                  id="reopen-reason"
                  className="input"
                  rows={2}
                  value={reopenReason}
                  onChange={(event) => setReopenReason(event.target.value)}
                  placeholder="Explain why accepted marks require a fresh evaluation"
                />
              </div>
              {detail.data?.answers.length ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Questions to reopen (none selected reopens all)</p>
                  {detail.data.answers.map((answer) => (
                    <label key={answer.questionId} className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={reopenQuestionIds.includes(answer.questionId)}
                        onChange={(event) => setReopenQuestionIds((current) => event.target.checked
                          ? [...new Set([...current, answer.questionId])]
                          : current.filter((value) => value !== answer.questionId))}
                      />
                      <span>{shortPrompt(answer.prompt)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <Button variant="secondary" disabled={reopenMutation.isPending} onClick={submitReopen}>
                {reopenMutation.isPending ? 'Reopening…' : 'Reopen for re-evaluation'}
              </Button>
              <p className="text-xs text-muted">Reopening recomputes the result and keeps every previous mark in the history below.</p>
            </div>
          )}
        </Card>

        <Card title="Mark-change history" subtitle="Immutable evaluation records, newest last.">
          {history.isError ? <AdvancedErrorBanner error={history.error} onRetry={() => void history.refetch()} /> : history.isLoading || !history.data ? (
            <LoadingRows count={5} />
          ) : history.data.length === 0 ? <EmptyState message="No evaluation changes recorded yet." /> : (
            <div className="space-y-2">
              {history.data.map((change) => (
                <div key={change.evaluationId} className="rounded-lg border border-line p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {shortPrompt(detail.data?.answers.find((answer) => answer.questionId === change.questionId)?.prompt ?? change.questionId ?? 'Attempt-level')}
                    </span>
                    <Badge tone={change.status === 'COMPLETED' ? 'success' : change.status === 'REVISION' ? 'danger' : 'warning'}>
                      {change.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted">
                    {change.previousScore ?? '—'} → {change.score ?? '—'} / {change.maxScore ?? '—'} · {change.mode} ·{' '}
                    {change.evaluatorId ?? 'system'} · {formatDate(change.changedAt)}
                  </p>
                  {change.feedback && <p className="mt-1 text-muted">{change.feedback}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
