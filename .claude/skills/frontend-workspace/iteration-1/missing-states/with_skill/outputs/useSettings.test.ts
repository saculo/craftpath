import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSettings } from './useSettings';
import type { Settings } from './settingsApi';

/**
 * The page tests above cover what the user sees. These few cover the hook's
 * contract directly, because "the request was aborted" and "the stale response
 * was dropped" are hard to observe through pixels alone.
 */

const settings: Settings = {
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  timezone: 'Europe/Warsaw',
  marketingEmails: false,
  connectedAccounts: [],
};

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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSettings', () => {
  it('starts in the loading state so the view never has to guess', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSettings());
    expect(result.current.state).toEqual({ status: 'loading' });
  });

  it('classifies a 500 as a retryable server error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({
      status: 'error',
      error: { kind: 'server', status: 500 },
    });
  });

  it('classifies an unreachable server as a network error, not a server error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ status: 'error', error: { kind: 'network' } });
  });

  it('treats a 200 with an unreadable body as a failure rather than rendering nothing', async () => {
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ status: 'error', error: { kind: 'server' } });
  });

  it('aborts the in-flight request on unmount', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useSettings());

    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('returns to loading on retry and lands on the fresh data', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(settings));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    act(() => result.current.retry());
    expect(result.current.state.status).toBe('loading');

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.state).toMatchObject({ status: 'success', data: settings });
  });
});
