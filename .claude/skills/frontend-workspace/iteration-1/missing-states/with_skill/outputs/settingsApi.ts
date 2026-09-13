/**
 * Transport layer for the settings screen.
 *
 * The only job here is to turn everything that can go wrong into one typed
 * error shape, so the UI never has to sniff at `err.message` strings or a raw
 * Response to decide what to tell the user.
 */

export interface ConnectedAccount {
  id: string;
  provider: string;
  label: string;
}

export interface Settings {
  displayName: string;
  email: string;
  timezone: string;
  marketingEmails: boolean;
  connectedAccounts: ConnectedAccount[];
}

export type LoadErrorKind =
  /** 5xx — our fault, retrying is reasonable. */
  | 'server'
  /** Request never completed: offline, DNS, CORS, TLS. */
  | 'network'
  /** 401/403 — retrying the same request will not help. */
  | 'auth'
  /** Other 4xx — bad request, not found. */
  | 'client';

export class LoadError extends Error {
  readonly kind: LoadErrorKind;
  readonly status?: number;

  constructor(kind: LoadErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LoadError';
    this.kind = kind;
    this.status = status;
  }
}

/** True for the abort we caused ourselves — never surfaced to the user. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export async function fetchSettings(signal: AbortSignal): Promise<Settings> {
  let response: Response;

  try {
    response = await fetch('/api/settings', {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new LoadError('network', 'Request did not reach the server.');
  }

  if (!response.ok) {
    const kind: LoadErrorKind =
      response.status >= 500
        ? 'server'
        : response.status === 401 || response.status === 403
          ? 'auth'
          : 'client';
    throw new LoadError(kind, `Settings request failed (${response.status}).`, response.status);
  }

  try {
    return (await response.json()) as Settings;
  } catch {
    // A 200 with an unparseable body is still a broken server response.
    throw new LoadError('server', 'Settings response could not be read.', response.status);
  }
}

export async function saveSettings(
  patch: Partial<Settings>,
  signal: AbortSignal,
): Promise<Settings> {
  let response: Response;

  try {
    response = await fetch('/api/settings', {
      method: 'PATCH',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new LoadError('network', 'Request did not reach the server.');
  }

  if (!response.ok) {
    const kind: LoadErrorKind =
      response.status >= 500
        ? 'server'
        : response.status === 401 || response.status === 403
          ? 'auth'
          : 'client';
    throw new LoadError(kind, `Saving settings failed (${response.status}).`, response.status);
  }

  return (await response.json()) as Settings;
}
