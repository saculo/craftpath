import { FormEvent, useEffect, useRef } from 'react';
import { ProfileFields, ProfileValues, saveProfile } from './api';
import { useProfileForm } from './useProfileForm';

const BIO_MAX = 500;

interface ProfileFormProps {
  initialValues: ProfileValues;
  onSaved?: (values: ProfileValues) => void;
  submit?: (values: ProfileValues, signal?: AbortSignal) => Promise<ProfileValues>;
}

export function ProfileForm({ initialValues, onSaved, submit = saveProfile }: ProfileFormProps) {
  const { values, fieldErrors, formErrors, status, isSubmitting, setField, handleSubmit } =
    useProfileForm({ initialValues, onSaved, submit });

  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // After a failed submit, move the user to the first thing that needs fixing.
  // Without this, on a long form the errors can be off-screen and the submit
  // just looks like it did nothing.
  useEffect(() => {
    if (status !== 'error') return;
    const order: ProfileFields[] = ['name', 'email', 'bio'];
    const first = order.find((f) => fieldErrors[f]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#profile-${first}`)?.focus();
    } else {
      summaryRef.current?.focus();
    }
  }, [status, fieldErrors]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void handleSubmit();
  };

  const describedBy = (field: ProfileFields, extra?: string) =>
    [fieldErrors[field] ? `profile-${field}-error` : null, extra].filter(Boolean).join(' ') ||
    undefined;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-labelledby="profile-form-heading">
      <h2 id="profile-form-heading">Edit profile</h2>

      {/* Form-level problems. role="alert" so screen readers announce it. */}
      {formErrors.length > 0 && (
        <div ref={summaryRef} role="alert" tabIndex={-1} className="form-error-summary">
          {formErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <div className="field">
        <label htmlFor="profile-name">Name</label>
        <input
          id="profile-name"
          name="name"
          type="text"
          value={values.name}
          onChange={(e) => setField('name', e.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={describedBy('name')}
          disabled={isSubmitting}
          autoComplete="name"
        />
        {fieldErrors.name && (
          <p id="profile-name-error" className="field-error">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="profile-email">Email</label>
        <input
          id="profile-email"
          name="email"
          type="email"
          value={values.email}
          onChange={(e) => setField('email', e.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy('email')}
          disabled={isSubmitting}
          autoComplete="email"
        />
        {fieldErrors.email && (
          <p id="profile-email-error" className="field-error">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="profile-bio">Bio</label>
        <textarea
          id="profile-bio"
          name="bio"
          rows={5}
          value={values.bio}
          onChange={(e) => setField('bio', e.target.value)}
          aria-invalid={fieldErrors.bio ? true : undefined}
          aria-describedby={describedBy('bio', 'profile-bio-hint')}
          disabled={isSubmitting}
        />
        <p id="profile-bio-hint" className="field-hint">
          {values.bio.length} / {BIO_MAX} characters
        </p>
        {fieldErrors.bio && (
          <p id="profile-bio-error" className="field-error">
            {fieldErrors.bio}
          </p>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save changes'}
      </button>

      {/* Polite live region: success without stealing focus. */}
      <p role="status" aria-live="polite">
        {status === 'saved' ? 'Profile saved.' : ''}
      </p>
    </form>
  );
}

export default ProfileForm;
