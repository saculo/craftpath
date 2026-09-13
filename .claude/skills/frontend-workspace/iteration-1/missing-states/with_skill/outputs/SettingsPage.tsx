import { errorCopy } from './statusMessages';
import { SettingsErrorState, SettingsSkeleton } from './SettingsStates';
import { SettingsView } from './SettingsView';
import { useSettings } from './useSettings';
import './settings.css';

/**
 * Container: owns the data and the decision about which state to show. The page
 * chrome (heading, description) renders immediately in every state, so the user
 * always knows where they are — only the data region swaps.
 */
export function SettingsPage({ onSignIn }: { onSignIn?: () => void } = {}) {
  const { state, retry } = useSettings();

  return (
    <main className="settings-page">
      <h1>Settings</h1>
      <p className="settings-page__lede">Manage your profile, notifications, and connections.</p>

      {/* Fixed min-height: the region reserves its space up front so content
          does not jump under a cursor mid-click when the request resolves. */}
      <div className="settings-page__region">{renderState()}</div>
    </main>
  );

  function renderState() {
    switch (state.status) {
      case 'loading':
        return <SettingsSkeleton />;

      case 'error': {
        const copy = errorCopy(state.error);
        return (
          <SettingsErrorState
            title={copy.title}
            detail={copy.detail}
            onRetry={copy.retryable ? retry : undefined}
            action={
              copy.retryable ? undefined : (
                <button type="button" className="button button--primary" onClick={onSignIn}>
                  Sign in
                </button>
              )
            }
          />
        );
      }

      case 'success':
        return (
          <SettingsView
            settings={state.data}
            onConnectAccount={() => {
              /* routed by the parent in the real app */
            }}
          />
        );

      default: {
        // Exhaustiveness guard: adding a state to the union without handling it
        // here is a compile error, not a blank page in production.
        const unreachable: never = state;
        return unreachable;
      }
    }
  }
}

export default SettingsPage;
