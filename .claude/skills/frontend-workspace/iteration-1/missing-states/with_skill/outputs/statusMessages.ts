import type { LoadError } from './settingsApi';

export interface ErrorCopy {
  title: string;
  /** What happened and what to do next, in one sentence the user can act on. */
  detail: string;
  /** Whether retrying the identical request could plausibly succeed. */
  retryable: boolean;
}

/**
 * Error copy lives in one place so the same failure reads the same way
 * everywhere, and so it can be reviewed by someone who does not read TSX.
 */
export function errorCopy(error: LoadError): ErrorCopy {
  switch (error.kind) {
    case 'network':
      return {
        title: 'Can’t reach the server',
        detail:
          'Your settings didn’t load because the request never got through. Check your connection, then try again.',
        retryable: true,
      };
    case 'auth':
      return {
        title: 'You’re not signed in',
        detail: 'Your session expired. Sign in again to view and change your settings.',
        retryable: false,
      };
    case 'client':
      return {
        title: 'We couldn’t load these settings',
        detail:
          'The server rejected the request. Reload the page, and contact support if it keeps happening.',
        retryable: true,
      };
    case 'server':
    default:
      return {
        title: 'Something went wrong on our end',
        detail:
          'Your settings are safe — we just couldn’t load them right now. Try again in a moment.',
        retryable: true,
      };
  }
}
