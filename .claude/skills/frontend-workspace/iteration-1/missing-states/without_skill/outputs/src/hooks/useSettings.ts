import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchSettings, type Settings } from '../api/settingsApi';

/**
 * A discriminated union, not four loose booleans.
 *
 * The bug being fixed ("blank box while loading, nothing at all on a 500") is
 * almost always caused by state shaped like
 * `{ data, loading, error }` where the render path only handles `data`.
 * With a union, TypeScript forces every branch to be rendered, and an
 * impossible combination like "loading AND error" cannot be represented.
 */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'refreshing'; data: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError };

export interface UseSettingsResult {
  state: AsyncState<Settings>;
  /** Re-run the request. Safe to call from any state. */
  retry: () => void;
}

export function useSettings(): UseSettingsResult {
  const [state, setState] = useState<AsyncState<Settings>>({
    status: 'loading',
  });
  const controllerRef = useRef<AbortController | null>(null);
  // Used to tell an in-flight request "you are stale, don't write state".
  const attemptRef = useRef(0);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const attempt = ++attemptRef.current;

    // Keep showing existing data while refreshing, so a retry after a
    // successful load doesn't flash the skeleton back in.
    setState((previous) =>
      previous.status === 'success' || previous.status === 'refreshing'
        ? { status: 'refreshing', data: previous.data }
        : { status: 'loading' },
    );

    void (async () => {
      try {
        const data = await fetchSettings(controller.signal);
        if (attempt !== attemptRef.current) return;
        setState({ status: 'success', data });
      } catch (caught) {
        if (attempt !== attemptRef.current || controller.signal.aborted) return;
        const error =
          caught instanceof ApiError
            ? caught
            : new ApiError('unknown', 'Something went wrong.', {
                cause: caught,
              });
        setState({ status: 'error', error });
      }
    })();
  }, []);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { state, retry: load };
}
