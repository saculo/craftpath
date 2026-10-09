/**
 * The craftpath CLI: set a project up, and check it.
 *
 * Everything a work item needs -- spec, plan, work, review -- happens through
 * the steps `init` installs as harness skills (`/craftpath-spec` on Claude Code,
 * `/skill:craftpath-spec` on pi ...) and the scripts they run, never through
 * this CLI.
 */
import pkg from "../package.json" with { type: "json" };

export const USAGE = `craftpath <command>

  init      install craftpath into this project, or update it
  doctor    check the project's setup
  version   print the version
`;

export async function main(args: string[]): Promise<number> {
    const [command, ...rest] = args;
    switch (command) {
        case "init":
            return (await import("./init")).init(process.cwd(), rest);
        case "doctor":
            return (await import("./doctor")).doctor(process.cwd());
        case "version":
            console.log(`craftpath ${pkg.version}`);
            return 0;
        case undefined:
        case "help":
        case "--help":
        case "-h":
            console.log(USAGE);
            return 0;
        default:
            console.error(`Unknown command: ${command}\n\n${USAGE}`);
            return 2;
    }
}
