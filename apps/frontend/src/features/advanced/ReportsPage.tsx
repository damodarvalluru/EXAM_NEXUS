import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AdvancedReportKind, AdvancedReportView, ExamView } from '@examnexus/shared';
import { apiDownload, apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, LoadingRows, PageHeader } from '../../components/ui/DataState';
import { AdvancedErrorBanner, AdvisoryNote, downloadBlob, formatDate, Notice } from './common';

const REPORT_KINDS: Array<{ value: AdvancedReportKind; label: string }> = [
  { value: 'exams', label: 'Examination overview' },
  { value: 'results', label: 'Results' },
  { value: 'questions', label: 'Questions' },
  { value: 'risk', label: 'Risk signals' },
  { value: 'certificates', label: 'Certificates' },
];

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const display = Number.isFinite(value) ? value.toLocaleString() : '—';
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{display}{suffix ?? ''}</p>
    </Card>
  );
}

function ScoreDistributionChart({ rows }: { rows: AdvancedReportView['scoreDistribution'] }) {
  if (rows.length === 0) return <EmptyState message="No scored attempts in this scope." />;
  const width = 640;
  const height = 240;
  const padding = 32;
  const baseline = height - padding;
  const max = Math.max(...rows.map((row) => row.count), 1);
  const slot = (width - padding * 2) / rows.length;
  const barWidth = Math.max(8, Math.min(48, slot * 0.6));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-60 w-full"
      role="img"
      aria-label="Score distribution from live attempt records"
    >
      <line x1={padding} y1={baseline} x2={width - padding} y2={baseline} stroke="currentColor" opacity="0.25" />
      {rows.map((row, index) => {
        const barHeight = ((height - padding * 2) * row.count) / max;
        const x = padding + index * slot + (slot - barWidth) / 2;
        return (
          <g key={`${row.label}-${index}`}>
            <rect x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx={4} fill="var(--color-brand)" />
            <text x={x + barWidth / 2} y={Math.max(12, baseline - barHeight - 6)} textAnchor="middle" fontSize="11" fill="var(--color-ink)">
              {row.count}
            </text>
            <text x={x + barWidth / 2} y={baseline + 18} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
              {row.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AdvancedReportsPage() {
  const [kind, setKind] = useState<AdvancedReportKind>('exams');
  const [examinationId, setExaminationId] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (examinationId.trim()) params.set('examinationId', examinationId.trim());
  params.set('kind', kind);
  const queryString = params.toString();

  const report = useQuery({
    queryKey: ['advanced', 'reports', kind, examinationId],
    queryFn: ({ signal }) => apiGet<AdvancedReportView>(`/advanced/reports/exams?${queryString}`, { signal }),
  });
  const exams = useQuery({
    queryKey: ['examinations', 'filter-list'],
    queryFn: ({ signal }) => apiGet<{ items: ExamView[] }>('/examinations?pageSize=100', { signal }),
  });

  const exportMutation = useMutation({
    mutationFn: () => apiDownload(`/advanced/reports/export?${queryString}`),
    onSuccess: (blob) => {
      const suffix = examinationId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadBlob(blob, `examnexus-report-${kind}${suffix ? `-${suffix}` : ''}.csv`);
      setExportError(null);
    },
    onError: (error) => setExportError(error instanceof Error ? error.message : 'CSV export failed'),
  });

  if (report.isError) {
    return <AdvancedErrorBanner error={report.error} onRetry={() => void report.refetch()} />;
  }

  const data = report.data;
  const hasData = Boolean(data && (data.summary.attempts > 0 || data.scoreDistribution.length > 0 || data.questionAnalytics.length > 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced reports"
        subtitle="Analytics computed from live examination, attempt, evaluation and certificate records."
        action={
          <Button
            variant="secondary"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? 'Preparing CSV…' : 'Export CSV'}
          </Button>
        }
      />
      <Notice message={exportError} tone="danger" />
      <AdvisoryNote>
        <strong>Risk figures are advisory.</strong> They summarise recorded signals for human review and are not findings about candidates.
      </AdvisoryNote>

      <Card title="Report scope">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="advanced-report-kind">Report kind</label>
            <select
              id="advanced-report-kind"
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value as AdvancedReportKind)}
            >
              {REPORT_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="advanced-report-exam">Examination ID (optional)</label>
            <input
              id="advanced-report-exam"
              className="input"
              list="advanced-report-exams"
              value={examinationId}
              onChange={(event) => setExaminationId(event.target.value)}
              placeholder="Leave blank for all examinations"
            />
            <datalist id="advanced-report-exams">
              {(exams.data?.items ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
            </datalist>
            {exams.isError && (
              <p className="mt-1 text-xs text-warning">
                Examination lookup unavailable; enter an ID manually.
              </p>
            )}
          </div>
        </div>
        {data && (
          <p className="mt-3 text-xs text-muted">
            Generated {formatDate(data.generatedAt)} · scope tenant {data.scope.tenantId || '—'} · examination {data.scope.examinationId ?? 'all'}
          </p>
        )}
      </Card>

      {report.isLoading || !data ? <LoadingRows count={8} /> : !hasData ? (
        <Card><EmptyState message="No report data is available for this scope." /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Attempts" value={data.summary.attempts} />
            <Metric label="Submitted" value={data.summary.submitted} />
            <Metric label="Scored" value={data.summary.scored} />
            <Metric label="Pass rate" value={data.summary.passRate} suffix="%" />
            <Metric label="Average score" value={data.summary.averageScore} />
            <Metric label="Pending evaluation" value={data.summary.pendingEvaluation} />
            <Metric label="Average risk score" value={data.summary.averageRiskScore} />
            <Metric label="High-risk attempts" value={data.summary.highRiskAttempts} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Score distribution" subtitle="Counts by score band.">
              <ScoreDistributionChart rows={data.scoreDistribution} />
            </Card>
            <Card title="Evaluation and certificate state">
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">Pending</p>
                    <p className="mt-1 text-lg font-semibold">{data.evaluation.pending}</p>
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">Approved</p>
                    <p className="mt-1 text-lg font-semibold">{data.evaluation.approved}</p>
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">Revision requested</p>
                    <p className="mt-1 text-lg font-semibold">{data.evaluation.rejected}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">Certificates issued</p>
                    <p className="mt-1 text-lg font-semibold">{data.certificates.issued}</p>
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">Certificates revoked</p>
                    <p className="mt-1 text-lg font-semibold">{data.certificates.revoked}</p>
                  </div>
                </div>
                <Badge tone="warning">Risk metrics advisory — not misconduct findings</Badge>
              </div>
            </Card>
          </div>

          <Card title="Question analytics">
            {data.questionAnalytics.length === 0 ? <EmptyState message="No question analytics recorded." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                      <th className="py-2">Question</th><th className="py-2">Type</th><th className="py-2">Attempts</th>
                      <th className="py-2">Graded</th><th className="py-2">Correct</th><th className="py-2">Accuracy</th>
                      <th className="py-2">Avg marks</th><th className="py-2">Max marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.questionAnalytics.map((question) => (
                      <tr key={question.questionId} className="border-b border-line/60 last:border-0">
                        <td className="max-w-xs py-3 pr-3">
                          <p className="font-medium">{question.prompt}</p>
                          <p className="text-[11px] text-muted">{question.questionId}</p>
                        </td>
                        <td className="py-3 text-xs text-muted">{question.type}</td>
                        <td className="py-3">{question.attempts}</td>
                        <td className="py-3">{question.graded}</td>
                        <td className="py-3">{question.correct}</td>
                        <td className="py-3">{question.accuracy}%</td>
                        <td className="py-3">{question.averageMarks}</td>
                        <td className="py-3">{question.maxMarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
