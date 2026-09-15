/**
 * API layer for the settings resource.
 *
 * The important idea here: the network layer never throws a bare `Error` with a
 * stringly-typed message. It throws a typed `ApiError` whose `kind` the UI can
 * branch on, so the page can say something different for "our server broke" vs
 * "you're offline" vs "you don't have access".
 */

export type ApiErrorKind =
  | 'network' // request never reached the server (offline, DNS, CORS)
  | 'timeout' // request took too long
  | 'server' // 5xx — our fault
  | 'unauthorized' // 401 — session expired
  | 'forbidden' // 403 — logged in, not allowed
  | 'notFound' // 404
  | 'client' // other 4xx
  | 'parse' // 2xx but the body wasn't the shape we expected
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** Correlation id from the server, if it sent one. Worth showing to users. */
  readonly requestId?: string;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.requestId = options.requestId;
  }

  /** Retrying a 403 will never help. Retrying a 500 might. */
  get isRetryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'server' ||
      this.kind === 'unknown'
    );
  }
}

export interface Settings {
  displayName: string;
  email: string;
  timezone: string;
  emailNotifications: boolean;
  marketingEmails: boolean;
}

function statusToKind(status: number): ApiErrorKind {
  if (status >= 500) return 'server';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status >= 400) return 'client';
  return 'unknown';
}

function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.displayName === 'string' &&
    typeof v.email === 'string' &&
    typeof v.timezone === 'string' &&
    typeof v.emailNotifications === 'boolean' &&
    typeof v.marketingEmails === 'boolean'
  );
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  // Combine the caller's abort signal (unmount / retry supersede) with a timeout,
  // so a hung request surfaces as an error instead of an infinite spinner.
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch('/api/settings', {
      signal: combined,
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    // A caller-initiated abort is not an error condition — let it propagate so
    // the hook can ignore it rather than rendering an error for a cancelled load.
    if (signal?.aborted) throw cause;
    if (timeoutSignal.aborted) {
      throw new ApiError('timeout', 'The request took too long.', { cause });
    }
    throw new ApiError('network', 'Could not reach the server.', { cause });
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (!response.ok) {
    throw new ApiError(
      statusToKind(response.status),
      `Request failed with status ${response.status}.`,
      { status: response.status, requestId },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiError('parse', 'The server sent a malformed response.', {
      status: response.status,
      requestId,
      cause,
    });
  }

  if (!isSettings(body)) {
    throw new ApiError('parse', 'The server sent an unexpected response.', {
      status: response.status,
      requestId,
    });
  }

  return body;
}
