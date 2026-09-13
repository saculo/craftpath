import type { ReactNode } from 'react';
import './settings.css';

/**
 * Presentational state components. They render what they are given and report
 * events upward; none of them know how settings are fetched.
 */

/**
 * Loading placeholder.
 *
 * It mirrors the populated layout row for row so nothing jumps when data
 * arrives, and it is announced as busy rather than being a silent white box.
 * `aria-hidden` on the bars keeps screen readers from reading decorative
 * rectangles; the single status line carries the meaning instead.
 */
export function SettingsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="settings-panel" aria-busy="true">
      <p className="sr-only" role="status">
        Loading your settings…
      </p>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div className="settings-row" key={i}>
            <span className="skeleton skeleton--label" />
            <span className="skeleton skeleton--value" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  detail: string;
  onRetry?: () => void;
  /** Rendered instead of retry when retrying cannot help (e.g. signed out). */
  action?: ReactNode;
}

/**
 * Error state.
 *
 * `role="alert"` so it is announced when it replaces the skeleton — otherwise a
 * screen reader user waits forever on a page that silently gave up. The icon is
 * decorative: the text, not the colour, carries the state.
 */
export function SettingsErrorState({ title, detail, onRetry, action }: ErrorStateProps) {
  return (
    <div className="settings-panel settings-panel--error" role="alert">
      <span className="settings-state__icon" aria-hidden="true">
        !
      </span>
      <h3 className="settings-state__title">{title}</h3>
      <p className="settings-state__detail">{detail}</p>
      {onRetry ? (
        <button type="button" className="button button--primary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
      {action}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  detail: string;
  action?: ReactNode;
}

/** Empty state: says why it is empty and what to do about it. */
export function SettingsEmptyState({ title, detail, action }: EmptyStateProps) {
  return (
    <div className="settings-panel settings-panel--empty">
      <h3 className="settings-state__title">{title}</h3>
      <p className="settings-state__detail">{detail}</p>
      {action}
    </div>
  );
}
