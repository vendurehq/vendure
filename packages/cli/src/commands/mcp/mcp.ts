import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadMergedManifest } from '../../command-host/manifest.js';
import { McpServer, McpToolMode } from '../../command-host/mcp/server.js';

/**
 * Starts the Developer MCP server on stdio and returns when the client closes the connection.
 * The tool list comes from the manifests only. No command or plugin code is loaded here.
 */
export async function runMcpCommand(options: { dir?: string; mode?: string }): Promise<number> {
    const cwd = path.resolve(options.dir ?? process.cwd());
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        process.stderr.write(`The project directory "${cwd}" does not exist.\n`);
        return 1;
    }
    const mode: McpToolMode = options.mode === 'direct' ? 'direct' : 'discovery';
    if (options.mode && options.mode !== 'direct' && options.mode !== 'discovery') {
        process.stderr.write(`Unknown mode "${options.mode}". Use "discovery" or "direct".\n`);
        return 1;
    }
    const version = createRequire(import.meta.url)('../../../package.json').version as string;
    const server = new McpServer({
        commands: loadMergedManifest(),
        mode,
        input: process.stdin,
        output: process.stdout,
        version,
        cwd,
    });
    await server.serve();
    return 0;
}
