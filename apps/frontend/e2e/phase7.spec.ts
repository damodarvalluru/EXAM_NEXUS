import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {
  AdvancedReportView,
  AiSuggestionView,
  CertificateVerificationView,
  CertificateView,
  EvaluationDetailView,
  EvaluationQueueItem,
  ProctorAttemptView,
  ReviewOutcomeView,
  RiskAssessmentView,
  SecurityEventView,
} from '@examnexus/shared';
import {
  LIVE_MODE,
  captureApiResponse,
  captureDownload,
  openProtected,
  requireLiveFixture,
  setupApi,
  waitForApiResponse,
} from './support/api';
import {
  certificateRoutes,
  evaluationScenario,
  ORG_USER,
  proctoringScenario,
  reportRoutes,
} from './support/fixtures';

test('advanced evaluation queue generates advisory suggestions and records a human review', async ({ page }) => {
  const scenario = evaluationScenario();
  await setupApi(page, { user: ORG_USER, routes: scenario.routes });

  const queuePromise = waitForApiResponse<EvaluationQueueItem[]>(page, 'GET', '/advanced/evaluations/queue');
  const detailPromise = waitForApiResponse<EvaluationDetailView>(
    page,
    'GET',
    (path) => path.startsWith('/advanced/evaluations/') && !path.includes('/queue') && !path.includes('/history'),
  );
  await openProtected(page, '/org/evaluation/advanced', 'org');
  const queue = await queuePromise;
  const detail = await detailPromise;

  const queueItem = queue[0];
  const answer = detail.answers[0];
  requireLiveFixture(queueItem && answer, 'a submitted attempt with at least one subjective answer');
  if (!queueItem || !answer) throw new Error('The evaluation queue did not contain a reviewable attempt.');

  await expect(page.getByRole('heading', { name: 'Advanced evaluation' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(queueItem.candidateName) })).toBeVisible();
  await expect(page.getByText('Reviewer-controlled marking.', { exact: false })).toBeVisible();
  await expect(page.getByText(answer.prompt, { exact: false }).first()).toBeVisible();

  const suggestion = await captureApiResponse<AiSuggestionView>(
    page,
    'POST',
    `/advanced/evaluations/${detail.attemptId}/ai-suggestions/${answer.questionId}`,
    () => page.getByRole('button', { name: 'Request AI suggestion' }).first().click(),
  );
  await expect(page.getByText(`${suggestion.confidence.toLowerCase()} confidence`, { exact: true })).toBeVisible();
  await expect(page.getByText('Advisory only.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Apply suggested marks to draft' }).click();
  const acceptedMarks = Math.min(answer.maxMarks, Math.round(suggestion.suggestedMarks * 100) / 100);
  await expect(page.locator(`#marks-${answer.questionId}`)).toHaveValue(String(acceptedMarks));

  const outcome = await captureApiResponse<ReviewOutcomeView>(
    page,
    'POST',
    `/advanced/evaluations/${detail.attemptId}/review`,
    () => page.getByRole('button', { name: 'Submit review' }).click(),
  );
  await expect(
    page.getByText('Review submitted. Result values have been recomputed from the recorded marks.'),
  ).toBeVisible();
  await expect(page.getByText(new RegExp(`Score .*\\u2192 ${outcome.score}`), { exact: false })).toBeVisible();
  expect(outcome.reviewedAnswers).toBeGreaterThan(0);
});

