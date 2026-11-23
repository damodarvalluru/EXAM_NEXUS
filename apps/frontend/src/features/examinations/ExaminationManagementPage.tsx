import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExamStatus,
  ExamType,
  type CandidateView,
  type EligibilityView,
  type ExamView,
  type QuestionBankView,
  type QuestionView,
} from '@examnexus/shared';
import { apiGet, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, statusTone } from '../../components/ui/DataState';

const EXAM_STATUSES = Object.values(ExamStatus);
const EXAM_TYPES = Object.values(ExamType);

export function ExaminationManagementPage() {
  const queryClient = useQueryClient();
  const [examForm, setExamForm] = useState({
    title: '',
    type: ExamType.IMMEDIATE as (typeof EXAM_TYPES)[number],
    durationMinutes: 60,
    totalMarks: 100,
    passingMarks: 40,
    questionIds: '',
  });
  const [selectedExamId, setSelectedExamId] = useState('');
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [credentials, setCredentials] = useState({ candidateId: '', email: '', password: '' });
  const [notice, setNotice] = useState<string | null>(null);

  const exams = useQuery({
    queryKey: ['examinations'],
    queryFn: ({ signal }) => apiGet<{ items: ExamView[]; total: number }>('/examinations?pageSize=100', { signal }),
  });
  const banks = useQuery({
    queryKey: ['examinations', 'banks'],
    queryFn: ({ signal }) => apiGet<QuestionBankView[]>('/examinations/question-banks', { signal }),
  });
  const questions = useQuery({
    queryKey: ['examinations', 'questions'],
    queryFn: ({ signal }) => apiGet<QuestionView[]>('/examinations/questions', { signal }),
  });
  const candidates = useQuery({
    queryKey: ['examinations', 'candidates'],
    queryFn: ({ signal }) => apiGet<{ items: CandidateView[]; total: number }>('/organisations/me/candidates?pageSize=200', { signal }),
  });
  const eligibility = useQuery({
    queryKey: ['examinations', 'eligibility', selectedExamId],
    enabled: Boolean(selectedExamId),
    queryFn: ({ signal }) => apiGet<EligibilityView[]>(`/examinations/${selectedExamId}/eligibility`, { signal }),
  });

  const refreshExams = () => queryClient.invalidateQueries({ queryKey: ['examinations'] });

  const createExam = useMutation({
    mutationFn: () => {
      const questionIds = examForm.questionIds
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return apiPost('/examinations', {
        title: examForm.title,
        type: examForm.type,
        durationMinutes: Number(examForm.durationMinutes),
        totalMarks: Number(examForm.totalMarks),
        passingMarks: Number(examForm.passingMarks),
        sections: questionIds.length
          ? [{ name: 'Main', marks: Number(examForm.totalMarks), questionIds }]
          : [],
      });
    },
    onSuccess: async () => {
      setNotice('Examination draft created.');
      setExamForm({ ...examForm, title: '', questionIds: '' });
      await refreshExams();
    },
  });

  const publishExam = useMutation({
    mutationFn: (id: string) => apiPost(`/examinations/${id}/publish`),
    onSuccess: async () => { setNotice('Examination published; questions are now frozen in a version snapshot.'); await refreshExams(); },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/examinations/${id}/status`, { status }),
    onSuccess: async () => { setNotice('Examination status updated.'); await refreshExams(); },
  });

  const saveEligibility = useMutation({
    mutationFn: () => apiPost(`/examinations/${selectedExamId}/eligibility`, { candidateIds: selectedCandidateIds }),
    onSuccess: async () => { setNotice('Eligibility list updated.'); await queryClient.invalidateQueries({ queryKey: ['examinations', 'eligibility', selectedExamId] }); },
  });

  const createCredentials = useMutation({
    mutationFn: () => apiPost(`/examinations/candidates/${credentials.candidateId}/credentials`, {
      email: credentials.email,
      password: credentials.password,
    }),
    onSuccess: () => { setNotice('Candidate portal credentials enabled.'); setCredentials({ candidateId: '', email: '', password: '' }); },
  });

  if (exams.isError || banks.isError || questions.isError || candidates.isError) {
    return <ErrorBanner error={exams.error ?? banks.error ?? questions.error ?? candidates.error} onRetry={() => { void exams.refetch(); void banks.refetch(); void questions.refetch(); void candidates.refetch(); }} />;
  }

  const items = exams.data?.items ?? [];
  const allQuestions = questions.data ?? [];
  const error = createExam.error ?? publishExam.error ?? setStatus.error ?? saveEligibility.error ?? createCredentials.error;

  return (
    <div className="space-y-5">
      <PageHeader title="Examination management" subtitle="Create, publish and schedule examinations from live question-bank data." />
      {notice && <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{notice}</p>}
      {error && <ErrorBanner error={error} />}
      {(exams.isLoading || banks.isLoading || questions.isLoading || candidates.isLoading) ? <LoadingRows count={8} /> : (
        <>
          <Card title="Create examination draft">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-xs text-muted">Title
                <input className="input w-full" value={examForm.title} onChange={(event) => setExamForm({ ...examForm, title: event.target.value })} />
              </label>
              <label className="space-y-1 text-xs text-muted">Type
                <select className="input w-full" value={examForm.type} onChange={(event) => setExamForm({ ...examForm, type: event.target.value as typeof examForm.type })}>
                  {EXAM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted">Duration (minutes)
                <input className="input w-full" type="number" min={1} value={examForm.durationMinutes} onChange={(event) => setExamForm({ ...examForm, durationMinutes: Number(event.target.value) })} />
              </label>
              <label className="space-y-1 text-xs text-muted">Total marks
                <input className="input w-full" type="number" min={0} value={examForm.totalMarks} onChange={(event) => setExamForm({ ...examForm, totalMarks: Number(event.target.value) })} />
              </label>
              <label className="space-y-1 text-xs text-muted">Passing marks
                <input className="input w-full" type="number" min={0} value={examForm.passingMarks} onChange={(event) => setExamForm({ ...examForm, passingMarks: Number(event.target.value) })} />
              </label>
              <label className="space-y-1 text-xs text-muted">Question IDs (comma separated)
                <input className="input w-full" value={examForm.questionIds} placeholder={allQuestions.slice(0, 2).map((question) => question.id).join(', ')} onChange={(event) => setExamForm({ ...examForm, questionIds: event.target.value })} />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              {banks.data?.length ?? 0} question banks · {allQuestions.length} questions available. Publish freezes the selected questions into an immutable version.
            </p>
            <Button className="mt-3" disabled={createExam.isPending || !examForm.title} onClick={() => createExam.mutate()}>Create draft</Button>
          </Card>

          <Card title="Examinations">
            {items.length === 0 ? <EmptyState message="No examinations yet. Create a draft above." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2">Title</th><th className="py-2">Status</th><th className="py-2">Version</th><th className="py-2">Questions</th><th className="py-2">Actions</th></tr></thead>
                  <tbody>
                    {items.map((exam) => (
                      <tr key={exam.id} className="border-b border-line/60 last:border-0">
                        <td className="py-3"><p className="font-medium">{exam.title}</p><p className="text-xs text-muted">{exam.type} · {exam.durationMinutes} min · {exam.totalMarks} marks</p></td>
                        <td className="py-3"><Badge tone={statusTone(exam.status)}>{exam.status}</Badge></td>
                        <td className="py-3">v{exam.version}</td>
                        <td className="py-3">{exam.questionCount}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="secondary" disabled={publishExam.isPending || exam.status !== ExamStatus.DRAFT} onClick={() => publishExam.mutate(exam.id)}>Publish</Button>
                            <select
                              className="input max-w-[150px] py-1 text-xs"
                              value={exam.status}
                              onChange={(event) => setStatus.mutate({ id: exam.id, status: event.target.value })}
                            >
                              {EXAM_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                            <Button
                              variant="ghost"
                              disabled={exam.status === ExamStatus.DRAFT}
                              onClick={() => { setSelectedExamId(exam.id); setSelectedCandidateIds([]); }}
                            >
                              Eligibility
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Candidate eligibility">
              {!selectedExamId ? <EmptyState message="Select an examination using the Eligibility action." /> : eligibility.isLoading ? <LoadingRows count={4} /> : (
                <div className="space-y-3">
                  <p className="text-xs text-muted">Select candidates to mark eligible with the current exam window.</p>
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                    {(candidates.data?.items ?? []).map((candidate) => (
                      <label key={candidate.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCandidateIds.includes(candidate.id)}
                          onChange={(event) => setSelectedCandidateIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))}
                        />
                        {candidate.firstName} {candidate.lastName} <span className="text-xs text-muted">({candidate.candidateCode})</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted">{eligibility.data?.filter((row) => row.eligible).length ?? 0} currently eligible</p>
                  <Button disabled={saveEligibility.isPending} onClick={() => saveEligibility.mutate()}>Save eligibility</Button>
                </div>
              )}
            </Card>

            <Card title="Candidate portal credentials">
              <div className="space-y-3">
                <label className="block space-y-1 text-xs text-muted">Candidate
                  <select className="input w-full" value={credentials.candidateId} onChange={(event) => setCredentials({ ...credentials, candidateId: event.target.value })}>
                    <option value="">Select candidate</option>
                    {(candidates.data?.items ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.firstName} {candidate.lastName} ({candidate.candidateCode})</option>)}
                  </select>
                </label>
                <label className="block space-y-1 text-xs text-muted">Portal email
                  <input className="input w-full" type="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} />
                </label>
                <label className="block space-y-1 text-xs text-muted">Temporary password (12+ characters)
                  <input className="input w-full" type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
                </label>
                <Button disabled={createCredentials.isPending || !credentials.candidateId || !credentials.email || credentials.password.length < 12} onClick={() => createCredentials.mutate()}>
                  Enable portal access
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
