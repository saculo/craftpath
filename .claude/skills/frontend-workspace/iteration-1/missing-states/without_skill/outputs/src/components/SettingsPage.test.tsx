import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';

/**
 * These tests are written against what a user perceives, not implementation
 * detail: is there something on screen, does it say something useful, can I
 * act on it. Each state the page can be in gets a test, because the states
 * that get skipped are the ones users actually hit.
 */

const VALID_SETTINGS = {
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  timezone: 'Europe/London',
  emailNotifications: true,
  marketingEmails: false,
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsPage — loading state', () => {
  it('shows a skeleton that mirrors the form instead of a blank box', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never settles

    render(<SettingsPage />);

    expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-form')).not.toBeInTheDocument();
  });

  it('announces loading to assistive technology', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<SettingsPage />);

    const statuses = screen.getAllByRole('status');
    expect(statuses.some((el) => /loading/i.test(el.textContent ?? ''))).toBe(true);
  });

  it('does not leak the skeleton once data arrives', async () => {
    fetchMock.mockResolvedValue(jsonResponse(VALID_SETTINGS));

    render(<SettingsPage />);

    await screen.findByTestId('settings-form');
    expect(screen.queryByTestId('settings-skeleton')).not.toBeInTheDocument();
  });
});

describe('SettingsPage — success state', () => {
  it('renders the settings values in editable fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse(VALID_SETTINGS));

    render(<SettingsPage />);

    expect(await screen.findByLabelText(/display name/i)).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText(/email$/i)).toHaveValue('ada@example.com');
    expect(screen.getByLabelText(/account activity/i)).toBeChecked();
    expect(screen.getByLabelText(/product updates/i)).not.toBeChecked();
  });
});

describe('SettingsPage — error states', () => {
  it('shows a human message and a retry action when the API returns 500', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't load your settings/i);
    expect(alert).toHaveTextContent(/our end/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // Regression guard for the original bug: never a silent blank page.
    expect(alert.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('never shows a raw status code or stack trace to the user', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/undefined|\[object Object\]|Error:/);
  });

  it('offers a support reference when the server sends a request id', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 503, headers: { 'x-request-id': 'req_abc123' } }),
    );

    render(<SettingsPage />);

    expect(await screen.findByText(/req_abc123/)).toBeInTheDocument();
  });

  it('distinguishes a network failure from a server failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('does not offer retry for 403, because retrying cannot help', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));

    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/don't have access/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('routes an expired session to sign-in instead of a retry loop', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/session has expired/i);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('treats a 200 with a malformed body as an error, not as empty settings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't read the response/i);
  });
});

describe('SettingsPage — retry', () => {
  it('recovers to the loaded form when a retry succeeds', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(VALID_SETTINGS));

    render(<SettingsPage />);

    await user.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByTestId('settings-form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps showing an error if the retry also fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    render(<SettingsPage />);

    await user.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your settings/i);
  });
});

describe('SettingsPage — lifecycle safety', () => {
  it('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise(() => {});
    });

    const { unmount } = render(<SettingsPage />);
    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
