import { expect, type Download, type Page, type Request } from '@playwright/test';
import type { ApiFailure, ApiMeta, ApiSuccess, UserView } from '@examnexus/shared';

/**
 * Shared browser-E2E API plumbing.
 *
 * Default mode (RUN_E2E_TESTS is not `1`)
 * --------------------------------------
 * Every `/api/v1/**` request is fulfilled by `page.route()` with envelopes that
 * match `apps/backend/src/common/interceptors/response.interceptor.ts` and the
 * `ApiResponse<T>` union consumed by `src/lib/api-client.ts`. No database,
 * Redis or backend process is needed.
 *
 * Opt-in live mode (RUN_E2E_TESTS=1)
 * ----------------------------------
 * `page.route()` is never installed. Credentials come from the environment and
 * assertions are derived from the real API responses observed by the browser:
 *
 *   E2E_ORG_IDENTIFIER / E2E_ORG_EMAIL + E2E_ORG_PASSWORD
 *   E2E_LIMITED_ORG_IDENTIFIER / E2E_LIMITED_ORG_EMAIL + E2E_LIMITED_ORG_PASSWORD
 *   E2E_CANDIDATE_IDENTIFIER / E2E_CANDIDATE_EMAIL + E2E_CANDIDATE_PASSWORD
 *   E2E_ADMIN_IDENTIFIER / E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD
 *
 * `E2E_IDENTIFIER`/`E2E_EMAIL` and `E2E_PASSWORD` are accepted as common
 * fallbacks. Live mode additionally expects seeded data: an available exam
 * whose first question is single-choice, a submitted attempt with a subjective
 * answer, a proctored attempt with one event and one assessment, an active
 * certificate and (for the security mutation check) an open alert. Those
 * expectations are asserted with clear errors rather than silently mocked.
 */
export const LIVE_MODE = process.env.RUN_E2E_TESTS === '1';

/** Mirrors the canonical keys in packages/shared/src/permissions.ts. */
export const E2E_PERMISSIONS = {
  PLATFORM_ORGANISATIONS_READ: 'platform.organisations.read',
  PLATFORM_SECURITY_READ: 'platform.security.read',
  PLATFORM_SECURITY_MANAGE: 'platform.security.manage',
  PLATFORM_REPORTS_READ: 'platform.reports.read',
  PLATFORM_MONITORING_READ: 'platform.monitoring.read',
  ORG_DASHBOARD_READ: 'org.dashboard.read',
  ORG_EXAMINATIONS_READ: 'org.examinations.read',
  ORG_EXAMINATIONS_MANAGE: 'org.examinations.manage',
  ORG_EVALUATION_READ: 'org.evaluation.read',
  ORG_EVALUATION_MANAGE: 'org.evaluation.manage',
  ORG_PROCTORING_READ: 'org.proctoring.read',
  ORG_REPORTS_READ: 'org.reports.read',
  ORG_CERTIFICATES_MANAGE: 'org.certificates.manage',
} as const;

export const MOCK_ACCESS_TOKEN = 'e2e-access-token';

const FIXED_META: ApiMeta = {
  requestId: 'e2e-fixed-request-id',
  timestamp: '2026-01-01T00:00:00.000Z',
};

let requestSequence = 0;

/** Exact shape produced by ResponseInterceptor for successful requests. */
export function apiSuccess<T>(data: T, meta: Partial<ApiMeta> = {}): ApiSuccess<T> {
  requestSequence += 1;
  return {
    success: true,
    data: (data ?? null) as T,
    meta: { ...FIXED_META, requestId: `e2e-request-${requestSequence}`, ...meta },
  };
}

