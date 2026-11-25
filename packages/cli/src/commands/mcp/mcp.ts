import type { CommandErrorDefinition } from '@vendure/common/lib/command';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadMergedManifest } from '../../command-host/manifest.js';
import { AdminProxy } from '../../command-host/mcp/admin-proxy.js';
import { checkProjectCli, findMcpProject } from '../../command-host/mcp/project.js';
import { McpServer, McpToolMode } from '../../command-host/mcp/server.js';

import { cliNotInstalled, notProjectCli, projectAmbiguous } from './mcp.errors.js';

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
        // The plugins of the project the tool calls run in, which `--dir` can move away from here.
        commands: await loadMergedManifest({ pluginOptions: { cwd } }),
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

/** Writes a coded error to stderr, since stdout carries the protocol, and returns its exit code. */
function stop<Details>(error: CommandErrorDefinition<Details>, details: Details): number {
    process.stderr.write(`[${error.code}] ${error.message(details)}\n`);
    return error.exit;
}
