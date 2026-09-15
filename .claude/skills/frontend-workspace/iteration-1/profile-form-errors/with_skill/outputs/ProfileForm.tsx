import { FormEvent, useEffect, useRef } from 'react';
import { FieldErrors, Profile, ProfileField, saveProfile } from './profileApi';
import { SubmitStatus, firstErroredField, useProfileForm } from './useProfileForm';

interface FieldProps {
  id: ProfileField;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}

function Field({ id, label, value, error, hint, multiline, onChange }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const shared = {
    id,
    name: id,
    value,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy || undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {multiline ? <textarea rows={5} {...shared} /> : <input type="text" {...shared} />}
      {/*
        Not announced on its own: the error summary is the live region, and two
        announcements for one failure talk over each other. The icon plus the
        word "Error" means colour is not carrying the state by itself.
      */}
      {error ? (
        <p className="field__error" id={errorId}>
          <span aria-hidden="true">⚠ </span>
          <strong>Error:</strong> {error}
        </p>
      ) : null}
    </div>
  );
}

interface ErrorSummaryProps {
  fieldErrors: FieldErrors;
  formErrors: string[];
  labels: Record<ProfileField, string>;
}

function ErrorSummary({ fieldErrors, formErrors, labels }: ErrorSummaryProps) {
  const fieldEntries = (Object.keys(fieldErrors) as ProfileField[]).filter((f) => fieldErrors[f]);
  if (fieldEntries.length === 0 && formErrors.length === 0) return null;

  return (
    <div className="form__summary" role="alert">
      <h3>We could not save your profile</h3>
      <ul>
        {fieldEntries.map((field) => (
          <li key={field}>
            <a href={`#${field}`}>
              {labels[field]}: {fieldErrors[field]}
            </a>
          </li>
        ))}
        {formErrors.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      <p>Nothing you typed has been lost — correct the fields above and save again.</p>
    </div>
  );
}

export interface ProfileFormViewProps {
  values: Profile;
  fieldErrors: FieldErrors;
  formErrors: string[];
  status: SubmitStatus;
  failureToken: number;
  onFieldChange: (field: ProfileField, value: string) => void;
  onSubmit: () => void;
}

const LABELS: Record<ProfileField, string> = {
  name: 'Name',
  email: 'Email',
  bio: 'Bio',
};

/**
 * Renders what it is given and reports events upward. It holds no draft state,
 * which is what makes "the user never loses their typing" testable in isolation.
 */
export function ProfileFormView({
  values,
  fieldErrors,
  formErrors,
  status,
  failureToken,
  onFieldChange,
  onSubmit,
}: ProfileFormViewProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = status === 'submitting';

  // Move focus to the first problem ONCE per failed submit. Keying the effect on
  // failureToken (not on fieldErrors) means a later re-render — or the user
  // tabbing away and typing — never yanks the caret back.
  useEffect(() => {
    if (failureToken === 0) return;
    const target = firstErroredField(fieldErrors) ?? null;
    const node = target
      ? formRef.current?.querySelector<HTMLElement>(`#${target}`)
      : formRef.current?.querySelector<HTMLElement>('[role="alert"] a, [role="alert"]');
    node?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureToken]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <h2>Edit profile</h2>

      <ErrorSummary fieldErrors={fieldErrors} formErrors={formErrors} labels={LABELS} />

      <Field
        id="name"
        label={LABELS.name}
        value={values.name}
        error={fieldErrors.name}
        onChange={(v) => onFieldChange('name', v)}
      />
      <Field
        id="email"
        label={LABELS.email}
        value={values.email}
        error={fieldErrors.email}
        onChange={(v) => onFieldChange('email', v)}
      />
      <Field
        id="bio"
        label={LABELS.bio}
        value={values.bio}
        error={fieldErrors.bio}
        hint="A short description shown on your public page."
        multiline
        onChange={(v) => onFieldChange('bio', v)}
      />

      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save changes'}
      </button>

      {/*
        Reserved space: the status line occupies a row whether or not it has
        text, so the button does not jump when the result arrives.
      */}
      <p className="form__status" role="status" style={{ minHeight: '1.5rem' }}>
        {status === 'saved' ? 'Profile saved.' : ''}
        {submitting ? 'Saving your profile…' : ''}
      </p>
    </form>
  );
}

export interface ProfileFormProps {
  initialProfile: Profile;
  save?: (profile: Profile) => Promise<Profile>;
  onSaved?: (profile: Profile) => void;
}

/** Owns the data and the decisions; delegates all rendering. */
export function ProfileForm({ initialProfile, save = saveProfile, onSaved }: ProfileFormProps) {
  const { values, fieldErrors, formErrors, status, failureToken, setField, submit } =
    useProfileForm({ initialProfile, save, onSaved });

  return (
    <ProfileFormView
      values={values}
      fieldErrors={fieldErrors}
      formErrors={formErrors}
      status={status}
      failureToken={failureToken}
      onFieldChange={setField}
      onSubmit={submit}
    />
  );
}
