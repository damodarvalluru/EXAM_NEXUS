#!/usr/bin/env node
/**
 * ExamNexus production-verification smoke checks (Node 20+, no dependencies).
 *
 * Usage:
 *   node tests/security/smoke-checks.mjs
 *   REPORT_FILE=evidence/phase-08/smoke-checks.json node tests/security/smoke-checks.mjs
 *
 * Optional env: BASE_URL (default http://localhost:3000), TIMEOUT_MS (default 8000).
 * Exits 1 on any FAIL, on a connection error, or if the report file cannot be written.
 * This is a reachability/configuration check, NOT a penetration test.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number.parseInt(process.env.TIMEOUT_MS || '8000', 10);
const REPORT_FILE = process.env.REPORT_FILE || '';

// Phase 7/8 module names are accepted as an alternative to a numeric phase >= 7
// if the modules endpoint is extended with names instead of phase numbers.
const EXPECTED_MODULE_NAMES = [
  'ai-evaluation',
  'ai-evaluator',
  'proctoring',
  'advanced-reporting',
  'reporting',
  'certificates',
  'load-testing',
  'penetration-testing',
  'disaster-recovery-tools',
  'independent-review',
];

const results = [];
let connectionLost = false;

function isConnectionError(error) {
  const code = error?.cause?.code || error?.code || '';
  return (
    error?.name === 'TimeoutError' ||
    ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ERR_NETWORK', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) ||
    /fetch failed|timeout|network/i.test(error?.message || '')
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function request(method, path, { body, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Number.isFinite(TIMEOUT_MS) ? TIMEOUT_MS : 8000),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    // Non-JSON responses are valid for /docs; keep the raw text.
  }
  return { status: response.status, body: parsed };
}

function unwrap(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  return body;
}

function addResult({ id, name, method, path, pass, httpStatus = null, detail = null, error = null }) {
  results.push({
    id,
    name,
    method,
    path,
    status: pass ? 'PASS' : 'FAIL',
    httpStatus,
    detail,
    ...(error ? { error } : {}),
    checkedAt: new Date().toISOString(),
  });
}

async function runCheck(check, fn) {
  if (connectionLost) {
    addResult({
      ...check,
      pass: false,
      detail: 'Not executed: API connection was lost during an earlier check.',
    });
    return;
  }
  try {
    addResult({ ...check, ...(await fn()) });
  } catch (error) {
    if (isConnectionError(error)) connectionLost = true;
    addResult({
      ...check,
      pass: false,
      detail: connectionLost ? 'Connection error; check could not complete.' : 'Unexpected error.',
      error: errorMessage(error),
    });
  }
}

function buildReport(status) {
  const pass = results.filter((result) => result.status === 'PASS').length;
  return {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    status, // 'pass' | 'fail' | 'connection_error'
    summary: { total: results.length, pass, fail: results.length - pass },
    checks: results,
  };
}

async function emit(report) {
  if (REPORT_FILE) {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    try {
      const target = resolve(REPORT_FILE);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, json, 'utf8');
    } catch (error) {
      process.stderr.write(`Failed to write REPORT_FILE: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(`ExamNexus security smoke checks — ${BASE_URL}\n`);
  for (const check of report.checks) {
    const status = check.httpStatus === null ? 'n/a' : `HTTP ${check.httpStatus}`;
    const extra = check.error ? ` error=${check.error}` : check.detail ? ` ${JSON.stringify(check.detail)}` : '';
    process.stdout.write(`${check.status} ${check.id} ${check.method} ${check.path} (${status})${extra}\n`);
  }
  process.stdout.write(
    `Summary: ${report.summary.pass}/${report.summary.total} passed; overall=${report.status}\n`,
  );
}

// Preflight: if the API is unreachable, do not report any check as having run.
let live;
try {
  live = await request('GET', '/health/live');
} catch (error) {
  addResult({
    id: 'connection',
    name: 'API reachable',
    method: 'GET',
    path: '/health/live',
    pass: false,
    detail: 'Connection error; no checks were executed.',
    error: errorMessage(error),
  });
  const report = buildReport('connection_error');
  await emit(report);
  process.exitCode = 1;
  process.exit(process.exitCode);
}

await runCheck(
  {
    id: 'health-live',
    name: 'Liveness endpoint returns 200',
    method: 'GET',
    path: '/health/live',
  },
  async () => ({
    pass: live.status === 200,
    httpStatus: live.status,
    detail: { expected: 200 },
  }),
);

await runCheck(
  {
    id: 'modules-phase-7-8',
    name: 'Modules endpoint lists Phase 7/8 modules',
    method: 'GET',
    path: '/api/v1/modules',
  },
  async () => {
    const response = await request('GET', '/api/v1/modules');
    const list = unwrap(response.body);
    const entries = Array.isArray(list) ? list : [];
    const byPhase = entries.filter((entry) => Number(entry?.phase) >= 7).map((entry) => entry?.module ?? entry?.name);
    const byName = entries
      .filter((entry) => EXPECTED_MODULE_NAMES.includes(String(entry?.module ?? entry?.name ?? '').toLowerCase()))
      .map((entry) => entry?.module ?? entry?.name);
    return {
      pass: Array.isArray(list) && (byPhase.length > 0 || byName.length > 0),
      httpStatus: response.status,
      detail: { arrayPayload: Array.isArray(list), matchedByPhase: byPhase, matchedByName: byName },
    };
  },
);

async function expectUnauthorized(name, method, path, body) {
  return runCheck(
    { id: `unauth-${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`, name, method, path },
    async () => {
      const response = await request(method, path, body === undefined ? {} : { body });
      const code = response.body && typeof response.body === 'object' ? response.body.error?.code : null;
      return {
        pass: response.status === 401,
        httpStatus: response.status,
        detail: { expected: 401, errorCode: code ?? null },
      };
    },
  );
}

await expectUnauthorized('Admin overview requires authentication', 'GET', '/api/v1/admin/overview');
await expectUnauthorized('Examination list requires authentication', 'GET', '/api/v1/examinations');
await expectUnauthorized(
  'Candidate ingest requires API credentials',
  'POST',
  '/api/v1/integrations/ingest/candidates',
  {},
);

await runCheck(
  {
    id: 'docs-reachable',
    name: 'Swagger UI responds without a server error',
    method: 'GET',
    path: '/docs',
  },
  async () => {
    const response = await request('GET', '/docs');
    return {
      pass: response.status < 500,
      httpStatus: response.status,
      detail: { expected: 'status < 500' },
    };
  },
);

const report = buildReport(connectionLost ? 'connection_error' : results.every((r) => r.status === 'PASS') ? 'pass' : 'fail');
await emit(report);
process.exitCode = report.status === 'pass' && process.exitCode !== 1 ? 0 : 1;
