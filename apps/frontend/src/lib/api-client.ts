import type { ApiResponse, AuthenticatedResult } from '@examnexus/shared';

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:3000';
const API_BASE = `${API_ORIGIN}/api/v1`;

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

type AuthListener = () => void;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener());
}

export function subscribeAccessToken(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Health endpoints live outside the versioned prefix. */
  raw?: boolean;
  /** Do not attempt to refresh the session on a 401 response. */
  skipRefresh?: boolean;
  headers?: Record<string, string>;
}

interface BodyOptions extends RequestOptions {
  body?: unknown;
}

async function readBody<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('Server returned an invalid response', response.status, 'INVALID_RESPONSE');
  }
}

function failureFrom<T>(response: Response, body: ApiResponse<T>): ApiError {
  if (body.success) {
    return new ApiError('Request failed', response.status, 'REQUEST_FAILED', body.meta?.requestId);
  }
  return new ApiError(
    body.error.message ?? `Request failed with status ${response.status}`,
    response.status,
    body.error.code ?? 'REQUEST_FAILED',
    body.meta?.requestId,
    body.error.details,
  );
}

async function performRequest<T>(method: string, path: string, options: BodyOptions): Promise<{ response: Response; body: ApiResponse<T> }> {
  const url = options.raw ? `${API_ORIGIN}${path}` : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body = await readBody<T>(response);
  return { response, body };
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        // Send the current token so a step-up claim can be carried forward.
        // The server verifies its signature even when the token has expired.
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const body = (await response.json()) as ApiResponse<AuthenticatedResult>;
      if (!response.ok || !body.success) {
        setAccessToken(null);
        return false;
      }
      setAccessToken(body.data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(method: string, path: string, options: BodyOptions = {}): Promise<T> {
  const first = await performRequest<T>(method, path, options);
  if (first.response.ok && first.body.success) return first.body.data;

  const error = failureFrom(first.response, first.body);
  const canRefresh =
    !options.skipRefresh &&
    first.response.status === 401 &&
    error.code === 'UNAUTHENTICATED' &&
    !path.startsWith('/auth/refresh');

  if (canRefresh && (await refreshSession())) {
    const second = await performRequest<T>(method, path, options);
    if (second.response.ok && second.body.success) return second.body.data;
    throw failureFrom(second.response, second.body);
  }

  if (error.code === 'UNAUTHENTICATED' && !options.skipRefresh) setAccessToken(null);
  throw error;
}

export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, options);
}

export function apiPost<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, { ...options, body });
}

export function apiPatch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PATCH', path, { ...options, body });
}

export function apiPut<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PUT', path, { ...options, body });
}

export function apiDelete<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('DELETE', path, options);
}

export async function apiDownload(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!response.ok) {
    const body = await readBody<unknown>(response).catch(() => null);
    throw failureFrom(response, (body ?? { success: false, error: { code: 'DOWNLOAD_FAILED', message: 'Download failed' } }) as ApiResponse<unknown>);
  }
  return response.blob();
}

/** Login-like calls must not trigger a refresh loop; they own the token result. */
export const publicPost = <T>(path: string, body?: unknown): Promise<T> =>
  apiPost<T>(path, body, { skipRefresh: true });
