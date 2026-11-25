/**
 * ExamNexus candidate flow load script (k6 ES modules).
 *
 * IMPORTANT — READ BEFORE RUNNING
 * - Credentials are REQUIRED. The script fails during initialisation when any of
 *   TENANT_ID, CANDIDATE_EMAIL, CANDIDATE_PASSWORD or EXAM_ID is missing.
 * - Run this ONLY against a dedicated staging/demo database seeded with a candidate
 *   who is eligible for EXAM_ID. NEVER point BASE_URL at production: this script
 *   starts attempts, saves answers and submits attempts.
 * - The configured account is shared by all VUs. Active attempts are reused and
 *   idempotency keys are stable per attempt/question, so concurrent VUs do not
 *   corrupt each other's answers. Once an attempt is submitted, later VUs skip the
 *   write steps and continue with read-only checks.
 * - Access tokens live for 15 minutes; keep DURATION below that or re-authenticate.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { sha256 } from 'k6/crypto';

const DEFAULT_BASE_URL = 'http://localhost:3000';

function readEnv(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

function positiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`[ExamNexus load test] ${name} must be a positive integer; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** All configuration is read from the k6 environment (-e KEY=value). */
export const CONFIG = {
  baseUrl: readEnv('BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, ''),
  tenantId: readEnv('TENANT_ID', ''),
  email: readEnv('CANDIDATE_EMAIL', ''),
  password: readEnv('CANDIDATE_PASSWORD', ''),
  examId: readEnv('EXAM_ID', ''),
  vus: positiveInt(readEnv('VUS', '200'), 'VUS'),
  duration: readEnv('DURATION', '5m'),
};

const REQUIRED_CONFIG = ['TENANT_ID', 'CANDIDATE_EMAIL', 'CANDIDATE_PASSWORD', 'EXAM_ID'];
const ENV_NAME = {
  TENANT_ID: 'tenantId',
  CANDIDATE_EMAIL: 'email',
  CANDIDATE_PASSWORD: 'password',
  EXAM_ID: 'examId',
};

/** Fail fast (called at init below and again in setup before any traffic). */
export function assertConfig() {
  const missing = REQUIRED_CONFIG.filter((name) => !CONFIG[ENV_NAME[name]]);
  if (missing.length > 0) {
    throw new Error(
      `[ExamNexus load test] Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Pass them with k6 -e TENANT_ID=... -e CANDIDATE_EMAIL=... ' +
        '-e CANDIDATE_PASSWORD=... -e EXAM_ID=... and use a STAGING database only.',
    );
  }
}

assertConfig();

export const THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1500'],
  checks: ['rate>0.99'],
};

// With a shared candidate and maxAttempts=1, concurrent VUs legitimately receive 409 after the first
// VU has started/submitted the attempt. Treat that terminal conflict as an expected idempotent race,
// not as a server failure, while still counting every other 4xx/5xx as failed.
const START_RESPONSE_CALLBACK = http.expectedStatuses({ min: 200, max: 299 }, 409);

export const options = {
  vus: CONFIG.vus,
  duration: CONFIG.duration,
  thresholds: THRESHOLDS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

let setupSummary = null;

function url(path) {
  return `${CONFIG.baseUrl}${path}`;
}

function requestHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** APIs use { success, data, meta } envelopes; tolerate a bare array/object too. */
export function parseBody(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

export function dataOf(response) {
  const body = parseBody(response);
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, 'data')) {
    return body.data;
  }
  return body;
}

function errorOf(response) {
  const body = parseBody(response);
  return body && typeof body === 'object' ? body.error : null;
}

/** Login through the documented envelope. Returns the bearer access token. */
export function login() {
  const response = http.post(
    url('/api/v1/auth/login'),
    JSON.stringify({ identifier: CONFIG.email, password: CONFIG.password }),
    { headers: requestHeaders(), tags: { endpoint: 'auth.login' } },
  );
  const body = parseBody(response);
  const token = body && body.data ? body.data.accessToken : null;
  const ok = check(response, {
    'login: HTTP 2xx': response.status >= 200 && response.status < 300,
    'login: success envelope': body?.success !== false,
    'login: accessToken present': typeof token === 'string' && token.length > 0,
  });
  if (!ok || typeof token !== 'string' || token.length === 0) {
    const code = errorOf(response)?.code ?? body?.data?.status ?? 'unknown';
    throw new Error(
      `[ExamNexus load test] Login failed (${code}). Check CANDIDATE_EMAIL/CANDIDATE_PASSWORD. ` +
        'MFA_REQUIRED accounts need a non-MFA staging login first; the load script does not solve TOTP.',
    );
  }
  return token;
}

/** Runs once. Verifies the candidate can see EXAM_ID and logs a setup summary. */
export function setupCandidate() {
  assertConfig();
  const token = login();

  const response = http.get(url('/api/v1/candidate/exams'), {
    headers: requestHeaders(token),
    tags: { endpoint: 'candidate.exams' },
  });
  const exams = dataOf(response);
  check(response, {
    'setup exams: HTTP 200': response.status === 200,
    'setup exams: array payload': Array.isArray(exams),
  });
  if (!Array.isArray(exams)) {
    throw new Error('[ExamNexus load test] GET /api/v1/candidate/exams did not return an array.');
  }

  const exam = exams.find((entry) => entry && entry.id === CONFIG.examId);
  if (!exam) {
    throw new Error(
      `[ExamNexus load test] EXAM_ID ${CONFIG.examId} is not visible to ${CONFIG.email} ` +
        `(visible: ${exams.map((entry) => entry?.id).join(', ') || 'none'}). ` +
        'Seed the candidate examination assignment in the staging database.',
    );
  }

  const summary = {
    at: new Date().toISOString(),
    baseUrl: CONFIG.baseUrl,
    tenantId: CONFIG.tenantId,
    examId: CONFIG.examId,
    examTitle: exam.title ?? null,
    examAvailable: exam.available ?? null,
    examsVisible: exams.length,
    configuredVus: CONFIG.vus,
    configuredDuration: CONFIG.duration,
  };
  setupSummary = summary;
  // eslint-disable-next-line no-console
  console.log(
    `[setup] tenant=${summary.tenantId} exam=${summary.examId} examsVisible=${summary.examsVisible} ` +
      `available=${summary.examAvailable} target=${summary.baseUrl} vus=${summary.configuredVus} ` +
      `duration=${summary.configuredDuration}`,
  );
  return { token, examId: CONFIG.examId, summary };
}

/** k6 setup hook. Keeping this export here makes the documented `k6 run candidate-flow.js` work. */
export const setup = setupCandidate;

/** One full candidate journey. Safe to run repeatedly for the same account. */
export function runCandidateFlow(ctx) {
  const token = ctx.token;
  const examId = ctx.examId;

  group('candidate exams', () => {
    const response = http.get(url('/api/v1/candidate/exams'), {
      headers: requestHeaders(token),
      tags: { endpoint: 'candidate.exams' },
    });
    const exams = dataOf(response);
    check(response, {
      'exams: HTTP 200': response.status === 200,
      'exams: array payload': Array.isArray(exams),
      'exams: configured exam visible': Array.isArray(exams) && exams.some((entry) => entry?.id === examId),
    });
  });

  let attemptId = null;
  group('attempt resolution', () => {
    const history = http.get(url('/api/v1/candidate/attempts'), {
      headers: requestHeaders(token),
      tags: { endpoint: 'candidate.attempts' },
    });
    const rows = dataOf(history);
    check(history, {
      'history: HTTP 200': history.status === 200,
      'history: array payload': Array.isArray(rows),
    });

    // Guard: an IN_PROGRESS attempt for this exam must be reused, never started twice.
    const open = Array.isArray(rows)
      ? rows.find((row) => row && row.examinationId === examId && row.status === 'IN_PROGRESS')
      : null;
    if (open) {
      attemptId = open.id;
      check(open, { 'start skipped: IN_PROGRESS attempt reused': Boolean(open.id) });
      return;
    }

    const start = http.post(
      url(`/api/v1/candidate/exams/${encodeURIComponent(examId)}/start`),
      '{}',
      {
        headers: requestHeaders(token),
        tags: { endpoint: 'candidate.start' },
        responseCallback: START_RESPONSE_CALLBACK,
      },
    );
    const started = dataOf(start);
    const conflictAttemptId =
      errorOf(start)?.details?.attemptId ??
      (started && typeof started === 'object' ? started.details?.attemptId ?? started.attemptId : null);

    // Another VU may have started/submitted the attempt between our history call and this POST.
    // Both "already in progress" (with attemptId) and "maximum attempts reached" are expected races
    // for a shared staging candidate; neither is a product failure.
    if (start.status === 409) {
      const message = errorOf(start)?.message ?? '';
      const expectedRace =
        Boolean(conflictAttemptId) || /already in progress|maximum attempts reached/i.test(message);
      if (conflictAttemptId) attemptId = conflictAttemptId;
      check(start, { 'start: expected 409 race handled': expectedRace });
      return;
    }

    check(start, {
      'start: HTTP 2xx': start.status >= 200 && start.status < 300,
      'start: envelope success': parseBody(start)?.success !== false,
      'start: attempt id returned': typeof started?.id === 'string',
    });
    attemptId = typeof started?.id === 'string' ? started.id : null;
  });

  if (!attemptId) return;

  let attempt = null;
  group('attempt detail', () => {
    const response = http.get(url(`/api/v1/candidate/attempts/${encodeURIComponent(attemptId)}`), {
      headers: requestHeaders(token),
      tags: { endpoint: 'candidate.attempt.get' },
    });
    attempt = dataOf(response);
    check(response, {
      'attempt: HTTP 200': response.status === 200,
      'attempt: id matches': attempt?.id === attemptId,
      'attempt: questions array': Array.isArray(attempt?.questions),
      'attempt: status present': typeof attempt?.status === 'string',
    });
  });

  // A submitted/auto-submitted attempt cannot accept answers; stay read-only.
  if (!attempt || attempt.status !== 'IN_PROGRESS' || !Array.isArray(attempt.questions) || attempt.questions.length === 0) {
    return;
  }

  const question = attempt.questions[0];
  const value =
    Array.isArray(question.options) && question.options.length > 0 && question.options[0]?.id
      ? question.options[0].id
      : 'load-test-answer';

  // Stable keys are derived from the attempt and question, NOT from __VU/__ITER:
  // retries and concurrent VUs must resolve to the same saved answer/receipt.
  // The API DTO limits idempotency keys to 80 characters. Hash the long composite key so it stays
  // deterministic across concurrent VUs/retries while satisfying validation.
  const answerKey = `a:${sha256(`${CONFIG.tenantId}:attempt:${attemptId}:question:${question.id}:answer:v1`, 'hex')}`;
  const submitKey = `s:${sha256(`${CONFIG.tenantId}:attempt:${attemptId}:submit:v1`, 'hex')}`;

  group('answer autosave', () => {
    const response = http.put(
      url(`/api/v1/candidate/attempts/${encodeURIComponent(attemptId)}/answers`),
      JSON.stringify({ questionId: question.id, answer: { value }, idempotencyKey: answerKey }),
      { headers: requestHeaders(token), tags: { endpoint: 'candidate.answer' } },
    );
    const saved = dataOf(response);
    check(response, {
      'answer: HTTP 2xx': response.status >= 200 && response.status < 300,
      'answer: envelope success': parseBody(response)?.success !== false,
      'answer: saved=true': saved?.saved === true,
    });
  });

  group('submit attempt', () => {
    const response = http.post(
      url(`/api/v1/candidate/attempts/${encodeURIComponent(attemptId)}/submit`),
      JSON.stringify({ idempotencyKey: submitKey, clientTime: new Date().toISOString() }),
      { headers: requestHeaders(token), tags: { endpoint: 'candidate.submit' } },
    );
    const receipt = dataOf(response);
    check(response, {
      'submit: HTTP 2xx': response.status >= 200 && response.status < 300,
      'submit: envelope success': parseBody(response)?.success !== false,
      'submit: receipt returned':
        typeof receipt?.receiptHash === 'string' || typeof receipt?.submissionId === 'string',
    });
  });
}

export function handleSummary(data) {
  const metrics = data.metrics ?? {};
  const report = {
    generatedAt: new Date().toISOString(),
    setup: {
      tenantId: CONFIG.tenantId,
      examId: CONFIG.examId,
      baseUrl: CONFIG.baseUrl,
      configuredVus: CONFIG.vus,
      configuredDuration: CONFIG.duration,
      note: 'Setup success is recorded in the run log; k6 isolates setup module state from summary execution.',
    },
    requestCount: metrics.http_reqs?.values?.count ?? 0,
    failedRequestRate: metrics.http_req_failed?.values?.rate ?? null,
    durationP95Ms: metrics.http_req_duration?.values?.['p(95)'] ?? null,
    checkPassRate: metrics.checks?.values?.rate ?? null,
    thresholds: THRESHOLDS,
  };
  // Use SUMMARY_FILE so parallel runs cannot overwrite each other's summary in the mounted workspace.
  const summaryFile = readEnv('SUMMARY_FILE', 'summary.json');
  return {
    stdout:
      `\n[summary] setupTenant=${report.setup.tenantId ?? 'unknown'} ` +
      `requests=${report.requestCount} failedRate=${report.failedRequestRate} ` +
      `p95=${report.durationP95Ms}ms checks=${report.checkPassRate}\n`,
    [summaryFile]: JSON.stringify(report, null, 2),
  };
}

export default function (data) {
  runCandidateFlow(data);
  sleep(0.5);
}
