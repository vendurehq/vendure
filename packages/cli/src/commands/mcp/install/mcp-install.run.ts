import { CommandContext, fail } from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

import { findMcpProject, resolveCliFrom, ResolvedCli } from '../../../command-host/mcp/project.js';

import {
    CLIENT_CONFIG,
    configBlock,
    ConfigFileUnreadable,
    McpClient,
    SERVER_NAME,
    updateClientConfig,
} from './client-config.js';
import {
    claudeMcpAddFailed,
    cliNotInstalled,
    configUnreadable,
    projectAmbiguous,
    projectNotFound,
    rootCannotResolveCli,
    scopeLocalUnsupported,
} from './mcp-install.errors.js';

interface Input {
    client: McpClient;
    scope?: 'project' | 'local';
    print?: boolean;
    dir?: string;
}

/**
 * Adds the Developer MCP server to a client. By default it writes the client's checked-in project
 * config at the git root, so every clone and worktree gets it. With `--scope local` it registers
 * the server with Claude Code for this machine only.
 */
export async function run(input: Input, ctx: CommandContext) {
    const scope = input.scope ?? 'project';
    const start = path.resolve(ctx.cwd, input.dir ?? '.');
    const found = findMcpProject(start);
    if (found.kind === 'not-found') {
        return fail(projectNotFound, { dir: start });
    }
    if (found.kind === 'ambiguous') {
        return fail(projectAmbiguous, {
            root: found.root,
            candidates: found.candidates,
            client: input.client,
        });
    }
    const project = found.dir;
    const local = resolveCliFrom(project);
    if (!local) {
        return fail(cliNotInstalled, { project });
    }
    const root = (await gitRoot(project, ctx)) ?? project;
    const result = { client: input.client, scope, project };

    if (scope === 'local') {
        if (input.client !== 'claude') {
            return fail(scopeLocalUnsupported, { client: input.client });
        }
        return registerLocally(input, ctx, result, local, root);
    }

    const { file: relativeFile, writes } = CLIENT_CONFIG[input.client];
    const file = path.join(root, relativeFile);
    if (input.print || !writes) {
        if (!writes) {
            ctx.notice(
                'warning',
                `${input.client} does not document which folder it starts an MCP server in, so the entry ` +
                    `is printed rather than written. Add it to ${relativeFile} and check that the server ` +
                    'starts in the project.',
            );
        }
        return {
            ...result,
            action: 'printed' as const,
            file,
            config: configBlock(input.client),
            command: null,
        };
    }

    // MCP clients start `npx` from the folder they were opened in, usually the repository root, and
    // npx runs the `@vendure/cli` installed there.
    const fromRoot = resolveCliAtNpmPrefix(root);
    if (fromRoot?.dir !== local.dir) {
        return fail(rootCannotResolveCli, {
            root,
            project,
            projectVersion: local.version,
            rootVersion: fromRoot?.version ?? null,
            client: input.client,
        });
    }

    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
    let update: ReturnType<typeof updateClientConfig>;
    try {
        update = updateClientConfig(input.client, existing);
    } catch (e) {
        if (e instanceof ConfigFileUnreadable) {
            return fail(configUnreadable, { file, reason: e.message, client: input.client });
        }
        throw e;
    }
    if (update.action !== 'unchanged') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, update.text);
    }
    return { ...result, action: update.action, file, config: null, command: null };
}

/** The top directory of the git repository the project is in, or `undefined` outside one. */
async function gitRoot(project: string, ctx: CommandContext): Promise<string | undefined> {
    try {
        const { exitCode, stdout } = await ctx.spawn('git', ['rev-parse', '--show-toplevel'], {
            cwd: project,
        });
        if (exitCode === 0 && stdout.trim()) {
            return stdout.trim();
        }
    } catch {
        // git is not installed.
    }
    ctx.notice(
        'info',
        `"${project}" is not in a git repository, so the config is written to the project itself.`,
    );
    return undefined;
}

/**
 * The `@vendure/cli` that `npx` runs when started in `dir`. npx looks only in the `node_modules` of
 * the npm prefix, the nearest directory at or above `dir` with a package.json or a node_modules.
 */
function resolveCliAtNpmPrefix(dir: string): ResolvedCli | undefined {
    let prefix = path.resolve(dir);
    while (
        !fs.existsSync(path.join(prefix, 'package.json')) &&
        !fs.existsSync(path.join(prefix, 'node_modules')) &&
        path.dirname(prefix) !== prefix
    ) {
        prefix = path.dirname(prefix);
    }
    if (!fs.existsSync(path.join(prefix, 'node_modules', '@vendure', 'cli', 'package.json'))) {
        return undefined;
    }
    return resolveCliFrom(prefix);
}

/**
 * Registers the server in Claude Code's local scope, which belongs to this machine and is not
 * checked in, with absolute paths to Node and the project's own CLI. Claude Code owns its config
 * file, so this goes through `claude mcp add`. When `claude` is not on the PATH, the command is
 * returned to run by hand.
 */
async function registerLocally(
    input: Input,
    ctx: CommandContext,
    result: { client: McpClient; scope: 'project' | 'local'; project: string },
    local: ResolvedCli,
    root: string,
) {
    const add = [
        'mcp',
        'add',
        '--scope',
        'local',
        SERVER_NAME,
        '--',
        process.execPath,
        local.bin,
        'mcp',
        '--dir',
        result.project,
    ];
    const command = ['claude', ...add].map(shellQuote).join(' ');
    const done = (action: 'printed' | 'registered' | 'run-yourself') => ({
        ...result,
        action,
        file: null,
        config: null,
        command,
    });
    if (input.print) {
        return done('printed');
    }
    try {
        // Local scope belongs to the folder Claude Code is started in, so it is run from the root.
        let added = await ctx.spawn('claude', add, { cwd: root });
        if (added.exitCode !== 0 && /already exists/i.test(added.stderr + added.stdout)) {
            // Running install again replaces this one entry, and no other.
            await ctx.spawn('claude', ['mcp', 'remove', '--scope', 'local', SERVER_NAME], { cwd: root });
            added = await ctx.spawn('claude', add, { cwd: root });
        }
        if (added.exitCode !== 0) {
            return fail(claudeMcpAddFailed, { command, message: (added.stderr || added.stdout).trim() });
        }
        return done('registered');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            ctx.notice(
                'warning',
                'Claude Code is not on the PATH. Run the command below to register the server.',
            );
            return done('run-yourself');
        }
        throw e;
    }
}

function shellQuote(word: string): string {
    return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
