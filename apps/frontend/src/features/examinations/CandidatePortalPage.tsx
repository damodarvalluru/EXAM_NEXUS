import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttemptView,
  CandidateExamView,
  CandidateResultView,
  QuestionView,
  SubmitReceipt,
} from '@examnexus/shared';
import { apiGet, apiPost, apiPut } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';

const CHOICE_TYPES = new Set(['SINGLE_CHOICE', 'TRUE_FALSE']);
const MULTI_TYPES = new Set(['MULTIPLE_CHOICE', 'MATCHING', 'ORDERING']);

function idempotencyKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${uuid ?? Date.now().toString(36)}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function AnswerInput({
  question,
  value,
  disabled,
  onChange,
}: {
  question: QuestionView;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (CHOICE_TYPES.has(question.type)) {
    return (
      <div className="space-y-1">
        {question.options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={question.id}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
            />
            <span><strong>{option.label}.</strong> {option.content}</span>
          </label>
        ))}
      </div>
    );
  }

  // FILL_BLANK questions are delivered with no options: the expected value is
  // hidden in the frozen version snapshot and used only by server-side grading.
  if (question.type === 'FILL_BLANK') {
    return (
      <input
        className="input w-full"
        type="text"
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        placeholder="Type your answer"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (MULTI_TYPES.has(question.type)) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="space-y-1">
        {question.options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))}
            />
            <span><strong>{option.label}.</strong> {option.content}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <textarea
      className="input w-full"
      rows={question.type === 'ESSAY' || question.type === 'LONG_ANSWER' ? 5 : 2}
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      placeholder="Type your answer"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function CandidatePortalPage() {
  const queryClient = useQueryClient();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const exams = useQuery({
    queryKey: ['candidate', 'exams'],
    queryFn: ({ signal }) => apiGet<CandidateExamView[]>('/candidate/exams', { signal }),
  });
  const attempt = useQuery({
    queryKey: ['candidate', 'attempt', attemptId],
    enabled: Boolean(attemptId),
    queryFn: ({ signal }) => apiGet<AttemptView>(`/candidate/attempts/${attemptId}`, { signal }),
  });
  const result = useQuery({
    queryKey: ['candidate', 'result', attemptId],
    enabled: Boolean(attemptId) && (attempt.data?.status === 'SUBMITTED' || attempt.data?.status === 'AUTO_SUBMITTED' || Boolean(receipt)),
    queryFn: ({ signal }) => apiGet<CandidateResultView>(`/candidate/attempts/${attemptId}/result`, { signal }),
  });

  useEffect(() => {
    if (!attempt.data) return;
    setAnswers(attempt.data.answers);
    setDirty({});
  }, [attempt.data?.id]);

  const start = useMutation({
    mutationFn: (examId: string) => apiPost<AttemptView>(`/candidate/exams/${examId}/start`),
    onSuccess: (view) => {
      setReceipt(null);
      setAttemptId(view.id);
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'exams'] });
    },
  });

  const save = useMutation({
    mutationFn: ({ questionId, value }: { questionId: string; value: unknown }) =>
      apiPut(`/candidate/attempts/${attemptId}/answers`, {
        questionId,
        answer: { value },
        idempotencyKey: `answer:${attemptId}:${questionId}`,
      }),
    onSuccess: (_data, variables) => {
      setDirty((current) => ({ ...current, [variables.questionId]: false }));
    },
  });

  useEffect(() => {
    const pending = Object.keys(dirty).filter((key) => dirty[key]);
    if (!pending.length || attempt.data?.status !== 'IN_PROGRESS') return;
    const timer = window.setTimeout(async () => {
      for (const questionId of pending) {
        await save.mutateAsync({ questionId, value: answers[questionId] });
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, answers, attempt.data?.status]);

  const submit = useMutation({
    mutationFn: () => apiPost<SubmitReceipt>(`/candidate/attempts/${attemptId}/submit`, {
      idempotencyKey: idempotencyKey('submit'),
      clientTime: new Date().toISOString(),
    }),
    onSuccess: (value) => {
      setReceipt(value);
      void attempt.refetch();
      void result.refetch();
    },
  });

  const remaining = useMemo(() => {
    if (!attempt.data?.serverEndAt) return 0;
    return Math.max(0, Math.floor((Date.parse(attempt.data.serverEndAt) - now) / 1000));
  }, [attempt.data?.serverEndAt, now]);

  const updateAnswer = (questionId: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setDirty((current) => ({ ...current, [questionId]: true }));
  };

  if (exams.isError || attempt.isError) return <ErrorBanner error={exams.error ?? attempt.error} onRetry={() => { void exams.refetch(); void attempt.refetch(); }} />;

  if (!attemptId) {
    return (
      <div className="space-y-5">
        <PageHeader title="Candidate portal" subtitle="Examinations assigned to your account and their availability windows." />
        {exams.isLoading ? <LoadingRows count={5} /> : (exams.data?.length ?? 0) === 0 ? <EmptyState message="No examinations have been assigned to you." /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {exams.data?.map((exam) => (
              <Card key={exam.id} title={exam.title}>
                <p className="text-sm text-muted">{exam.description ?? exam.instructions ?? 'No instructions supplied.'}</p>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <p>{exam.durationMinutes} minutes · {exam.totalMarks} marks</p>
                  <p>Attempts used: {exam.attemptsUsed} / {exam.maxAttempts}</p>
                  {!exam.available && <p className="text-danger">{exam.reason}</p>}
                </div>
                <Button className="mt-4" disabled={!exam.available || start.isPending} onClick={() => start.mutate(exam.id)}>Start examination</Button>
              </Card>
            ))}
          </div>
        )}
        {start.error && <ErrorBanner error={start.error} />}
      </div>
    );
  }

  if (attempt.isLoading || !attempt.data) return <LoadingRows count={8} />;

  const view = attempt.data;
  const isActive = view.status === 'IN_PROGRESS';
  const submitted = view.status === 'SUBMITTED' || view.status === 'AUTO_SUBMITTED';

  return (
    <div className="space-y-5">
      <PageHeader
        title={view.title}
        subtitle={`Attempt ${view.attemptNumber} · server-controlled timer · status ${view.status}`}
        action={<Badge tone={statusTone(view.status)}>{view.status}</Badge>}
      />
      {view.instructions && <Card title="Instructions"><p className="whitespace-pre-wrap text-sm text-muted">{view.instructions}</p></Card>}
      <Card title="Attempt clock">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-3xl font-semibold tabular-nums">{formatDuration(remaining)}</p>
          <p className="text-xs text-muted">The server end time is authoritative: {view.serverEndAt ? new Date(view.serverEndAt).toLocaleString() : 'not set'}</p>
        </div>
      </Card>
      {save.error && <ErrorBanner error={save.error} />}
      {submit.error && <ErrorBanner error={submit.error} />}

      {view.questions.map((question, index) => (
        <Card key={question.id} title={`${index + 1}. ${question.prompt}`}>
          <p className="mb-3 text-xs text-muted">{question.type} · {question.marks} marks{question.negativeMarks ? ` · -${question.negativeMarks} for wrong answer` : ''}</p>
          <AnswerInput
            question={question}
            value={answers[question.id]}
            disabled={!isActive}
            onChange={(value) => updateAnswer(question.id, value)}
          />
          {isActive && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={save.isPending || !dirty[question.id]}
                onClick={() => save.mutate({ questionId: question.id, value: answers[question.id] })}
              >
                Save answer
              </Button>
              {dirty[question.id] && <span className="text-xs text-muted">Saving shortly…</span>}
            </div>
          )}
        </Card>
      ))}

      {isActive && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>Submit examination</Button>
          <Button variant="secondary" onClick={() => { setAttemptId(null); setReceipt(null); }}>Back to my examinations</Button>
        </div>
      )}

      {receipt && (
        <Card title="Submission receipt">
          <p className="text-sm">Receipt <code className="font-mono text-xs">{receipt.receiptHash}</code></p>
          <p className="mt-1 text-xs text-muted">Submitted {new Date(receipt.submittedAt).toLocaleString()} · score {receipt.score ?? 'pending'} / {receipt.totalMarks}</p>
        </Card>
      )}

      {submitted && (
        <Card title="Result">
          {result.isLoading ? <LoadingRows count={3} /> : result.data ? (
            <div className="space-y-1 text-sm">
              <p><strong>{result.data.score}</strong> / {result.data.totalMarks} marks</p>
              <p>Status: <Badge tone={statusTone(result.data.status)}>{result.data.status}</Badge></p>
              <p className="text-xs text-muted">{result.data.passingMarks === null ? 'No pass mark configured' : `Pass mark: ${result.data.passingMarks}`}</p>
            </div>
          ) : <EmptyState message="Result has not been published yet." />}
        </Card>
      )}
    </div>
  );
}
