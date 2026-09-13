import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from './ProfileForm';
import { Profile, ProfileValidationError, normaliseValidationErrors } from './profileApi';

const INITIAL: Profile = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  bio: 'Mathematician.',
};

function setup(save: (profile: Profile) => Promise<Profile>, initial: Profile = INITIAL) {
  const user = userEvent.setup();
  render(<ProfileForm initialProfile={initial} save={save} />);
  return {
    user,
    name: () => screen.getByLabelText('Name') as HTMLInputElement,
    email: () => screen.getByLabelText('Email') as HTMLInputElement,
    bio: () => screen.getByLabelText('Bio') as HTMLTextAreaElement,
    saveButton: () => screen.getByRole('button', { name: /save changes|saving/i }),
  };
}

const rejectWith = (fieldErrors: Record<string, string>, formErrors: string[] = []) =>
  vi.fn(() => Promise.reject(new ProfileValidationError(fieldErrors, formErrors)));

describe('ProfileForm', () => {
  it('keeps everything the user typed when the API rejects the submit', async () => {
    const save = rejectWith({ email: 'is already taken' });
    const f = setup(save);

    await f.user.clear(f.name());
    await f.user.type(f.name(), 'Ada L.');
    await f.user.clear(f.bio());
    await f.user.type(f.bio(), 'A long bio I do not want to retype.');
    await f.user.click(f.saveButton());

    await screen.findByText(/is already taken/);
    expect(f.name()).toHaveValue('Ada L.');
    expect(f.email()).toHaveValue('ada@example.com');
    expect(f.bio()).toHaveValue('A long bio I do not want to retype.');
  });

  it('shows each API message next to the field it concerns', async () => {
    const save = rejectWith({
      email: 'is already taken',
      bio: 'must be 200 characters or fewer',
    });
    const f = setup(save);

    await f.user.click(f.saveButton());

    await waitFor(() => expect(f.email()).toHaveAttribute('aria-invalid', 'true'));
    // The message is reachable through the input's own accessible description,
    // so this asserts the wiring a screen reader uses, not the DOM shape.
    expect(f.email()).toHaveAccessibleDescription(/is already taken/);
    expect(f.bio()).toHaveAccessibleDescription(/200 characters or fewer/);
    expect(f.name()).not.toHaveAttribute('aria-invalid');
  });

  it('announces the failure and moves focus to the first invalid field', async () => {
    const save = rejectWith({ email: 'is already taken' });
    const f = setup(save);

    await f.user.click(f.saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not save/i);
    await waitFor(() => expect(f.email()).toHaveFocus());
  });

  it('clears a field error as soon as that field is edited, leaving the others', async () => {
    const save = rejectWith({
      email: 'is already taken',
      bio: 'must be 200 characters or fewer',
    });
    const f = setup(save);

    await f.user.click(f.saveButton());
    await screen.findByText(/is already taken/);

    await f.user.type(f.email(), 'x');

    await waitFor(() => expect(screen.queryByText(/is already taken/)).not.toBeInTheDocument());
    expect(screen.getByText(/200 characters or fewer/)).toBeInTheDocument();
    expect(f.email()).toHaveFocus();
  });

  it('surfaces errors for fields this form does not render instead of dropping them', async () => {
    const save = rejectWith({}, ['avatar_url: must be https']);
    const f = setup(save);

    await f.user.click(f.saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('avatar_url: must be https');
  });

  it('disables the submit button while in flight so a double click saves once', async () => {
    let resolve!: (p: Profile) => void;
    const save = vi.fn(() => new Promise<Profile>((r) => (resolve = r)));
    const f = setup(save);

    await f.user.click(f.saveButton());
    expect(f.saveButton()).toBeDisabled();
    await f.user.click(f.saveButton(), { pointerEventsCheck: 0 });
    expect(save).toHaveBeenCalledTimes(1);

    resolve(INITIAL);
    await waitFor(() => expect(f.saveButton()).toBeEnabled());
  });

  it('reports a non-validation failure as retryable and keeps the draft', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not save your profile (500).'))
      .mockResolvedValueOnce({ ...INITIAL, name: 'Ada L.' });
    const f = setup(save);

    await f.user.clear(f.name());
    await f.user.type(f.name(), 'Ada L.');
    await f.user.click(f.saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('(500)');
    expect(f.name()).toHaveValue('Ada L.');

    await f.user.click(f.saveButton());

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confirms a successful save in a live region', async () => {
    const save = vi.fn().mockResolvedValue(INITIAL);
    const f = setup(save);

    await f.user.click(f.saveButton());

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Profile saved.');
  });

  it('is operable with the keyboard alone', async () => {
    const save = vi.fn().mockResolvedValue(INITIAL);
    const f = setup(save);

    f.name().focus();
    await f.user.tab();
    expect(f.email()).toHaveFocus();
    await f.user.tab();
    expect(f.bio()).toHaveFocus();
    await f.user.tab();
    expect(f.saveButton()).toHaveFocus();
    await f.user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('normaliseValidationErrors', () => {
  it('reads the object shape', () => {
    const e = normaliseValidationErrors({ errors: { email: ['is already taken'] } });
    expect(e.fieldErrors.email).toBe('is already taken');
    expect(e.formErrors).toEqual([]);
  });

  it('reads the array shape', () => {
    const e = normaliseValidationErrors({
      errors: [{ field: 'bio', message: 'too long' }],
    });
    expect(e.fieldErrors.bio).toBe('too long');
  });

  it('keeps unknown fields as form-level messages', () => {
    const e = normaliseValidationErrors({ errors: { avatar_url: 'must be https' } });
    expect(e.fieldErrors).toEqual({});
    expect(e.formErrors).toEqual(['avatar_url: must be https']);
  });

  it('never produces a silent failure from an unrecognised body', () => {
    const e = normaliseValidationErrors({ oops: true });
    expect(e.formErrors).toHaveLength(1);
  });
});
