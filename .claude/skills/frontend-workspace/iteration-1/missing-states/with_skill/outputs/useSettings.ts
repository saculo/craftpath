import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSettings, isAbortError, LoadError, type Settings } from './settingsApi';

/**
 * One explicit state per thing the user can be looking at. Because this is a
 * discriminated union, the view cannot render "loading and error at the same
 * time", and it cannot forget a case — TypeScript makes the missing branch a
 * compile error, which is the actual fix for "you just get nothing at all".
 */
export type SettingsState =
  | { status: 'loading' }
  | { status: 'error'; error: LoadError }
  | { status: 'success'; data: Settings };

export interface UseSettingsResult {
  state: SettingsState;
  /** Refetch without a page reload. Safe to call while a request is in flight. */
  retry: () => void;
}

export function useSettings(): UseSettingsResult {
  const [state, setState] = useState<SettingsState>({ status: 'loading' });

  // Guards against two problems the network gives us for free:
  //  - a response arriving after unmount (abort + mounted flag)
  //  - a slow first response overwriting a fast second one (request id)
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;

    const requestId = ++requestIdRef.current;
    const isStale = () => !mountedRef.current || requestId !== requestIdRef.current;

    setState({ status: 'loading' });

    fetchSettings(controller.signal)
      .then((data) => {
        if (isStale()) return;
        setState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        if (isStale() || isAbortError(err)) return;
        const error =
          err instanceof LoadError
            ? err
            : new LoadError('server', 'Settings could not be loaded.');
        // Keep the detail for operators; the user gets a written sentence.
        console.error('[settings] load failed', err);
        setState({ status: 'error', error });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [load]);

  return { state, retry: load };
}
