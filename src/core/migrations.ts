/**
 * Changes a newer craftpath makes to a project an older one set up.
 *
 * `update` runs every entry newer than the project's stamp and no newer than
 * the running CLI, oldest first, and moves the stamp only once they have all
 * succeeded. So a migration that fails is retried by the next `update` -- and
 * one that half-applied is run again over its own partial work, which is why
 * each `apply` must be safe to run twice.
 *
 * Empty until the first release that changes something already on disk. The
 * value is that the mechanism exists before that release needs it.
 */
export interface Migration {
    /** The craftpath version that introduced the change. */
    since: string;
    /** One line, printed as it runs. */
    describe: string;
    apply(root: string): Promise<void>;
}

export const MIGRATIONS: Migration[] = [];

/**
 * The migrations a project stamped `stamped` needs to reach `running`, oldest
 * first. No stamp means set up before stamps existed, so every one (V4).
 */
export function pending(
    migrations: Migration[],
    stamped: string | null,
    running: string,
): Migration[] {
    return migrations
        .filter(
            (m) =>
                (stamped === null || Bun.semver.order(m.since, stamped) > 0) &&
                Bun.semver.order(m.since, running) <= 0,
        )
        .sort((a, b) => Bun.semver.order(a.since, b.since));
}
