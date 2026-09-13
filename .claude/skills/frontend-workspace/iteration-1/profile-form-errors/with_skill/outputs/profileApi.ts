/**
 * Transport + error normalisation for the profile endpoint.
 *
 * Everything above this file works with ONE error shape. If the API changes how
 * it reports validation failures, this is the only file that changes.
 */

export type ProfileField = 'name' | 'email' | 'bio';

export const PROFILE_FIELDS: ProfileField[] = ['name', 'email', 'bio'];

export interface Profile {
  name: string;
  email: string;
  bio: string;
}

export type FieldErrors = Partial<Record<ProfileField, string>>;

/**
 * Raised for a 422. `fieldErrors` are messages we can attach to an input;
 * `formErrors` are messages the API sent for fields this form does not render
 * (or for the record as a whole) — they must still be shown, not swallowed.
 */
export class ProfileValidationError extends Error {
  readonly fieldErrors: FieldErrors;
  readonly formErrors: string[];

  constructor(fieldErrors: FieldErrors, formErrors: string[] = []) {
    super('Profile validation failed');
    this.name = 'ProfileValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

function isProfileField(value: unknown): value is ProfileField {
  return typeof value === 'string' && (PROFILE_FIELDS as string[]).includes(value);
}

/**
 * Accepts the two shapes this API has been seen to return:
 *   { errors: { email: ["is already taken"], bio: "too long" } }
 *   { errors: [{ field: "email", message: "is already taken" }] }
 * Anything unrecognisable becomes a form-level message rather than disappearing.
 */
export function normaliseValidationErrors(body: unknown): ProfileValidationError {
  const fieldErrors: FieldErrors = {};
  const formErrors: string[] = [];

  const push = (field: unknown, message: unknown) => {
    const text = Array.isArray(message) ? String(message[0]) : String(message);
    if (!text || text === 'undefined') return;
    if (isProfileField(field)) {
      // First message per field wins: showing a stack of messages under one
      // input is noise, and the API orders them by severity.
      if (!fieldErrors[field]) fieldErrors[field] = text;
    } else {
      formErrors.push(field ? `${String(field)}: ${text}` : text);
    }
  };

  const errors = (body as { errors?: unknown } | null)?.errors;

  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const e = entry as { field?: unknown; message?: unknown; detail?: unknown };
      push(e?.field, e?.message ?? e?.detail ?? entry);
    }
  } else if (errors && typeof errors === 'object') {
    for (const [field, message] of Object.entries(errors as Record<string, unknown>)) {
      push(field, message);
    }
  }

  if (Object.keys(fieldErrors).length === 0 && formErrors.length === 0) {
    formErrors.push('The server rejected these changes but did not say why.');
  }

  return new ProfileValidationError(fieldErrors, formErrors);
}

export async function saveProfile(
  profile: Profile,
  options: { signal?: AbortSignal } = {},
): Promise<Profile> {
  const response = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
    signal: options.signal,
  });

  if (response.status === 422 || response.status === 400) {
    throw normaliseValidationErrors(await response.json().catch(() => null));
  }

  if (!response.ok) {
    throw new Error(`Could not save your profile (${response.status}).`);
  }

  return (await response.json()) as Profile;
}
