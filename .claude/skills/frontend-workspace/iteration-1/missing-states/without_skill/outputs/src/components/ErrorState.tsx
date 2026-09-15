import { ApiError } from '../api/settingsApi';
import './states.css';

interface ErrorCopy {
  title: string;
  body: string;
  /** Null when retrying cannot possibly help. */
  retryLabel: string | null;
}

/**
 * Error *messages* are product copy, not stack traces.
 *
 * Rules applied:
 *  - Say what happened in the user's terms, never "Error: 500".
 *  - Say whether it's their problem or ours.
 *  - Offer the next action. A dead end with no button is what makes people
 *    conclude the app is broken.
 */
export function errorCopy(error: ApiError): ErrorCopy {
  switch (error.kind) {
    case 'server':
      return {
        title: "We couldn't load your settings",
        body: 'Something went wrong on our end. Your settings are safe — nothing has been changed.',
        retryLabel: 'Try again',
      };
    case 'network':
      return {
        title: "You're offline",
        body: 'Check your internet connection and try again.',
        retryLabel: 'Try again',
      };
    case 'timeout':
      return {
        title: 'This is taking longer than expected',
        body: 'The server did not respond in time.',
        retryLabel: 'Try again',
      };
    case 'unauthorized':
      return {
        title: 'Your session has expired',
        body: 'Sign in again to view your settings.',
        retryLabel: null,
      };
    case 'forbidden':
      return {
        title: "You don't have access to these settings",
        body: 'Ask an administrator of your workspace for access.',
        retryLabel: null,
      };
    case 'notFound':
      return {
        title: 'Settings not found',
        body: 'We could not find a settings record for this account.',
        retryLabel: null,
      };
    case 'parse':
      return {
        title: "We couldn't read the response",
        body: 'Something went wrong on our end while loading your settings.',
        retryLabel: 'Try again',
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'We could not load your settings just now.',
        retryLabel: 'Try again',
      };
  }
}

interface ErrorStateProps {
  error: ApiError;
  onRetry: () => void;
  /** True while a retry is in flight, to disable the button and show progress. */
  isRetrying?: boolean;
}

export function ErrorState({ error, onRetry, isRetrying = false }: ErrorStateProps) {
  const copy = errorCopy(error);
  const canRetry = copy.retryLabel !== null && error.isRetryable;

  return (
    // role="alert" so assistive tech announces the failure immediately — this is
    // the specific gap that made the failure "nothing at all" for some users.
    <div className="state-panel state-panel--error" role="alert" data-testid="settings-error">
      <h2 className="state-panel__title">{copy.title}</h2>
      <p className="state-panel__body">{copy.body}</p>

      {canRetry && (
        <button type="button" className="button" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Retrying…' : copy.retryLabel}
        </button>
      )}

      {error.kind === 'unauthorized' && (
        <a className="button" href="/login">
          Sign in
        </a>
      )}

      {error.requestId && (
        <p className="state-panel__meta">
          If it keeps happening, quote reference <code>{error.requestId}</code> to support.
        </p>
      )}
    </div>
  );
}
