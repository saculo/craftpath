import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from './ProfileForm';
import { ApiRequestError, ApiValidationError, ProfileValues } from './api';

const initialValues: ProfileValues = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  bio: 'Mathematician.',
};

const nameInput = () => screen.getByLabelText('Name');
const emailInput = () => screen.getByLabelText('Email');
const bioInput = () => screen.getByLabelText('Bio');
const saveButton = () => screen.getByRole('button', { name: /save changes/i });

async function typeInto(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
  await user.clear(el);
  await user.type(el, text);
}

describe('ProfileForm', () => {
  it('submits the current field values', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({ ...initialValues, name: 'Ada L.' });
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await typeInto(user, nameInput(), 'Ada L.');
    await user.click(saveButton());

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ada L.', email: 'ada@example.com' }),
      ),
    );
  });

  // THE bug this form exists to fix.
  it('keeps everything the user typed when the server rejects the submit', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiValidationError({ email: 'Email is already taken' }));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await typeInto(user, nameInput(), 'Ada King');
    await typeInto(user, emailInput(), 'taken@example.com');
    await typeInto(user, bioInput(), 'A long bio I really do not want to retype.');

    await user.click(saveButton());

    expect(await screen.findByText('Email is already taken')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Ada King');
    expect(emailInput()).toHaveValue('taken@example.com');
    expect(bioInput()).toHaveValue('A long bio I really do not want to retype.');
  });

  it('attaches each server error to its own field and marks it invalid', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockRejectedValue(
      new ApiValidationError({
        name: 'Name is required',
        bio: 'Bio must be under 500 characters',
      }),
    );
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());

    const nameError = await screen.findByText('Name is required');
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput()).toHaveAccessibleDescription(expect.stringContaining('Name is required'));
    expect(nameError).toBeInTheDocument();

    expect(screen.getByText('Bio must be under 500 characters')).toBeInTheDocument();
    expect(bioInput()).toHaveAttribute('aria-invalid', 'true');

    // Untouched field stays clean.
    expect(emailInput()).not.toHaveAttribute('aria-invalid');
  });

  it('focuses the first field with an error after a failed submit', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiValidationError({ email: 'Invalid', bio: 'Too long' }));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());

    await waitFor(() => expect(emailInput()).toHaveFocus());
  });

  it("clears a field's error as soon as the user edits that field", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiValidationError({ email: 'Email is already taken' }));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());
    expect(await screen.findByText('Email is already taken')).toBeInTheDocument();

    await user.type(emailInput(), 'x');

    expect(screen.queryByText('Email is already taken')).not.toBeInTheDocument();
    expect(emailInput()).not.toHaveAttribute('aria-invalid');
  });

  it('replaces stale errors on the next submit instead of accumulating them', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ApiValidationError({ name: 'Name is required', email: 'Invalid' }))
      .mockRejectedValueOnce(new ApiValidationError({ email: 'Still invalid' }));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());
    expect(await screen.findByText('Name is required')).toBeInTheDocument();

    await user.click(saveButton());

    expect(await screen.findByText('Still invalid')).toBeInTheDocument();
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
  });

  it('shows a form-level message for a non-field failure and still keeps the input', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiRequestError('Something went wrong on our end.', 500));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await typeInto(user, bioInput(), 'Draft I do not want to lose.');
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our end.');
    expect(bioInput()).toHaveValue('Draft I do not want to lose.');
  });

  it('lets the user retry after a failure (button is re-enabled)', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ApiValidationError({ email: 'Invalid' }))
      .mockResolvedValueOnce(initialValues);
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());
    await screen.findByText('Invalid');
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (v: ProfileValues) => void;
    const submit = vi.fn().mockReturnValue(new Promise<ProfileValues>((r) => (resolve = r)));
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());

    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    resolve(initialValues);
    await screen.findByText('Profile saved.');
  });

  it('clears errors and confirms on a successful save', async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ApiValidationError({ email: 'Invalid' }))
      .mockResolvedValueOnce(initialValues);
    render(<ProfileForm initialValues={initialValues} submit={submit} />);

    await user.click(saveButton());
    await screen.findByText('Invalid');

    await user.click(saveButton());

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
