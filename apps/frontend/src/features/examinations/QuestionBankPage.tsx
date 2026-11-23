import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Difficulty, QuestionType, type QuestionBankView, type QuestionView } from '@examnexus/shared';
import { apiGet, apiPost } from '../../lib/api-client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader } from '../../components/ui/DataState';

const QUESTION_TYPES = Object.values(QuestionType);
const DIFFICULTIES = Object.values(Difficulty);

interface OptionDraft {
  label: string;
  content: string;
  isCorrect: boolean;
}

export function QuestionBankPage() {
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState('');
  const [bankCategory, setBankCategory] = useState('');
  const [selectedBankId, setSelectedBankId] = useState('');
  const [question, setQuestion] = useState({
    type: QuestionType.SINGLE_CHOICE as (typeof QUESTION_TYPES)[number],
    difficulty: Difficulty.MEDIUM as (typeof DIFFICULTIES)[number],
    prompt: '',
    marks: 1,
    options: [{ label: 'A', content: '', isCorrect: true }, { label: 'B', content: '', isCorrect: false }] as OptionDraft[],
  });
  const [notice, setNotice] = useState<string | null>(null);

  const banks = useQuery({
    queryKey: ['examinations', 'banks'],
    queryFn: ({ signal }) => apiGet<QuestionBankView[]>('/examinations/question-banks', { signal }),
  });
  const questions = useQuery({
    queryKey: ['examinations', 'questions', selectedBankId],
    queryFn: ({ signal }) => apiGet<QuestionView[]>(`/examinations/questions${selectedBankId ? `?bankId=${selectedBankId}` : ''}`, { signal }),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['examinations', 'banks'] });
    await queryClient.invalidateQueries({ queryKey: ['examinations', 'questions'] });
  };

  const createBank = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/examinations/question-banks', { name: bankName, category: bankCategory || undefined }),
    onSuccess: async (created: { id: string }) => {
      setBankName('');
      setBankCategory('');
      setSelectedBankId(created.id);
      setNotice('Question bank created.');
      await refresh();
    },
  });

  const createQuestion = useMutation({
    mutationFn: () => apiPost(`/examinations/question-banks/${selectedBankId}/questions`, {
      questions: [{
        type: question.type,
        difficulty: question.difficulty,
        prompt: question.prompt,
        marks: Number(question.marks),
        options: question.options.map((option, index) => ({ ...option, position: index })),
      }],
    }),
    onSuccess: async () => {
      setQuestion({ ...question, prompt: '', options: [{ label: 'A', content: '', isCorrect: true }, { label: 'B', content: '', isCorrect: false }] });
      setNotice('Question added to the bank.');
      await refresh();
    },
  });

  if (banks.isError || questions.isError) {
    return <ErrorBanner error={banks.error ?? questions.error} onRetry={() => { void banks.refetch(); void questions.refetch(); }} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Question bank management" subtitle="Maintain reusable, tenant-isolated question banks and their options." />
      {notice && <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{notice}</p>}
      {(createBank.error ?? createQuestion.error) && <ErrorBanner error={createBank.error ?? createQuestion.error} />}
      {banks.isLoading ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Create question bank">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted">Name
                <input className="input w-full" value={bankName} onChange={(event) => setBankName(event.target.value)} />
              </label>
              <label className="space-y-1 text-xs text-muted">Category
                <input className="input w-full" value={bankCategory} onChange={(event) => setBankCategory(event.target.value)} />
              </label>
            </div>
            <Button className="mt-3" disabled={createBank.isPending || bankName.length < 2} onClick={() => createBank.mutate()}>Create bank</Button>
          </Card>

          <Card title="Add question">
            {banks.data?.length === 0 ? <EmptyState message="Create a bank first." /> : (
              <div className="space-y-3">
                <label className="block space-y-1 text-xs text-muted">Question bank
                  <select className="input w-full" value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>
                    <option value="">Select bank</option>
                    {(banks.data ?? []).map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted">Type
                    <select className="input w-full" value={question.type} onChange={(event) => setQuestion({ ...question, type: event.target.value as typeof question.type })}>
                      {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted">Difficulty
                    <select className="input w-full" value={question.difficulty} onChange={(event) => setQuestion({ ...question, difficulty: event.target.value as typeof question.difficulty })}>
                      {DIFFICULTIES.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs text-muted">Prompt
                  <textarea className="input w-full" rows={3} value={question.prompt} onChange={(event) => setQuestion({ ...question, prompt: event.target.value })} />
                </label>
                <label className="block space-y-1 text-xs text-muted">Marks
                  <input className="input w-full" type="number" min={0} value={question.marks} onChange={(event) => setQuestion({ ...question, marks: Number(event.target.value) })} />
                </label>
                <div className="space-y-2">
                  <p className="text-xs font-medium">Options</p>
                  {question.options.map((option, index) => (
                    <div key={index} className="grid grid-cols-[60px_1fr_auto] items-center gap-2">
                      <input className="input w-full" value={option.label} onChange={(event) => {
                        const options = [...question.options];
                        options[index] = { ...option, label: event.target.value };
                        setQuestion({ ...question, options });
                      }} />
                      <input className="input w-full" placeholder="Option content" value={option.content} onChange={(event) => {
                        const options = [...question.options];
                        options[index] = { ...option, content: event.target.value };
                        setQuestion({ ...question, options });
                      }} />
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={option.isCorrect}
                          onChange={(event) => {
                            const options = question.options.map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index ? event.target.checked : false }));
                            setQuestion({ ...question, options });
                          }}
                        />
                        Correct
                      </label>
                    </div>
                  ))}
                  <Button variant="ghost" onClick={() => setQuestion({ ...question, options: [...question.options, { label: String.fromCharCode(65 + question.options.length), content: '', isCorrect: false }] })}>
                    Add option
                  </Button>
                </div>
                <Button
                  disabled={createQuestion.isPending || !selectedBankId || !question.prompt || question.options.some((option) => !option.content)}
                  onClick={() => createQuestion.mutate()}
                >
                  Add question
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <Card title={`Questions${selectedBankId ? ` in ${banks.data?.find((bank) => bank.id === selectedBankId)?.name ?? ''}` : ''}`}>
        {questions.isLoading ? <LoadingRows count={5} /> : (questions.data?.length ?? 0) === 0 ? <EmptyState message="No questions in this bank yet." /> : (
          <div className="space-y-3">
            {questions.data?.map((item) => (
              <div key={item.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{item.prompt}</p>
                  <span className="shrink-0 text-xs text-muted">{item.type} · {item.marks} marks</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                  {item.options.map((option) => <span key={option.id} className="rounded border border-line px-2 py-1">{option.label}. {option.content}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
