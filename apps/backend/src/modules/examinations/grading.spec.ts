import { QuestionType } from '@examnexus/shared';
import { gradeAnswer, seededShuffle, snapshotHash, type GradeableQuestion } from './grading';

function question(type: QuestionType, overrides: Partial<GradeableQuestion> = {}): GradeableQuestion {
  return {
    id: 'q1',
    type,
    marks: 4,
    negativeMarks: 1,
    options: [
      { id: 'a', label: 'A', content: 'Paris', isCorrect: true },
      { id: 'b', label: 'B', content: 'London', isCorrect: false },
      { id: 'c', label: 'C', content: 'Rome', isCorrect: false },
    ],
    ...overrides,
  };
}

describe('objective grading', () => {
  it('accepts a correct single choice by id, label or content', () => {
    const item = question(QuestionType.SINGLE_CHOICE);
    expect(gradeAnswer(item, 'a')).toEqual({ marks: 4, isCorrect: true });
    expect(gradeAnswer(item, ' A ')).toEqual({ marks: 4, isCorrect: true });
    expect(gradeAnswer(item, 'paris')).toEqual({ marks: 4, isCorrect: true });
  });

  it('applies negative marks for wrong single choices and zero for blanks', () => {
    const item = question(QuestionType.SINGLE_CHOICE);
    expect(gradeAnswer(item, 'b')).toEqual({ marks: -1, isCorrect: false });
    expect(gradeAnswer(item, '')).toEqual({ marks: 0, isCorrect: false });
  });

  it('grades multiple-choice partial credit, exact answers and wrong selections', () => {
    const item = question(QuestionType.MULTIPLE_CHOICE, {
      options: [
        { id: 'a', label: 'A', content: 'One', isCorrect: true },
        { id: 'b', label: 'B', content: 'Two', isCorrect: true },
        { id: 'c', label: 'C', content: 'Three', isCorrect: false },
      ],
    });
    expect(gradeAnswer(item, ['a', 'b'])).toEqual({ marks: 4, isCorrect: true });
    expect(gradeAnswer(item, ['a'])).toEqual({ marks: 2, isCorrect: false });
    expect(gradeAnswer(item, ['a', 'c'])).toEqual({ marks: -1, isCorrect: false });
  });

  it('does not let repeated selections inflate multiple-choice credit', () => {
    const item = question(QuestionType.MULTIPLE_CHOICE, {
      options: [
        { id: 'a', label: 'A', content: 'One', isCorrect: true },
        { id: 'b', label: 'B', content: 'Two', isCorrect: true },
        { id: 'c', label: 'C', content: 'Three', isCorrect: false },
      ],
    });
    expect(gradeAnswer(item, ['a', 'a', 'b', 'b'])).toEqual({ marks: 4, isCorrect: true });
    expect(gradeAnswer(item, ['A', 'a', 'A'])).toEqual({ marks: 2, isCorrect: false });
    expect(gradeAnswer(item, ['a', 'a', 'c', 'c'])).toEqual({ marks: -1, isCorrect: false });
    expect(gradeAnswer(item, ['a', 'a', 'a', 'a', 'b'])).toEqual({ marks: 4, isCorrect: true });
  });

  it('caps partial credit at the question marks', () => {
    const item = question(QuestionType.MULTIPLE_CHOICE, {
      marks: 2,
      options: [
        { id: 'a', label: 'A', content: 'One', isCorrect: true },
        { id: 'a', label: 'A2', content: 'Alias', isCorrect: true },
        { id: 'b', label: 'B', content: 'Two', isCorrect: false },
      ],
    });
    const outcome = gradeAnswer(item, ['a', 'A']);
    expect(outcome.isCorrect).toBe(true);
    expect(outcome.marks).toBeLessThanOrEqual(2);
  });

  it('normalises fill-in-the-blank answers against the hidden expected answer', () => {
    const item = question(QuestionType.FILL_BLANK, { expectedAnswer: 'paris' });
    expect(gradeAnswer(item, '  PARIS ')).toEqual({ marks: 4, isCorrect: true });
    expect(gradeAnswer(item, 'Paris   France')).toEqual({ marks: -1, isCorrect: false });
  });

  it('never grades a fill-in-the-blank answer from option content', () => {
    const item = question(QuestionType.FILL_BLANK, { expectedAnswer: 'new delhi' });
    expect(gradeAnswer(item, 'paris')).toEqual({ marks: -1, isCorrect: false });
    expect(gradeAnswer(item, 'New Delhi')).toEqual({ marks: 4, isCorrect: true });
  });

  it('leaves subjective questions for manual evaluation', () => {
    expect(gradeAnswer(question(QuestionType.ESSAY), 'a long response')).toEqual({ marks: null, isCorrect: null });
  });
});

describe('delivery helpers', () => {
  it('shuffles deterministically from a seed without dropping items', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(input, 'attempt-1')).toEqual(seededShuffle(input, 'attempt-1'));
    expect(seededShuffle(input, 'attempt-1')).toHaveLength(input.length);
    expect([...seededShuffle(input, 'attempt-1')].sort()).toEqual(input);
    expect(seededShuffle(input, 'attempt-1')).not.toEqual(seededShuffle(input, 'attempt-2'));
  });

  it('hashes version snapshots reproducibly', () => {
    const snapshot = { version: 1, title: 'Midterm', questionIds: ['a', 'b'] };
    expect(snapshotHash(snapshot)).toBe(snapshotHash(snapshot));
    expect(snapshotHash(snapshot)).not.toBe(snapshotHash({ ...snapshot, version: 2 }));
    expect(snapshotHash(snapshot)).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotHash({ b: 2, a: 1 })).toBe(snapshotHash({ a: 1, b: 2 }));
  });
});
