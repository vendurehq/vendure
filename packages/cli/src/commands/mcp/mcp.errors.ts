import { defineError } from '@vendure/common/lib/command';

/**
 * The coded errors that `vendure mcp` and `vendure mcp install` share. `vendure mcp` writes them to
 * stderr, since its stdout carries the protocol, and `install` returns them in its envelope.
 */

export const projectNotFound = defineError<{ dir: string }>({
    code: 'mcp.project-not-found',
    exit: 1,
    message: ({ dir }) =>
        `No Vendure project was found in "${dir}" or the directories above it. A Vendure project has a package.json with an @vendure/core dependency.`,
});

export const projectAmbiguous = defineError<{ root: string; candidates: string[]; client?: string }>({
    code: 'mcp.project-ambiguous',
    exit: 1,
    message: ({ root, candidates, client }) =>
        `"${root}" holds more than one Vendure project: ${candidates.join(', ')}. ` +
        (client ? localOnlyAdvice(client) : 'Start the server with --dir and one of them.'),
    fix: ({ candidates, client }) =>
        client === 'claude'
            ? candidates.map(dir => ({
                  path: ['mcp', 'install'],
                  input: { client, dir, scope: 'local' },
                  description: `Register the server for ${dir} on this machine`,
              }))
            : [],
});

/**
 * What to do when a checked-in config cannot select the project. Claude Code can register the
 * server for this machine, with the project directory, through `install --scope local`. Other
 * clients need the entry in their own user-level config.
 */
export function localOnlyAdvice(client: string): string {
    return client === 'claude'
        ? 'A checked-in config cannot select the project, so register the server for this machine only ' +
              'with --scope local, which passes the project directory.'
        : `A checked-in config cannot select the project, so add the server to your ${client} user-level ` +
              "config instead, with --dir and the project's path. --print shows the entry.";
}

export const cliNotInstalled = defineError<{ project: string }>({
    code: 'mcp.cli-not-installed',
    exit: 1,
    message: ({ project }) =>
        `The project in "${project}" does not install @vendure/cli. Add it as a devDependency, so the MCP server runs the project's own version.`,
});

export const notProjectCli = defineError<{
    project: string;
    projectVersion: string;
    running: string;
    runningVersion: string;
}>({
    code: 'mcp.not-project-cli',
    exit: 1,
    message: ({ project, projectVersion, running, runningVersion }) =>
        `The project in "${project}" installs @vendure/cli ${projectVersion}, but this is ` +
        `@vendure/cli ${runningVersion} from "${running}", for example a global install that npx fell ` +
        "back to. Start the server from the project, where npx runs the project's own CLI.",
});
