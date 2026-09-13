/**
 * API layer for the profile endpoint.
 *
 * The important part: the transport layer normalises whatever shape the server
 * sends into ONE predictable shape (`ApiValidationError`) so the component never
 * has to care about the wire format. If the backend changes its error envelope,
 * only `parseErrorBody` below changes.
 */

export type ProfileFields = 'name' | 'email' | 'bio';

export interface ProfileValues {
  name: string;
  email: string;
  bio: string;
}

/** field name -> human-readable message. Only fields the server complained about. */
export type FieldErrors = Partial<Record<ProfileFields, string>>;

/** Thrown for 422 (or 400) responses that carry per-field validation messages. */
export class ApiValidationError extends Error {
  readonly fieldErrors: FieldErrors;
  /** Errors that don't belong to any field ("profile is locked", etc.) */
  readonly formErrors: string[];

  constructor(fieldErrors: FieldErrors, formErrors: string[] = []) {
    super('Validation failed');
    this.name = 'ApiValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

/** Everything else: 500s, network failure, timeouts. */
export class ApiRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

const KNOWN_FIELDS: ProfileFields[] = ['name', 'email', 'bio'];

function isKnownField(key: string): key is ProfileFields {
  return (KNOWN_FIELDS as string[]).includes(key);
}

/**
 * Accepts the common server shapes and flattens them.
 *
 * Supported inputs:
 *   { errors: { email: ["is invalid", "is taken"], bio: "too long" } }
 *   { errors: [{ field: "email", message: "is invalid" }] }
 *   { message: "..." }                       -> form-level
 *
 * Unknown field names are NOT silently dropped -- they are promoted to
 * form-level errors so the user still sees them. Dropping them is how people
 * end up with a form that fails with no visible explanation.
 */
export function parseErrorBody(body: unknown): ApiValidationError {
  const fieldErrors: FieldErrors = {};
  const formErrors: string[] = [];

  const record = (body ?? {}) as Record<string, unknown>;
  const raw = record.errors;

  const push = (field: string, message: string) => {
    if (!message) return;
    if (isKnownField(field)) {
      // First message wins; three messages under one input is noise.
      if (!fieldErrors[field]) fieldErrors[field] = message;
    } else {
      formErrors.push(message);
    }
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const e = (entry ?? {}) as Record<string, unknown>;
      const field = String(e.field ?? e.name ?? '');
      const message = String(e.message ?? e.detail ?? '');
      if (field) push(field, message);
      else if (message) formErrors.push(message);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
      const message = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
      push(field, message);
    }
  }

  if (typeof record.message === 'string' && record.message) {
    formErrors.push(record.message);
  }

  if (Object.keys(fieldErrors).length === 0 && formErrors.length === 0) {
    formErrors.push('Your changes could not be saved. Please try again.');
  }

  return new ApiValidationError(fieldErrors, formErrors);
}

export async function saveProfile(
  values: ProfileValues,
  signal?: AbortSignal,
): Promise<ProfileValues> {
  let response: Response;
  try {
    response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
      signal,
    });
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause;
    throw new ApiRequestError("We couldn't reach the server. Check your connection and try again.");
  }

  if (response.status === 422 || response.status === 400) {
    const body = await response.json().catch(() => ({}));
    throw parseErrorBody(body);
  }

  if (!response.ok) {
    throw new ApiRequestError(
      'Something went wrong on our end. Your changes were not saved.',
      response.status,
    );
  }

  return (await response.json()) as ProfileValues;
}
