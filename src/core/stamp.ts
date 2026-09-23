/**
 * The version stamp: which craftpath scaffolded a project (V1).
 *
 * `[craftpath] version = "x.y.z"`, the first table in config.toml. Always
 * written and matched as this exact block, never re-serialised: Bun.TOML
 * parses without serialising, and the rest of the file is the user's (V3).
 */

export function stampBlock(version: string): string {
    return `[craftpath]\nversion = ${JSON.stringify(version)}\n\n`;
}

const STAMP = /^\[craftpath\]\nversion = "[^"\n]*"\n\n/;

/**
 * The config text with the stamp removed, for hashing (V2).
 *
 * `update` rewrites the stamp on every upgrade, and evidence goes stale when
 * the config hash changes, so a hash that covered it would stale every done
 * task on every upgrade. A block hand-edited out of this shape stays in the
 * hash: the cost is re-verifying, never a proof that should not pass.
 */
export function withoutStamp(text: string): string {
    return text.replace(STAMP, "");
}
