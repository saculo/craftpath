import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FieldErrors,
  PROFILE_FIELDS,
  Profile,
  ProfileField,
  ProfileValidationError,
  saveProfile as defaultSaveProfile,
} from './profileApi';

export type SubmitStatus = 'idle' | 'submitting' | 'saved' | 'failed';

interface UseProfileFormOptions {
  initialProfile: Profile;
  save?: (profile: Profile) => Promise<Profile>;
  onSaved?: (profile: Profile) => void;
}

export interface ProfileFormState {
  values: Profile;
  fieldErrors: FieldErrors;
  formErrors: string[];
  status: SubmitStatus;
  /** Increments on every failed submit; the view uses it to move focus exactly once. */
  failureToken: number;
  setField: (field: ProfileField, value: string) => void;
  submit: () => Promise<void>;
}

const EMPTY_ERRORS: FieldErrors = {};

/**
 * Owns the draft and the outcome of submitting it.
 *
 * The single rule this hook exists to enforce: `values` is seeded once and is
 * only ever changed by the user typing. No code path — success, 422, network
 * failure, a parent re-render — writes over what the user typed. That is why
 * `initialProfile` is captured in a ref instead of being read on every render.
 */
export function useProfileForm({
  initialProfile,
  save = defaultSaveProfile,
  onSaved,
}: UseProfileFormOptions): ProfileFormState {
  const seed = useRef(initialProfile);
  const [values, setValues] = useState<Profile>(seed.current);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [failureToken, setFailureToken] = useState(0);

  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Guards against a late response writing into an unmounted form.
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const setField = useCallback((field: ProfileField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Refine as the user corrects: the message for this field stops being true
    // the moment they change it. Other fields keep their messages.
    setFieldErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
    setStatus((current) => (current === 'saved' ? 'idle' : current));
  }, []);

  const submit = useCallback(async () => {
    // Belt and braces: the button is disabled while in flight, but a keyboard
    // Enter repeat or a synthetic event should not produce two writes either.
    if (inFlight.current) return;
    inFlight.current = true;

    setStatus('submitting');
    setFieldErrors(EMPTY_ERRORS);
    setFormErrors([]);

    try {
      const saved = await save(values);
      if (!mounted.current) return;
      setStatus('saved');
      onSaved?.(saved);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ProfileValidationError) {
        setFieldErrors(error.fieldErrors);
        setFormErrors(error.formErrors);
      } else {
        setFormErrors([
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong. Your changes are still here — try again.',
        ]);
      }
      setStatus('failed');
      setFailureToken((n) => n + 1);
    } finally {
      inFlight.current = false;
    }
  }, [save, values, onSaved]);

  return { values, fieldErrors, formErrors, status, failureToken, setField, submit };
}

export function firstErroredField(fieldErrors: FieldErrors): ProfileField | undefined {
  return PROFILE_FIELDS.find((field) => Boolean(fieldErrors[field]));
}
