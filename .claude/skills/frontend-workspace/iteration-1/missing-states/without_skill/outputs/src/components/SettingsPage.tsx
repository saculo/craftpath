import { useSettings } from '../hooks/useSettings';
import type { Settings } from '../api/settingsApi';
import { SettingsSkeleton } from './SettingsSkeleton';
import { ErrorState } from './ErrorState';
import './states.css';

/**
 * SettingsPage renders exactly one branch of the request union.
 *
 * The `switch` is exhaustive: adding a new status to `AsyncState` without
 * handling it here becomes a TypeScript error at the `never` assignment, so
 * an unhandled state can't silently render blank again.
 */
export function SettingsPage() {
  const { state, retry } = useSettings();

  return (
    <main className="page" aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>

      {/* One polite live region owns all status announcements for this page. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {state.status === 'loading'
          ? 'Loading your settings'
          : state.status === 'refreshing'
            ? 'Refreshing your settings'
            : state.status === 'success'
              ? 'Settings loaded'
              : ''}
      </p>

      {renderBody()}
    </main>
  );

  function renderBody() {
    switch (state.status) {
      case 'loading':
        return <SettingsSkeleton />;

      case 'error':
        return <ErrorState error={state.error} onRetry={retry} />;

      case 'refreshing':
      case 'success':
        return (
          <div aria-busy={state.status === 'refreshing'}>
            <SettingsForm settings={state.data} />
          </div>
        );

      default: {
        const exhaustive: never = state;
        return exhaustive;
      }
    }
  }
}

function SettingsForm({ settings }: { settings: Settings }) {
  return (
    <form className="settings-form" data-testid="settings-form">
      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" name="displayName" defaultValue={settings.displayName} />
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" defaultValue={settings.email} />
      </div>

      <div className="field">
        <label htmlFor="timezone">Time zone</label>
        <input id="timezone" name="timezone" defaultValue={settings.timezone} />
      </div>

      <div className="field field--checkbox">
        <input
          id="emailNotifications"
          name="emailNotifications"
          type="checkbox"
          defaultChecked={settings.emailNotifications}
        />
        <label htmlFor="emailNotifications">Email me about account activity</label>
      </div>

      <div className="field field--checkbox">
        <input
          id="marketingEmails"
          name="marketingEmails"
          type="checkbox"
          defaultChecked={settings.marketingEmails}
        />
        <label htmlFor="marketingEmails">Send me product updates</label>
      </div>

      <button type="submit" className="button">
        Save changes
      </button>
    </form>
  );
}