/** Exact shape produced by the global exception filter for failed requests. */
export function apiFailure(code: string, message: string, details?: unknown): ApiFailure {
  requestSequence += 1;
  return {
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    meta: { ...FIXED_META, requestId: `e2e-request-${requestSequence}` },
  };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiResult {
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export function ok<T>(data: T, meta?: Partial<ApiMeta>): ApiResult {
  return { status: 200, body: apiSuccess(data, meta) };
}

export function fail(status: number, code: string, message: string, details?: unknown): ApiResult {
  return { status, body: apiFailure(code, message, details) };
}

/** Non-JSON bodies (CSV/PDF) still travel through apiDownload's fetch path. */
export function file(body: string, contentType: string, fileName?: string): ApiResult {
  return {
    status: 200,
    contentType,
    body,
    headers: fileName ? { 'Content-Disposition': `attachment; filename="${fileName}"` } : undefined,
  };
}

export interface ApiRouteContext {
  path: string;
  url: URL;
  method: HttpMethod;
  body: unknown;
}

export interface MockApiRoute {
  method: HttpMethod;
  path: string;
  handler: (context: ApiRouteContext) => ApiResult | Promise<ApiResult>;
}

export function route(
  method: HttpMethod,
  path: string,
  handler: MockApiRoute['handler'],
): MockApiRoute {
  return { method, path, handler };
}

export interface MockApiOptions {
  /** Returned by `/auth/me`; omit or pass null to simulate an anonymous browser. */
  user?: UserView | null;
  routes?: MockApiRoute[];
}

function apiPath(url: URL): string {
  return url.pathname.replace(/^\/api\/v1/, '') || '/';
}

function parseBody(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Installs the offline API stub. In live mode this is deliberately a no-op:
 * real credentials and real responses are used instead.
 */
export async function setupApi(page: Page, options: MockApiOptions = {}): Promise<void> {
  if (LIVE_MODE) return;

  await page.route('**/api/v1/**', async (playwrightRoute) => {
    const request = playwrightRoute.request();
    const url = new URL(request.url());
    const path = apiPath(url);
    const method = request.method() as HttpMethod;
    const context: ApiRouteContext = {
      path,
      url,
      method,
      body: parseBody(request.postData()),
    };

    let result: ApiResult;
    if (path === '/auth/me' && method === 'GET') {
      result = options.user
        ? ok(options.user)
        : fail(401, 'UNAUTHENTICATED', 'Authentication required');
    } else if (path === '/auth/refresh' && method === 'POST') {
      result = options.user
        ? ok({ status: 'AUTHENTICATED', accessToken: MOCK_ACCESS_TOKEN, expiresIn: 3600, user: options.user })
        : fail(401, 'UNAUTHENTICATED', 'Session expired');
    } else if ((path === '/auth/login' || path === '/auth/pin') && method === 'POST') {
      const user = options.user ?? anonymousFallbackUser();
      result = ok({ status: 'AUTHENTICATED', accessToken: MOCK_ACCESS_TOKEN, expiresIn: 3600, user });
    } else if (path === '/auth/logout' && method === 'POST') {
      result = ok(null);
    } else {
      const match = (options.routes ?? []).find((candidate) => candidate.method === method && candidate.path === path);
      result = match
        ? await match.handler(context)
        : fail(404, 'NOT_FOUND', `No E2E mock registered for ${method} ${path}`);
    }

    const isJson = (result.contentType ?? 'application/json').includes('json');
    await playwrightRoute.fulfill({
      status: result.status ?? 200,
      contentType: result.contentType ?? 'application/json',
      headers: result.headers,
      body: isJson ? JSON.stringify(result.body ?? null) : String(result.body ?? ''),
    });
  });
}

function anonymousFallbackUser(): UserView {
  return {
    id: 'user-e2e-fallback',
    email: 'fallback-e2e@example.test',
    username: null,
    status: 'ACTIVE',
    globalRole: null,
    tenantId: 'tenant-e2e',
    tenantRoles: ['ORG_ADMIN'],
    permissions: [E2E_PERMISSIONS.ORG_DASHBOARD_READ],
    mfaEnabled: false,
    profile: { firstName: 'E2E', lastName: 'Fallback' },
  };
}

export type Persona = 'org' | 'limitedOrg' | 'candidate' | 'admin';

const OFFLINE_CREDENTIALS: Record<Persona, { identifier: string; secret: string }> = {
  org: { identifier: 'org-e2e@example.test', secret: 'offline-org-password-123' },
  limitedOrg: { identifier: 'limited-e2e@example.test', secret: 'offline-limited-password-123' },
  candidate: { identifier: 'candidate-e2e@example.test', secret: 'offline-candidate-password-123' },
  admin: { identifier: 'admin-e2e@example.test', secret: 'offline-admin-password-123' },
};

const ENV_PREFIX: Record<Persona, string> = {
  org: 'E2E_ORG',
  limitedOrg: 'E2E_LIMITED_ORG',
  candidate: 'E2E_CANDIDATE',
  admin: 'E2E_ADMIN',
};

function env(prefix: string, suffixes: string[]): string | undefined {
  for (const suffix of suffixes) {
    const value = process.env[`${prefix}_${suffix}`];
    if (value) return value;
  }
  return undefined;
}

/** Returns offline fixtures by default; real env credentials in live mode. */
export function credentialsFor(persona: Persona): { identifier: string; secret: string } {
  if (!LIVE_MODE) return OFFLINE_CREDENTIALS[persona];

  const prefix = ENV_PREFIX[persona];
  const identifier =
    env(prefix, ['IDENTIFIER', 'EMAIL', 'USERNAME']) ??
    env('E2E', ['IDENTIFIER', 'EMAIL', 'USERNAME']);
  const secret = env(prefix, ['PASSWORD']) ?? env('E2E', ['PASSWORD']);

  if (!identifier || !secret) {
    throw new Error(
      `RUN_E2E_TESTS=1 requires ${prefix}_IDENTIFIER (or ${prefix}_EMAIL) and ${prefix}_PASSWORD ` +
        '— or the common E2E_IDENTIFIER/E2E_PASSWORD fallbacks.',
    );
  }
  return { identifier, secret };
}

/** Signs in through the real login form in both modes. */
export async function signIn(page: Page, persona: Persona, expectedUrl?: string | RegExp): Promise<void> {
  const credentials = credentialsFor(persona);
  await page.goto('/login');
  await page.locator('#identifier').fill(credentials.identifier);
  await page.locator('#secret').fill(credentials.secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectedUrl) {
    await expect(page).toHaveURL(expectedUrl);
  } else {
    await expect(page).not.toHaveURL(/\/login$/);
  }
}

/** In live mode a fresh browser has no session, so sign in before navigating. */
export async function openProtected(page: Page, path: string, persona: Persona): Promise<void> {
  if (LIVE_MODE) await signIn(page, persona);
  await page.goto(path);
}

type PathMatcher = string | ((path: string) => boolean);

function matchesPath(rawUrl: string, matcher: PathMatcher): boolean {
  const url = new URL(rawUrl);
  if (!url.pathname.startsWith('/api/v1')) return false;
  const path = apiPath(url);
  return typeof matcher === 'string' ? path === matcher : matcher(path);
}

/** Awaits a successful API response without installing any route handler. */
export function waitForApiResponse<T>(
  page: Page,
  method: HttpMethod,
  matcher: PathMatcher,
): Promise<T> {
  return page
    .waitForResponse((response) => response.request().method() === method && matchesPath(response.url(), matcher))
    .then(async (response) => {
      const body = (await response.json()) as ApiSuccess<T> | ApiFailure;
      if (!body.success) {
        throw new Error(`Expected successful ${method} response matching ${String(matcher)}: ${body.error.message}`);
      }
      return body.data;
    });
}

/** Registers the response waiter before running the UI action that triggers it. */
export async function captureApiResponse<T>(
  page: Page,
  method: HttpMethod,
  matcher: PathMatcher,
  action: () => Promise<unknown>,
): Promise<T> {
  const responsePromise = waitForApiResponse<T>(page, method, matcher);
  await action();
  return responsePromise;
}

export function waitForApiRequest(page: Page, method: HttpMethod, path: string): Promise<Request> {
  return page.waitForRequest(
    (request) => request.method() === method && matchesPath(request.url(), path),
  );
}

export async function captureDownload(page: Page, action: () => Promise<unknown>): Promise<Download> {
  const downloadPromise = page.waitForEvent('download');
  await action();
  return downloadPromise;
}

/** Makes live-mode prerequisites explicit instead of silently skipping checks. */
export function requireLiveFixture(condition: unknown, message: string): void {
  if (LIVE_MODE && !condition) {
    throw new Error(`RUN_E2E_TESTS=1 live fixture prerequisite missing: ${message}`);
  }
}
