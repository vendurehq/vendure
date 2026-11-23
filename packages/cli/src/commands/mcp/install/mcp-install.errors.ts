import { defineError } from '@vendure/common/lib/command';

import { McpClient } from './client-config.js';

export const projectNotFound = defineError<{ dir: string }>({
    code: 'mcp.project-not-found',
    exit: 1,
    message: ({ dir }) =>
        `No Vendure project was found in "${dir}" or the directories above it. A Vendure project has a package.json with an @vendure/core dependency.`,
});

export const projectAmbiguous = defineError<{ root: string; candidates: string[]; client: McpClient }>({
    code: 'mcp.project-ambiguous',
    exit: 1,
    message: ({ root, candidates }) =>
        `"${root}" holds more than one Vendure project: ${candidates.join(', ')}. Choose one with --dir.`,
    fix: ({ candidates, client }) =>
        candidates.map(dir => ({
            path: ['mcp', 'install'],
            input: { client, dir },
            description: `Install for ${dir}`,
        })),
});

export const cliNotInstalled = defineError<{ project: string }>({
    code: 'mcp.cli-not-installed',
    exit: 1,
    message: ({ project }) =>
        `The project in "${project}" does not install @vendure/cli. Add it as a devDependency, so the MCP server runs the project's own version.`,
});

export const rootCannotResolveCli = defineError<{
    root: string;
    project: string;
    projectVersion: string;
    rootVersion: string | null;
    client: McpClient;
}>({
    code: 'mcp.root-cannot-resolve-cli',
    exit: 1,
    message: ({ root, project, projectVersion, rootVersion }) =>
        `MCP clients start the server from the repository root, "${root}", and ${
            rootVersion ? `that resolves @vendure/cli ${rootVersion}` : 'no @vendure/cli resolves from there'
        }, while the project in "${project}" installs ${projectVersion}. ` +
        `Add @vendure/cli ${projectVersion} as a devDependency of the root package.json, or register the server for this machine only with --scope local.`,
    fix: ({ client }) =>
        client === 'claude'
            ? [
                  {
                      path: ['mcp', 'install'],
                      input: { client, scope: 'local' },
                      description: "Register the server in Claude Code's local scope instead",
                  },
              ]
            : [],
});

export const configUnreadable = defineError<{ file: string; reason: string; client: McpClient }>({
    code: 'mcp.config-unreadable',
    exit: 1,
    message: ({ file, reason }) =>
        `"${file}" was left as it is, because ${reason}. Add the server entry to it by hand.`,
    fix: ({ client }) => [
        { path: ['mcp', 'install'], input: { client, print: true }, description: 'Print the entry to add' },
    ],
});

export const scopeLocalUnsupported = defineError<{ client: McpClient }>({
    code: 'mcp.scope-local-unsupported',
    exit: 1,
    message: ({ client }) =>
        `--scope local is for Claude Code only. For ${client}, use the project config, or --print.`,
    fix: ({ client }) => [
        { path: ['mcp', 'install'], input: { client }, description: 'Write the project config' },
    ],
});

export const claudeMcpAddFailed = defineError<{ command: string; message: string }>({
    code: 'mcp.claude-mcp-add-failed',
    exit: 1,
    message: ({ command, message }) => `"${command}" failed: ${message}`,
});