test('proctoring review records event investigation and a human decision', async ({ page }) => {
  const scenario = proctoringScenario();
  await setupApi(page, { user: ORG_USER, routes: scenario.routes });

  const attemptsPromise = waitForApiResponse<ProctorAttemptView[]>(page, 'GET', '/advanced/proctoring/attempts');
  const detailPromise = waitForApiResponse<ProctorAttemptView>(
    page,
    'GET',
    (path) => path.startsWith('/advanced/proctoring/attempts/'),
  );
  await openProtected(page, '/org/proctoring', 'org');
  const attempts = await attemptsPromise;
  const detail = await detailPromise;

  const listedAttempt = attempts[0];
  const event = detail.events.find((item) => !item.investigated);
  const assessment = detail.assessments[0];
  requireLiveFixture(listedAttempt && event && assessment, 'a proctored attempt with one pending event and one assessment');
  if (!listedAttempt || !event || !assessment) {
    throw new Error('The proctoring fixture did not contain a reviewable event and assessment.');
  }

  await expect(page.getByRole('heading', { name: 'Proctoring review' })).toBeVisible();
  await expect(page.getByText('Advisory signals only.', { exact: false })).toBeVisible();
  await expect(page.getByText(event.eventType, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Awaiting review', { exact: true })).toBeVisible();

  const investigated = await captureApiResponse<SecurityEventView>(
    page,
    'PATCH',
    `/advanced/proctoring/events/${event.id}`,
    () => page.getByRole('button', { name: 'Mark investigated' }).first().click(),
  );
  expect(investigated.investigated).toBe(true);
  await expect(page.getByRole('button', { name: 'Reopen' }).first()).toBeVisible();

  await page.locator('#risk-appeal-status').fill('OPEN');
  await page.locator('#risk-review-note').fill('Reviewed in browser E2E');
  const reviewed = await captureApiResponse<RiskAssessmentView>(
    page,
    'POST',
    `/advanced/proctoring/assessments/${assessment.id}/review`,
    () => page.getByRole('button', { name: 'Save human review' }).click(),
  );
  await expect(page.getByText('Human review of the risk assessment saved.')).toBeVisible();
  expect(reviewed.appealStatus).toBe('OPEN');
  expect(reviewed.reviewedBy).toBeTruthy();
});

test('advanced reports render metrics and export a CSV download', async ({ page }) => {
  await setupApi(page, { user: ORG_USER, routes: reportRoutes() });

  const report = await captureApiResponse<AdvancedReportView>(
    page,
    'GET',
    '/advanced/reports/exams',
    () => openProtected(page, '/org/reports', 'org'),
  );
  await expect(page.getByRole('heading', { name: 'Advanced reports' })).toBeVisible();
  await expect(page.getByText('Risk figures are advisory.', { exact: false })).toBeVisible();
  const attemptsCard = page.locator('section').filter({ hasText: 'Attempts' }).first();
  await expect(attemptsCard.getByText(String(report.summary.attempts), { exact: true })).toBeVisible();

  const download = await captureDownload(page, () => page.getByRole('button', { name: 'Export CSV' }).click());
  expect(download.suggestedFilename()).toMatch(/^examnexus-report-exams.*\.csv$/);
  const downloadPath = await download.path();
  const csv = await readFile(downloadPath, 'utf8');
  expect(csv.length).toBeGreaterThan(0);
  if (!LIVE_MODE) expect(csv).toContain('kind,label,value');
});

test('certificate screen links to public verification and verifies a code', async ({ page }) => {
  await setupApi(page, { user: ORG_USER, routes: certificateRoutes() });

  const certificates = await captureApiResponse<CertificateView[]>(
    page,
    'GET',
    '/advanced/certificates',
    () => openProtected(page, '/org/certificates', 'org'),
  );
  const certificate = certificates.find((item) => !item.revokedAt);
  requireLiveFixture(certificate, 'an active certificate in the seeded organisation');
  if (!certificate) throw new Error('No active certificate is available to verify.');

  await expect(page.getByRole('heading', { name: 'Certificates', exact: true })).toBeVisible();
  const verificationLink = page.getByRole('link', { name: /Open public verification/ });
  await expect(verificationLink).toHaveAttribute('href', '/verify-certificate');
  await verificationLink.click();
  await expect(page).toHaveURL(/\/verify-certificate$/);

  await page.getByLabel('Certificate verification code').fill(certificate.verificationCode);
  const verification = await captureApiResponse<CertificateVerificationView>(
    page,
    'GET',
    '/advanced/certificates/verify',
    () => page.getByRole('button', { name: 'Verify' }).click(),
  );
  expect(verification.valid).toBe(true);
  await expect(page.getByText('VALID', { exact: true })).toBeVisible();
  await expect(page.getByText(certificate.candidateName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(certificate.certificateNumber, { exact: true })).toBeVisible();
});
