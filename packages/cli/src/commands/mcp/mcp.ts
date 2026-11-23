import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadMergedManifest } from '../../command-host/manifest.js';
import { checkProjectCli, findMcpProject, ProjectCliCheck } from '../../command-host/mcp/project.js';
import { McpServer, McpToolMode } from '../../command-host/mcp/server.js';

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

    let cwd = start;
    const project = findMcpProject(start);
    if (project.kind === 'found') {
        cwd = project.dir;
        const check = checkProjectCli(project.dir, packageRoot, version);
        if (!check.ok) {
            process.stderr.write(`${projectCliMessage(check)}\n`);
            return 1;
        }
    } else if (project.kind === 'ambiguous') {
        process.stderr.write(
            `[mcp.project-ambiguous] "${project.root}" holds more than one Vendure project. ` +
                `Start the server with --dir and one of: ${project.candidates.join(', ')}\n`,
        );
        cwd = project.root;
    }

    const server = new McpServer({
        commands: await loadMergedManifest(),
        mode,
        input: process.stdin,
        output: process.stdout,
        version,
        cwd,
    });
    await server.serve();
    return 0;
}

/** Why the running CLI is not the project's own, for stderr. */
export function projectCliMessage(check: Exclude<ProjectCliCheck, { ok: true }>): string {
    if (check.reason === 'not-installed') {
        return (
            `[mcp.cli-not-installed] The project in "${check.project}" does not install @vendure/cli, so this ` +
            `@vendure/cli ${check.runningVersion} from "${check.running}" will not serve it. ` +
            `Add @vendure/cli as a devDependency of the project.`
        );
    }
    return (
        `[mcp.not-project-cli] The project in "${check.project}" installs @vendure/cli ${check.local.version}, ` +
        `but this is @vendure/cli ${check.runningVersion} from "${check.running}", for example a global install ` +
        `that npx fell back to. Start the server from the project, where npx runs the project's own CLI.`
    );
}
