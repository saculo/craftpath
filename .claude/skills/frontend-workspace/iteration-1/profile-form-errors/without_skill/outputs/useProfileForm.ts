import { useCallback, useRef, useState } from 'react';
import {
  ApiRequestError,
  ApiValidationError,
  FieldErrors,
  ProfileFields,
  ProfileValues,
  saveProfile,
} from './api';

export type SubmitStatus = 'idle' | 'submitting' | 'saved' | 'error';

interface UseProfileFormOptions {
  initialValues: ProfileValues;
  onSaved?: (values: ProfileValues) => void;
  /** Injected for tests; defaults to the real API call. */
  submit?: (values: ProfileValues, signal?: AbortSignal) => Promise<ProfileValues>;
}

/**
 * Owns the form state.
 *
 * The single rule that fixes the "people lose everything they typed" bug:
 * VALUES AND ERRORS ARE SEPARATE STATE, and a failed submit only ever touches
 * the errors. Nothing in this hook resets, remounts, or re-seeds `values` from
 * a server response on failure.
 */
export function useProfileForm({ initialValues, onSaved, submit = saveProfile }: UseProfileFormOptions) {
  const [values, setValues] = useState<ProfileValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<SubmitStatus>('idle');

  // Guards against an in-flight request finishing after a newer one and
  // stomping fresh errors with stale ones.
  const requestId = useRef(0);

  const setField = useCallback((field: ProfileFields, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Editing a field clears its error: the message was about the old value and
    // keeping it makes the form feel broken while you fix it.
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setStatus((prev) => (prev === 'saved' ? 'idle' : prev));
  }, []);

  const handleSubmit = useCallback(async () => {
    const id = ++requestId.current;
    setStatus('submitting');
    setFormErrors([]);

    try {
      const saved = await submit(values);
      if (id !== requestId.current) return;
      setFieldErrors({});
      setFormErrors([]);
      setStatus('saved');
      onSaved?.(saved);
    } catch (error) {
      if (id !== requestId.current) return;
      if ((error as Error)?.name === 'AbortError') return;

      if (error instanceof ApiValidationError) {
        // Replace, don't merge: errors the server no longer reports are fixed.
        setFieldErrors(error.fieldErrors);
        setFormErrors(error.formErrors);
      } else if (error instanceof ApiRequestError) {
        setFieldErrors({});
        setFormErrors([error.message]);
      } else {
        setFieldErrors({});
        setFormErrors(['Something went wrong. Your changes were not saved.']);
      }
      setStatus('error');
      // `values` is deliberately untouched here.
    }
  }, [values, submit, onSaved]);

  const reset = useCallback(
    (next: ProfileValues = initialValues) => {
      setValues(next);
      setFieldErrors({});
      setFormErrors([]);
      setStatus('idle');
    },
    [initialValues],
  );

  return {
    values,
    fieldErrors,
    formErrors,
    status,
    isSubmitting: status === 'submitting',
    setField,
    handleSubmit,
    reset,
  };
}
