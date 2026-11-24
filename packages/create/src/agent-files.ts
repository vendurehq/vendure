import fs from 'fs-extra';
import Handlebars from 'handlebars';
import path from 'node:path';

import { SELF_HOSTING_GUIDE_URL } from './constants.js';
import { PackageManagerInfo } from './package-manager.js';
import { SERVER_WORKSPACE_DIR } from './project-files.js';
import { runCommand } from './steps.js';
import { StorefrontStarter } from './storefront-starters.js';
import { AgentClient, CreateResult } from './types.js';

/**
 * The agent files of a project, written from one place so every client gets the same content:
 *
 * - `AGENTS.md`, with the project's package manager, and for Claude Code `CLAUDE.md`, which
 *   imports it.
 * - `.agents/skills/`: the skills of the Vendure repository, which `build.cts` copies into the
 *   assets.
 * - For each client, its checked-in MCP config. `vendure mcp install` writes the `vendure` server.
 *   Create writes the `vendure-docs` server, and Cursor's whole file, which `vendure mcp install`
 *   only prints.
 * - `.claude/settings.json`, which enables both servers for Claude Code.
 */

export const DOCS_MCP_SERVER_NAME = 'vendure-docs';
export const DOCS_MCP_URL = 'https://docs.vendure.io/mcp';
export const BUNDLED_SKILLS = ['vendure-cli', 'vendure-store-setup', 'vendure-troubleshooting'];

/** Each client's checked-in MCP config, relative to the git root. They match `vendure mcp install`. */
export const CLIENT_CONFIG_FILES: Record<AgentClient, string> = {
    claude: '.mcp.json',
    cursor: '.cursor/mcp.json',
    vscode: '.vscode/mcp.json',
    codex: '.codex/config.toml',
};

/** The `vendure` entry as `vendure mcp install` writes it, for Cursor's file, which it only prints. */
const VENDURE_SERVER = { command: 'npx', args: ['--no', '--offline', '@vendure/cli', 'mcp'] };

/**
 * A client's MCP config with the `vendure-docs` server. `vendure mcp install` then adds the
 * `vendure` server and keeps this one. Cursor's file holds both, because `vendure mcp install`
 * only prints Cursor's entry.
 */
export function docsServerConfig(client: AgentClient): string {
    switch (client) {
        case 'claude':
            return json({ mcpServers: { [DOCS_MCP_SERVER_NAME]: { type: 'http', url: DOCS_MCP_URL } } });
        case 'cursor':
            return json({
                mcpServers: { vendure: VENDURE_SERVER, [DOCS_MCP_SERVER_NAME]: { url: DOCS_MCP_URL } },
            });
        case 'vscode':
            return json({ servers: { [DOCS_MCP_SERVER_NAME]: { type: 'http', url: DOCS_MCP_URL } } });
        case 'codex':
            return `[mcp_servers.${DOCS_MCP_SERVER_NAME}]\nurl = ${JSON.stringify(DOCS_MCP_URL)}\n`;
    }
}

/** Enables both servers, so each person sees only Claude Code's one-time prompt to trust the folder. */
export function claudeSettings(): string {
    return json({ enabledMcpjsonServers: ['vendure', DOCS_MCP_SERVER_NAME] });
}

export interface AgentsMdInput {
    name: string;
    pmInfo: PackageManagerInfo;
    storefront: StorefrontStarter | undefined;
}

export function renderAgentsMd(template: string, input: AgentsMdInput): string {
    return Handlebars.compile(template)({
        name: input.name,
        packageManager: input.pmInfo.name,
        dev: `${input.pmInfo.runScript} dev`,
        build: `${input.pmInfo.runScript} build`,
        typecheck: `${input.pmInfo.runScript} typecheck`,
        exec: input.pmInfo.exec,
        storefront: input.storefront,
        serverDir: input.storefront ? SERVER_WORKSPACE_DIR : undefined,
        serverPath: input.storefront ? `${SERVER_WORKSPACE_DIR}/` : '',
        selfHostingGuideUrl: SELF_HOSTING_GUIDE_URL,
    });
}

export interface WriteAgentFilesInput extends AgentsMdInput {
    agents: readonly AgentClient[];
    /** The project root, which is also the git root when create made a repository. */
    root: string;
    /** The Vendure project: the root, or `apps/server` with a storefront. */
    serverDir: string;
    assetsDir: string;
    /**
     * Why `vendure mcp install` cannot run, for example because the dependencies were not
     * installed. `undefined` when it can.
     */
    mcpInstallUnavailable: string | undefined;
}

export interface AgentFilesResult extends Pick<CreateResult, 'agentFiles'> {
    /** The clients whose files were all written, which the create record names. */
    agents: AgentClient[];
}

export async function writeAgentFiles(input: WriteAgentFilesInput): Promise<AgentFilesResult> {
    const written: string[] = [];
    const failed: Array<{ client: string; reason: string }> = [];
    const agents: AgentClient[] = [];
    if (!input.agents.length) {
        return { agentFiles: { written, failed }, agents };
    }
    const write = (file: string, text: string) => {
        fs.outputFileSync(path.join(input.root, file), text);
        written.push(file);
    };

    write(
        'AGENTS.md',
        renderAgentsMd(fs.readFileSync(path.join(input.assetsDir, 'agents.hbs'), 'utf-8'), input),
    );
    for (const skill of BUNDLED_SKILLS) {
        const target = `.agents/skills/${skill}`;
        fs.copySync(path.join(input.assetsDir, 'skills', skill), path.join(input.root, target));
        written.push(`${target}/`);
    }
    if (input.agents.includes('claude')) {
        write('CLAUDE.md', '@AGENTS.md\n');
        write('.claude/settings.json', claudeSettings());
    }

    for (const client of input.agents) {
        const file = CLIENT_CONFIG_FILES[client];
        write(file, docsServerConfig(client));
        if (client === 'cursor') {
            agents.push(client);
            continue;
        }
        const reason = input.mcpInstallUnavailable ?? (await installVendureServer(client, input));
        if (reason) {
            failed.push({ client, reason });
        } else {
            agents.push(client);
        }
    }
    return { agentFiles: { written, failed }, agents };
}

/**
 * Runs the project's own `vendure mcp install --client <client> --json`, which adds the `vendure`
 * server to the client's config. Returns why it failed, or `undefined`.
 */
async function installVendureServer(
    client: AgentClient,
    input: WriteAgentFilesInput,
): Promise<string | undefined> {
    // The project's own CLI. In a workspace it may be hoisted to the root.
    const bins = [...new Set([input.serverDir, input.root])].map(dir =>
        path.join(dir, 'node_modules', '.bin'),
    );
    const result = await runCommand('vendure', ['mcp', 'install', '--client', client, '--json'], {
        cwd: input.serverDir,
        env: { ...process.env, PATH: [...bins, process.env.PATH ?? ''].join(path.delimiter) },
    });
    if (result.spawnError) {
        return `Could not run \`vendure mcp install\`: ${result.spawnError.message}`;
    }
    const envelope = parseEnvelope(result.stdout);
    if (result.code === 0 && envelope?.status === 'ok') {
        return undefined;
    }
    return (
        envelope?.error?.message ??
        `\`vendure mcp install --client ${client}\` failed: ${result.output.trim() || `exit code ${String(result.code)}`}`
    );
}

function parseEnvelope(stdout: string): { status?: string; error?: { message?: string } } | undefined {
    try {
        return JSON.parse(stdout.slice(stdout.indexOf('{'))) as { status?: string };
    } catch {
        return undefined;
    }
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}
