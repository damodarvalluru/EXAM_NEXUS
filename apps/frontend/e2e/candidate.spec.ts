import { expect, test } from '@playwright/test';
import type {
  AttemptView,
  CandidateExamView,
  SubmitReceipt,
} from '@examnexus/shared';
import {
  LIVE_MODE,
  captureApiResponse,
  openProtected,
  requireLiveFixture,
  setupApi,
  waitForApiRequest,
} from './support/api';
import { candidateScenario, CANDIDATE_USER } from './support/fixtures';

test('candidate can start an exam, autosave an answer and submit', async ({ page }) => {
  const scenario = candidateScenario();
  await setupApi(page, { user: CANDIDATE_USER, routes: scenario.routes });

  const exams = await captureApiResponse<CandidateExamView[]>(
    page,
    'GET',
    '/candidate/exams',
    () => openProtected(page, '/candidate/exams', 'candidate'),
  );
  const exam = exams.find((item) => item.available);
  requireLiveFixture(exam, 'an available candidate examination (seeded in live mode)');
  if (!exam) throw new Error('No available examination was returned for the candidate.');

  await expect(page.getByRole('heading', { name: 'Candidate portal' })).toBeVisible();
  const examCard = page.locator('section').filter({ has: page.getByRole('heading', { name: exam.title }) });
  const startButton = examCard.getByRole('button', { name: 'Start examination' });
  await expect(startButton).toBeEnabled();

  // The start response is the authoritative source for attempt/question IDs in
  // both offline and live modes; no hard-coded live database IDs are needed.
  const attempt = await captureApiResponse<AttemptView>(
    page,
    'POST',
    `/candidate/exams/${exam.id}/start`,
    () => startButton.click(),
  );
  await expect(page).toHaveURL(/\/candidate\/exams$/);
  await expect(page.getByRole('heading', { name: attempt.title, exact: true })).toBeVisible();
  await expect(page.getByText('IN_PROGRESS', { exact: true }).first()).toBeVisible();

  const question = attempt.questions.find((item) => item.type === 'SINGLE_CHOICE' || item.type === 'TRUE_FALSE');
  requireLiveFixture(question, 'a single-choice or true/false first question in the seeded exam');
  if (!question) throw new Error('The started attempt has no radio-button question to answer.');
  const option = question.options[0]!;

  const autosavePromise = waitForApiRequest(page, 'PUT', `/candidate/attempts/${attempt.id}/answers`);
  await page.locator(`input[name="${question.id}"]`).first().check();
  const autosave = await autosavePromise;
  const payload = autosave.postDataJSON() as {
    questionId: string;
    answer: { value: string };
    idempotencyKey: string;
  };
  expect(payload.questionId).toBe(question.id);
  expect(payload.answer.value).toBe(option.id);
  expect(payload.idempotencyKey).toContain(question.id);
  await expect(page.getByText('Saving shortly…', { exact: true })).toBeHidden();

  const receipt = await captureApiResponse<SubmitReceipt>(
    page,
    'POST',
    `/candidate/attempts/${attempt.id}/submit`,
    () => page.getByRole('button', { name: 'Submit examination' }).click(),
  );
  await expect(page.getByRole('heading', { name: 'Submission receipt' })).toBeVisible();
  await expect(page.getByText(receipt.receiptHash, { exact: true })).toBeVisible();
  await expect(page.getByText('SUBMITTED', { exact: true }).first()).toBeVisible();
  expect(receipt.attemptId).toBe(attempt.id);

  if (!LIVE_MODE) {
    // Offline fixtures always publish a result. In live mode the receipt is the
    // durable submit proof; result publication is an organisation policy.
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByText(`${receipt.score} / ${receipt.totalMarks} marks`, { exact: true })).toBeVisible();
  }
});
