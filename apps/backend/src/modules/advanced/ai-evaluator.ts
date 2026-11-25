import type { AiSuggestionView, RubricCriterionView } from '@examnexus/shared';

export interface SuggestionInput {
  attemptId: string;
  questionId: string;
  prompt: string;
  answer: unknown;
  maxMarks: number;
  questionType: string;
  evaluationId: string;
}

export const AI_EVALUATOR_VERSION = 'deterministic-rubric-v1';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'what', 'which',
  'when', 'where', 'how', 'why', 'does', 'did', 'you', 'your', 'into', 'about', 'have', 'has',
  'had', 'its', 'their', 'them', 'then', 'than', 'not', 'but', 'all', 'can', 'will', 'would',
  'should', 'could', 'please', 'explain', 'describe', 'discuss', 'following',
]);

function answerText(answer: unknown): string {
  if (typeof answer === 'string') return answer;
  if (Array.isArray(answer)) return answer.map(answerText).join(' ');
  if (answer && typeof answer === 'object') {
    return Object.values(answer as Record<string, unknown>).map(answerText).join(' ');
  }
  return answer === undefined || answer === null ? '' : String(answer);
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

/**
 * Explainable, deterministic scoring aid. It NEVER writes marks by itself:
 * the API stores the result as an Evaluation suggestion and requires a human
 * reviewer to accept or modify it before the answer/result is updated.
 */
export function suggestMarks(input: SuggestionInput): AiSuggestionView {
  const text = answerText(input.answer).trim();
  const words = tokens(text);
  const promptWords = tokens(input.prompt);
  const overlap = promptWords.size
    ? [...words].filter((word) => promptWords.has(word)).length / promptWords.size
    : 0;
  const sentences = text.split(/[.!?]+/).filter((part) => part.trim().length > 0).length;
  const max = Math.max(0, input.maxMarks);

  const criteria: RubricCriterionView[] = [
    {
      criterion: 'Substance',
      weight: 0.3,
      met: text.length >= 40,
      reason: text.length >= 40 ? 'Answer contains a substantive response' : 'Answer is very short',
    },
    {
      criterion: 'Relevance to prompt',
      weight: 0.3,
      met: overlap >= 0.2,
      reason: overlap >= 0.2 ? `Shares ${Math.round(overlap * 100)}% of prompt terminology` : 'Little overlap with the question terminology',
    },
    {
      criterion: 'Structure',
      weight: 0.2,
      met: sentences >= 2 || /[-*\n]/.test(text),
      reason: sentences >= 2 || /[-*\n]/.test(text) ? 'Answer is organised into multiple points' : 'Answer is not clearly structured',
    },
    {
      criterion: 'Completeness',
      weight: 0.2,
      met: text.length >= 120 || sentences >= 3,
      reason: text.length >= 120 || sentences >= 3 ? 'Answer covers the topic in depth' : 'Answer may be incomplete',
    },
  ];

  const fraction = criteria.reduce((sum, criterion) => sum + (criterion.met ? criterion.weight : 0), 0);
  const suggestedMarks = Math.min(max, Math.round(max * fraction * 100) / 100);
  const confidence: AiSuggestionView['confidence'] =
    criteria[0]!.met && criteria[1]!.met ? 'MODERATE' : 'LOW';

  return {
    evaluationId: input.evaluationId,
    attemptId: input.attemptId,
    questionId: input.questionId,
    suggestedMarks,
    maxMarks: max,
    confidence,
    rationale: `${criteria.filter((criterion) => criterion.met).map((criterion) => criterion.criterion).join(', ') || 'No rubric criteria met'}`,
    rubricBreakdown: criteria,
    modelVersion: AI_EVALUATOR_VERSION,
    requiresHumanReview: true,
  };
}
