/**
 * The agent files of a project, written from one place so every client gets the same content:
 *
 * - `AGENTS.md`, with the project's package manager, and for Claude Code `CLAUDE.md`, which
 *   imports it.
 * - `.agents/skills/`: every skill in the assets, which `prepare-assets.cjs` copies from the
 *   repository's `skills/` folder.
 * - For each client, its checked-in MCP config: create writes the `vendure-docs` server, and the
 *   project's own `vendure mcp install` adds the `vendure` server. For Cursor, which
 *   `vendure mcp install` only prints, create writes the printed entry.
 * - `.claude/settings.json`, which enables both servers for Claude Code.
 */
import fs from 'fs-extra';
import Handlebars from 'handlebars';
import path from 'node:path';

import { SELF_HOSTING_GUIDE_URL } from './constants.js';
import { PackageManagerInfo } from './package-manager.js';
import { SERVER_WORKSPACE_DIR } from './project-files.js';
import { runCommand } from './steps.js';
import { StorefrontStarter } from './storefront-starters.js';
import { AgentClient } from './types.js';

export const DOCS_MCP_SERVER_NAME = 'vendure-docs';
export const DOCS_MCP_URL = 'https://docs.vendure.io/mcp';

/**
 * Each client's checked-in MCP config, relative to the git root. They must match `CLIENT_CONFIG`
 * in `@vendure/cli`'s `mcp install`, which a spec checks.
 */
export const CLIENT_CONFIG_FILES: Record<AgentClient, string> = {
    claude: '.mcp.json',
    cursor: '.cursor/mcp.json',
    vscode: '.vscode/mcp.json',
    codex: '.codex/config.toml',
};

/** The `vendure-docs` entry in the form each client's config holds it. */
export function docsServerConfig(client: AgentClient): string {
    switch (client) {
        case 'claude':
            return json({ mcpServers: { [DOCS_MCP_SERVER_NAME]: { type: 'http', url: DOCS_MCP_URL } } });
        case 'cursor':
            return json({ mcpServers: { [DOCS_MCP_SERVER_NAME]: { url: DOCS_MCP_URL } } });
        case 'vscode':
            return json({ servers: { [DOCS_MCP_SERVER_NAME]: { type: 'http', url: DOCS_MCP_URL } } });
        case 'codex':
            return `[mcp_servers.${DOCS_MCP_SERVER_NAME}]\nurl = ${JSON.stringify(DOCS_MCP_URL)}\n`;
    }
}

/**
 * Cursor's config: the `vendure` entry that `vendure mcp install --client cursor` printed, with
 * the `vendure-docs` server added.
 */
export function cursorConfig(printed: string): string {
    const config = JSON.parse(printed) as { mcpServers?: Record<string, unknown> };
    return json({
        ...config,
        mcpServers: { ...config.mcpServers, [DOCS_MCP_SERVER_NAME]: { url: DOCS_MCP_URL } },
    });
}

/** Enables both servers, so each person sees only Claude Code's one-time prompt to trust the folder. */
export function claudeSettings(): string {
    return json({ enabledMcpjsonServers: ['vendure', DOCS_MCP_SERVER_NAME] });
}

export interface AgentsMdInput {
    name: string;
    /** The skills copied into `.agents/skills/`. */
    skills?: readonly string[];
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
        skills: input.skills ?? [],
        selfHostingGuideUrl: SELF_HOSTING_GUIDE_URL,
    });
}

/** Why `vendure mcp install` could not complete a client's config. */
export interface McpInstallUnavailable {
    reason: string;
    /** Whether running `vendure mcp install` again later completes it, as after an install. */
    retryable: boolean;
}

export interface WriteAgentFilesInput extends AgentsMdInput {
    agents: readonly AgentClient[];
    /** The project root, which is the git root when the config can be completed. */
    root: string;
    /** The Vendure project: the root, or `apps/server` with a storefront. */
    serverDir: string;
    assetsDir: string;
    /** Set when `vendure mcp install` cannot run at all. */
    mcpInstallUnavailable: McpInstallUnavailable | undefined;
}

