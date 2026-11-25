import type { CommandErrorDefinition } from '@vendure/common/lib/command';
import type { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadMergedManifest, RefusedManifest } from '../../command-host/manifest.js';
import { AdminProxy } from '../../command-host/mcp/admin-proxy.js';
import { checkProjectCli, findMcpProject } from '../../command-host/mcp/project.js';
import { runToolInChild } from '../../command-host/mcp/run-tool-in-child.js';
import { McpServer, McpToolMode } from '../../command-host/mcp/server.js';

import {
    cliNotInstalled,
    commandsListingFailed,
    commandsListingTimedOut,
    notProjectCli,
    projectAmbiguous,
} from './mcp.errors.js';

/**
 * Starts the Developer MCP server on stdio and returns when the client closes the connection.
 * The tool list comes from the manifests only. No command or plugin code is loaded here.
 *
 * MCP clients start the server in the folder they were opened in, so the project is found by
 * walking up from there, and `--dir` overrides that. Stdout carries the protocol, so anything that
 * stops the server is written to stderr, with a code.
 */
export async function runMcpCommand(options: { dir?: string; mode?: string }): Promise<number> {
    const start = path.resolve(options.dir ?? process.cwd());
    if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) {
        process.stderr.write(`The project directory "${start}" does not exist.\n`);
        return 1;
    }
    const mode: McpToolMode = options.mode === 'direct' ? 'direct' : 'discovery';
    if (options.mode && options.mode !== 'direct' && options.mode !== 'discovery') {
        process.stderr.write(`Unknown mode "${options.mode}". Use "discovery" or "direct".\n`);
        return 1;
    }
    const packageRoot = path.join(import.meta.dirname, '..', '..', '..');
    const version = createRequire(import.meta.url)('../../../package.json').version as string;

    const project = findMcpProject(start);
    if (project.kind === 'ambiguous') {
        return stop(projectAmbiguous, { root: project.root, candidates: project.candidates });
    }
    if (project.kind === 'found') {
        const check = checkProjectCli(project.dir, packageRoot, version);
        if (!check.ok && check.reason === 'not-installed') {
            return stop(cliNotInstalled, { project: project.dir });
        }
        if (!check.ok && check.reason === 'other-cli') {
            return stop(notProjectCli, {
                project: project.dir,
                projectVersion: check.local.version,
                running: check.running,
                runningVersion: check.runningVersion,
            });
        }
    }
    // Outside a Vendure project the server still starts: `doctor` and other commands report what
    // is missing themselves.
    const cwd = project.kind === 'found' ? project.dir : start;

    const server = new McpServer({
        commands: await listProjectCommands(cwd),
        mode,
        input: process.stdin,
        output: process.stdout,
        version,
        cwd,
        // The Store MCP's admin tools of the project's dev server. Outside a project they report why
        // they are missing.
        adminTools: new AdminProxy({ projectDir: project.kind === 'found' ? project.dir : undefined }),
    });
    await server.serve();
    return 0;
}

/** How long `vendure commands --json` may take before the server offers the CLI's own commands only. */
const LIST_COMMANDS_TIMEOUT_MS = 5_000;

/**
 * The commands of the project, as `vendure commands --json` lists them in the directory the tool
 * calls run in. A child process lists them because `--dir` can name another project than the one
 * this process started in, and that project's `cliPlugin` commands decide which of its plugins'
 * commands are refused. Refused plugins are written to stderr, which MCP clients keep in their
 * server log.
 *
 * MCP clients give a server a few seconds to start, so after {@link LIST_COMMANDS_TIMEOUT_MS} the
 * server offers the CLI's own commands, with a coded notice on stderr, and stops the child.
 */
async function listProjectCommands(cwd: string): Promise<MergedManifestCommand[]> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timed-out'>(resolve => {
        timer = setTimeout(() => resolve('timed-out'), LIST_COMMANDS_TIMEOUT_MS);
    });
    const listing = runToolInChild(
        ['commands'],
        {},
        {
            cliBin: process.argv[1],
            cwd,
            signal: controller.signal,
            onEvent: () => undefined,
            onLog: () => undefined,
        },
    );
    const envelope = await Promise.race([listing, timedOut]);
    clearTimeout(timer);
    if (envelope === 'timed-out') {
        // The child is stopped in the background. The server does not wait for it.
        controller.abort();
        void listing.catch(() => undefined);
        writeNotice(commandsListingTimedOut, { project: cwd, seconds: LIST_COMMANDS_TIMEOUT_MS / 1000 });
        return loadMergedManifest({ plugins: [] });
    }
    const output = envelope.output as
        | { commands?: MergedManifestCommand[]; refused?: RefusedManifest[] }
        | undefined;
    if (envelope.status !== 'ok' || !Array.isArray(output?.commands)) {
        writeNotice(commandsListingFailed, {
            project: cwd,
            reason: envelope.error?.message ?? envelope.status,
        });
        return loadMergedManifest({ plugins: [] });
    }
    for (const { package: packageName, error } of output.refused ?? []) {
        process.stderr.write(
            `The commands of ${packageName} are not offered: [${error.code}] ${error.message}\n`,
        );
    }
    return output.commands;
}

/** Writes a coded notice to stderr, which MCP clients keep in their server log. */
function writeNotice<Details>(error: CommandErrorDefinition<Details>, details: Details): void {
    process.stderr.write(`[${error.code}] ${error.message(details)}\n`);
}

/** Writes a coded error to stderr, since stdout carries the protocol, and returns its exit code. */
function stop<Details>(error: CommandErrorDefinition<Details>, details: Details): number {
    writeNotice(error, details);
    return error.exit;
}
