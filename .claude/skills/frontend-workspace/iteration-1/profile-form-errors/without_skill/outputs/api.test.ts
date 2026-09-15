import { describe, expect, it } from 'vitest';
import { parseErrorBody } from './api';

describe('parseErrorBody', () => {
  it('reads the object-of-arrays shape and takes the first message per field', () => {
    const error = parseErrorBody({
      errors: { email: ['is invalid', 'is already taken'], name: ['is required'] },
    });

    expect(error.fieldErrors).toEqual({ email: 'is invalid', name: 'is required' });
    expect(error.formErrors).toEqual([]);
  });

  it('reads the object-of-strings shape', () => {
    const error = parseErrorBody({ errors: { bio: 'is too long' } });
    expect(error.fieldErrors).toEqual({ bio: 'is too long' });
  });

  it('reads the array-of-objects shape', () => {
    const error = parseErrorBody({
      errors: [
        { field: 'email', message: 'is invalid' },
        { field: 'bio', message: 'is too long' },
      ],
    });

    expect(error.fieldErrors).toEqual({ email: 'is invalid', bio: 'is too long' });
  });

  it('promotes errors for unknown fields to form-level so they stay visible', () => {
    const error = parseErrorBody({ errors: { avatar_url: 'is not a valid URL' } });

    expect(error.fieldErrors).toEqual({});
    expect(error.formErrors).toEqual(['is not a valid URL']);
  });

  it('keeps a top-level message as a form-level error', () => {
    const error = parseErrorBody({ message: 'Profile is locked by an administrator.' });
    expect(error.formErrors).toEqual(['Profile is locked by an administrator.']);
  });

  it('falls back to a generic message when the body is unusable', () => {
    expect(parseErrorBody({}).formErrors).toHaveLength(1);
    expect(parseErrorBody(null).formErrors).toHaveLength(1);
    expect(parseErrorBody('<html>502</html>').formErrors).toHaveLength(1);
  });
});