export interface AgentFileFailure {
    client: AgentClient;
    reason: string;
    retryable: boolean;
}

export interface AgentFilesResult {
    written: string[];
    failed: AgentFileFailure[];
}

export async function writeAgentFiles(input: WriteAgentFilesInput): Promise<AgentFilesResult> {
    const result: AgentFilesResult = { written: [], failed: [] };
    if (!input.agents.length) {
        return result;
    }
    const write = (file: string, text: string) => {
        fs.outputFileSync(path.join(input.root, file), text);
        result.written.push(file);
    };

    const skillsDir = path.join(input.assetsDir, 'skills');
    const skills = fs.readdirSync(skillsDir).sort();
    write(
        'AGENTS.md',
        renderAgentsMd(fs.readFileSync(path.join(input.assetsDir, 'agents.hbs'), 'utf-8'), {
            ...input,
            skills,
        }),
    );
    for (const skill of skills) {
        const target = `.agents/skills/${skill}`;
        fs.copySync(path.join(skillsDir, skill), path.join(input.root, target));
        result.written.push(`${target}/`);
    }
    if (input.agents.includes('claude')) {
        write('CLAUDE.md', '@AGENTS.md\n');
        write('.claude/settings.json', claudeSettings());
    }

    for (const client of input.agents) {
        const file = CLIENT_CONFIG_FILES[client];
        // Cursor's file is written from the printed entry below. The others get the docs server
        // first, and `vendure mcp install` adds its entry beside it.
        if (client !== 'cursor') {
            write(file, docsServerConfig(client));
        }
        const installed = input.mcpInstallUnavailable ?? (await installVendureServer(client, input));
        if (client === 'cursor' && !('reason' in installed) && installed.printed) {
            write(file, cursorConfig(installed.printed));
            continue;
        }
        if (client !== 'cursor') {
            if ('reason' in installed) {
                result.failed.push({ client, ...installed });
            }
            continue;
        }
        // `vendure mcp install` only prints Cursor's entry, so running it again cannot complete the
        // file. The reason says how to.
        write(file, docsServerConfig(client));
        const why = 'reason' in installed ? installed.reason : '`vendure mcp install` printed no entry';
        result.failed.push({
            client,
            reason: `${why}. Run \`vendure mcp install --client cursor\` and add the entry it prints to ${file}`,
            retryable: false,
        });
    }
    return result;
}

/**
 * Runs the project's own `vendure mcp install --client <client> --json`, which adds the `vendure`
 * server to the client's config, or for Cursor prints the entry.
 */
async function installVendureServer(
    client: AgentClient,
    input: WriteAgentFilesInput,
): Promise<{ printed?: string } | McpInstallUnavailable> {
    // The project's own CLI. In a workspace it may be hoisted to the root.
    const bins = [...new Set([input.serverDir, input.root])].map(dir =>
        path.join(dir, 'node_modules', '.bin'),
    );
    const run = await runCommand('vendure', ['mcp', 'install', '--client', client, '--json'], {
        cwd: input.serverDir,
        env: { ...process.env, PATH: [...bins, process.env.PATH ?? ''].join(path.delimiter) },
    });
    if (run.spawnError) {
        return {
            reason: `Could not run \`vendure mcp install\`: ${run.spawnError.message}`,
            retryable: false,
        };
    }
    const envelope = parseEnvelope(run.stdout);
    if (run.code === 0 && envelope?.status === 'ok') {
        return { printed: envelope.output?.config ?? undefined };
    }
    return {
        reason:
            envelope?.error?.message ??
            `\`vendure mcp install --client ${client}\` failed: ${run.output.trim() || `exit code ${String(run.code)}`}`,
        retryable: false,
    };
}

interface Envelope {
    status?: string;
    output?: { config?: string | null };
    error?: { message?: string };
}

function parseEnvelope(stdout: string): Envelope | undefined {
    const start = stdout.indexOf('{');
    if (start === -1) {
        return undefined;
    }
    try {
        return JSON.parse(stdout.slice(start)) as Envelope;
    } catch {
        return undefined;
    }
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}
