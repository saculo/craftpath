import './states.css';

/**
 * A skeleton that mirrors the real layout, rather than an empty white box.
 *
 * Two things matter:
 *  - It occupies roughly the same space as the loaded content, so the page
 *    doesn't jump when data arrives (cumulative layout shift).
 *  - It is `aria-hidden`, with the announcement handled once by a single
 *    `role="status"` region. Otherwise screen readers read out a dozen
 *    meaningless placeholder boxes.
 */
export function SettingsSkeleton() {
  return (
    <div data-testid="settings-skeleton">
      <p className="visually-hidden" role="status">
        Loading your settings…
      </p>
      <div className="skeleton-group" aria-hidden="true">
        <div className="skeleton skeleton--heading" />
        {[0, 1, 2].map((row) => (
          <div className="skeleton-row" key={row}>
            <div className="skeleton skeleton--label" />
            <div className="skeleton skeleton--field" />
          </div>
        ))}
        <div className="skeleton skeleton--button" />
      </div>
    </div>
  );
}
