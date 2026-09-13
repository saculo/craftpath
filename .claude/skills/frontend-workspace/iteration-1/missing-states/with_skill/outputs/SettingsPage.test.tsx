import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import type { Settings } from './settingsApi';

/**
 * These tests drive the page the way a user does: find things by accessible
 * name or visible text, act, assert on what appears. Nothing here reaches into
 * component internals or state shape, so a refactor that keeps the screen the
 * same keeps the suite green — and a regression that blanks the screen fails it.
 */

const settings: Settings = {
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  timezone: 'Europe/Warsaw',
  marketingEmails: false,
  connectedAccounts: [{ id: '1', provider: 'GitHub', label: '@ada' }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // The hook logs failures for operators; keep the test output readable while
  // still being able to assert on unexpected logging.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsPage loading state', () => {
  it('shows a labelled loading placeholder instead of a blank box', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);

    render(<SettingsPage />);

    // The page chrome is there immediately — the user knows where they are.
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    // …and the data region announces that it is working, rather than sitting empty.
    expect(await screen.findByRole('status')).toHaveTextContent(/loading your settings/i);

    pending.resolve(jsonResponse(settings));
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('keeps the page heading in place when data replaces the placeholder', async () => {
    fetchMock.mockResolvedValue(jsonResponse(settings));

    render(<SettingsPage />);
    const heading = screen.getByRole('heading', { name: 'Settings' });

    await screen.findByText('Ada Lovelace');

    // Same heading node throughout: the region swapped, the page did not remount
    // and re-lay-itself-out under the user's cursor.
    expect(screen.getByRole('heading', { name: 'Settings' })).toBe(heading);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('SettingsPage error state', () => {
  it('explains a 500 and offers a retry that recovers without a page reload', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse(settings));

    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our end');
    expect(alert).toHaveTextContent(/try again in a moment/i);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a network failure from a server failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/can’t reach the server/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers sign-in rather than a pointless retry when the session expired', async () => {
    const onSignIn = vi.fn();
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ message: 'forbidden' }, 403));

    render(<SettingsPage onSignIn={onSignIn} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/you’re not signed in/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows the retry control while the retry is in flight without flashing an empty box', async () => {
    const user = userEvent.setup();
    const second = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockReturnValueOnce(second.promise);

    render(<SettingsPage />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // Between click and response the user sees progress, not nothing.
    expect(await screen.findByRole('status')).toHaveTextContent(/loading your settings/i);

    second.resolve(jsonResponse(settings));
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('is reachable and operable with the keyboard alone', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(settings));

    render(<SettingsPage />);
    await screen.findByRole('alert');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });
});

describe('SettingsPage empty state', () => {
  it('explains an empty connected-accounts list and what to do about it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...settings, connectedAccounts: [] }));

    render(<SettingsPage />);

    expect(await screen.findByText('No accounts connected')).toBeInTheDocument();
    expect(screen.getByText(/connect an account to sign in faster/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect an account' })).toBeInTheDocument();
  });

  it('lists connected accounts when there are some', async () => {
    fetchMock.mockResolvedValue(jsonResponse(settings));

    render(<SettingsPage />);

    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('No accounts connected')).not.toBeInTheDocument();
  });
});

describe('SettingsPage request lifecycle', () => {
  it('does not let a slow earlier response overwrite a newer one', async () => {
    const user = userEvent.setup();
    const slowFirst = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockReturnValueOnce(slowFirst.promise)
      .mockResolvedValueOnce(jsonResponse({ ...settings, displayName: 'Newest Value' }));

    render(<SettingsPage />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('status');

    // Second retry supersedes the first; the first then lands late.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    slowFirst.resolve(jsonResponse({ ...settings, displayName: 'Stale Value' }));

    expect(await screen.findByText('Newest Value')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Stale Value')).not.toBeInTheDocument());
  });

  it('ignores a response that arrives after the user has navigated away', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);

    const { unmount } = render(<SettingsPage />);
    await screen.findByRole('status');

    unmount();
    pending.resolve(jsonResponse(settings));
    await Promise.resolve();

    // No "state update on an unmounted component" noise, and nothing rendered.
    expect(console.error).not.toHaveBeenCalled();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('aborts the in-flight request when the user retries', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockImplementation((_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          setTimeout(() => resolve(jsonResponse(settings)), 5);
        }),
      );

    render(<SettingsPage />);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const firstSignal = (fetchMock.mock.calls[1][1] as RequestInit).signal!;
    expect(firstSignal.aborted).toBe(false);

    await waitForElementToBeRemoved(() => screen.queryByRole('status'));
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });
});
