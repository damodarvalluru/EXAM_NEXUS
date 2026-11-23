import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AttemptSummaryView, ExamView } from '@examnexus/shared';
import { apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';

function useAttempts(examinationId?: string, refreshMs?: number) {
  return useQuery({
    queryKey: ['examinations', 'attempts', examinationId ?? 'all'],
    queryFn: ({ signal }) => apiGet<AttemptSummaryView[]>(`/examinations/attempts${examinationId ? `?examinationId=${examinationId}` : ''}`, { signal }),
    refetchInterval: refreshMs,
  });
}

function AttemptTable({ rows }: { rows: AttemptSummaryView[] }) {
  if (rows.length === 0) return <EmptyState message="No attempts recorded yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th className="py-2">Candidate</th><th className="py-2">Examination</th><th className="py-2">Attempt</th>
            <th className="py-2">Status</th><th className="py-2">Risk</th><th className="py-2">Score</th><th className="py-2">Server end</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/60 last:border-0">
              <td className="py-3 font-medium">{row.candidateName}</td>
              <td className="py-3">{row.examinationTitle}</td>
              <td className="py-3">{row.attemptNumber}</td>
              <td className="py-3"><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
              <td className="py-3">{row.riskScore}</td>
              <td className="py-3">{row.score ?? '—'}</td>
              <td className="py-3 text-xs text-muted">{row.serverEndAt ? new Date(row.serverEndAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LiveMonitoringPage() {
  const [examinationId, setExaminationId] = useState('');
  const attempts = useAttempts(examinationId || undefined, 5000);
  const exams = useQuery({
    queryKey: ['examinations'],
    queryFn: ({ signal }) => apiGet<{ items: ExamView[] }>('/examinations?pageSize=100', { signal }),
  });

  if (attempts.isError || exams.isError) return <ErrorBanner error={attempts.error ?? exams.error} onRetry={() => { void attempts.refetch(); void exams.refetch(); }} />;

  const live = (attempts.data ?? []).filter((row) => row.status === 'IN_PROGRESS');

  return (
    <div className="space-y-5">
      <PageHeader title="Live examination monitoring" subtitle="Server-side attempt state refreshed every five seconds." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-xs uppercase text-muted">Attempts visible</p><p className="mt-2 text-2xl font-semibold">{attempts.data?.length ?? 0}</p></Card>
        <Card><p className="text-xs uppercase text-muted">In progress</p><p className="mt-2 text-2xl font-semibold">{live.length}</p></Card>
        <Card><p className="text-xs uppercase text-muted">Submitted</p><p className="mt-2 text-2xl font-semibold">{(attempts.data ?? []).filter((row) => row.status === 'SUBMITTED' || row.status === 'AUTO_SUBMITTED').length}</p></Card>
      </div>
      <Card title="Attempts">
        <select className="input mb-4 max-w-sm" value={examinationId} onChange={(event) => setExaminationId(event.target.value)}>
          <option value="">All examinations</option>
          {(exams.data?.items ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
        </select>
        {attempts.isLoading ? <LoadingRows /> : <AttemptTable rows={attempts.data ?? []} />}
      </Card>
    </div>
  );
}

export function EvaluationPage() {
  const attempts = useAttempts(undefined, 15000);
  if (attempts.isError) return <ErrorBanner error={attempts.error} onRetry={() => void attempts.refetch()} />;
  const graded = (attempts.data ?? []).filter((row) => row.score !== null);

  return (
    <div className="space-y-5">
      <PageHeader title="Evaluation management" subtitle="Automatically graded submissions and attempts awaiting manual evaluation." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><p className="text-xs uppercase text-muted">Graded submissions</p><p className="mt-2 text-2xl font-semibold">{graded.length}</p></Card>
        <Card><p className="text-xs uppercase text-muted">Awaiting evaluation</p><p className="mt-2 text-2xl font-semibold">{(attempts.data ?? []).filter((row) => row.status === 'SUBMITTED' && row.score === null).length}</p></Card>
      </div>
      <Card title="Submission queue">
        {attempts.isLoading ? <LoadingRows /> : <AttemptTable rows={attempts.data ?? []} />}
      </Card>
    </div>
  );
}
