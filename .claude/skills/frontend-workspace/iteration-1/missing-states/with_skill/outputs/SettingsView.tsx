import { SettingsEmptyState } from './SettingsStates';
import type { Settings } from './settingsApi';
import './settings.css';

/**
 * Populated state. Pure presentation: given settings, render them. No fetching,
 * no status decisions — which is what makes it trivial to test and reuse.
 */
export function SettingsView({
  settings,
  onConnectAccount,
}: {
  settings: Settings;
  onConnectAccount: () => void;
}) {
  return (
    <div className="settings-panel">
      <dl className="settings-list">
        <div className="settings-row">
          <dt>Display name</dt>
          <dd>{settings.displayName}</dd>
        </div>
        <div className="settings-row">
          <dt>Email</dt>
          <dd>{settings.email}</dd>
        </div>
        <div className="settings-row">
          <dt>Time zone</dt>
          <dd>{settings.timezone}</dd>
        </div>
        <div className="settings-row">
          <dt>Marketing emails</dt>
          <dd>{settings.marketingEmails ? 'On' : 'Off'}</dd>
        </div>
      </dl>

      <section aria-labelledby="connected-accounts-heading">
        <h2 id="connected-accounts-heading" className="settings-subheading">
          Connected accounts
        </h2>

        {settings.connectedAccounts.length === 0 ? (
          // The empty case is a real state here, not an accident: a new user has
          // no accounts, and a bare heading over nothing reads as a bug.
          <SettingsEmptyState
            title="No accounts connected"
            detail="Connect an account to sign in faster and sync your calendar."
            action={
              <button type="button" className="button" onClick={onConnectAccount}>
                Connect an account
              </button>
            }
          />
        ) : (
          <ul className="settings-accounts">
            {settings.connectedAccounts.map((account) => (
              <li key={account.id}>
                <span className="settings-accounts__provider">{account.provider}</span>
                <span className="settings-accounts__label">{account.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
