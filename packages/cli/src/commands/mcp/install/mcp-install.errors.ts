import { defineError } from '@vendure/common/lib/command';

import { localOnlyAdvice } from '../mcp.errors.js';

import { McpClient } from './client-config.js';

export const rootCannotSelectProject = defineError<{
    root: string;
    project: string;
    fromRoot: string;
    client: McpClient;
}>({
    code: 'mcp.root-cannot-select-project',
    exit: 1,
    message: ({ root, project, fromRoot, client }) =>
        `MCP clients start the server from the repository root, "${root}", and from there it ${fromRoot}, ` +
        `not "${project}". ${localOnlyAdvice(client)}`,
    fix: ({ client, project }) =>
        client === 'claude'
            ? [
                  {
                      path: ['mcp', 'install'],
                      input: { client, dir: project, scope: 'local' },
                      description: "Register the server in Claude Code's local scope",
                  },
              ]
            : [],
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
    message: ({ root, project, projectVersion, rootVersion, client }) =>
        `MCP clients start the server from the repository root, "${root}", and ${
            rootVersion ? `that resolves @vendure/cli ${rootVersion}` : 'no @vendure/cli resolves from there'
        }, while the project in "${project}" installs ${projectVersion}. ` +
        `Add @vendure/cli ${projectVersion} as a devDependency of the root package.json. ` +
        (client === 'claude'
            ? 'Or register the server for this machine only with --scope local.'
            : `Or add the server to your ${client} user-level config, with --dir and the project's path.`),
    fix: ({ client, project }) =>
        client === 'claude'
            ? [
                  {
                      path: ['mcp', 'install'],
                      input: { client, dir: project, scope: 'local' },
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
