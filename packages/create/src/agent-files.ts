/**
 * The agent files of a project, written from one place so every client gets the same content:
 *
 * - `AGENTS.md`, with the project's package manager, and for Claude Code `CLAUDE.md`, which
 *   imports it. With a storefront, Claude Code also gets `apps/storefront/CLAUDE.md`, which
 *   imports the starter's own `AGENTS.md`.
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
import { SERVER_WORKSPACE_DIR, STOREFRONT_WORKSPACE_DIR } from './project-files.js';
import { runCommand } from './steps.js';
import { StorefrontStarter } from './storefront-starters.js';
import { AgentClient } from './types.js';

/** The server `vendure mcp install` adds. It must match `SERVER_NAME` in `@vendure/cli`, which a spec checks. */
export const VENDURE_MCP_SERVER_NAME = 'vendure';
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

/**
 * A client's config with the `vendure-docs` server added, keeping every other server and key of the
 * existing file. Throws when the existing file cannot be read as the client's format.
 *
 * Today only `.vscode/mcp.json` can already exist, because a project directory may hold `.vscode`
 * but not the other clients' files. Claude Code and Codex configs are merged the same way. Cursor's
 * file is written whole by `writeCursorConfig`, so allowing `.cursor` needs a merge there too.
 */
export function withDocsServer(client: AgentClient, existing: string | undefined): string {
    if (existing === undefined || existing.trim() === '') {
        return docsServerConfig(client);
    }
    if (client === 'codex') {
        if (existing.includes(`[mcp_servers.${DOCS_MCP_SERVER_NAME}]`)) {
            return existing;
        }
        return `${existing}${existing.endsWith('\n') ? '\n' : '\n\n'}${docsServerConfig(client)}`;
    }
    const key = client === 'vscode' ? 'servers' : 'mcpServers';
    const config: unknown = JSON.parse(existing);
    const servers = isObject(config) ? (config[key] ?? {}) : undefined;
    if (!isObject(config) || !isObject(servers)) {
        throw new Error(`its "${key}" is not an object`);
    }
    const entry = (JSON.parse(docsServerConfig(client)) as Record<string, Record<string, unknown>>)[key];
    return json({ ...config, [key]: { ...servers, ...entry } });
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    return json({ enabledMcpjsonServers: [VENDURE_MCP_SERVER_NAME, DOCS_MCP_SERVER_NAME] });
}

export interface AgentsMdInput {
    name: string;
    /** The skills copied into `.agents/skills/`. */
    skills: readonly string[];
    /** Whether Claude Code gets its copy of the skills in `.claude/skills/`. */
    claudeSkills: boolean;
    pmInfo: PackageManagerInfo;
    storefront: StorefrontStarter | undefined;
    /** Whether the storefront starter has its own `AGENTS.md`, which the root one points to. */
    storefrontAgentsMd?: boolean;
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
        storefrontAgentsMd: input.storefront !== undefined && input.storefrontAgentsMd === true,
        serverDir: input.storefront ? SERVER_WORKSPACE_DIR : undefined,
        serverPath: input.storefront ? `${SERVER_WORKSPACE_DIR}/` : '',
        skills: input.skills,
        claudeSkills: input.claudeSkills,
        selfHostingGuideUrl: SELF_HOSTING_GUIDE_URL,
    });
}

/** Why `vendure mcp install` could not complete a client's config. */
export interface McpInstallUnavailable {
    /** Which check failed, for code to branch on. `reason` is the text for people. */
    kind: 'inside-another-repository' | 'no-repository-in-workspace' | 'not-installed' | 'failed';
    reason: string;
    /** Whether running `vendure mcp install` again later completes it, as after an install. */
    retryable: boolean;
}

/** `writeAgentFiles` lists the skills itself, from the assets, and looks for the storefront's `AGENTS.md`. */
export interface WriteAgentFilesInput extends Omit<
    AgentsMdInput,
    'skills' | 'claudeSkills' | 'storefrontAgentsMd'
> {
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
    const write: WriteFile = (file, text) => {
        fs.outputFileSync(path.join(input.root, file), text);
        result.written.push(file);
    };

    const skillsDir = path.join(input.assetsDir, 'skills');
    const skills = fs.readdirSync(skillsDir).sort();
    const storefrontAgentsMd =
        input.storefront !== undefined &&
        fs.existsSync(path.join(input.root, STOREFRONT_WORKSPACE_DIR, 'AGENTS.md'));
    write(
        'AGENTS.md',
        renderAgentsMd(fs.readFileSync(path.join(input.assetsDir, 'agents.hbs'), 'utf-8'), {
            ...input,
            skills,
            claudeSkills: input.agents.includes('claude'),
            storefrontAgentsMd,
        }),
    );
    for (const skill of skills) {
        const target = `.agents/skills/${skill}`;
        fs.copySync(path.join(skillsDir, skill), path.join(input.root, target));
        result.written.push(`${target}/`);
    }
    if (input.agents.includes('claude')) {
        write('CLAUDE.md', '@AGENTS.md\n');
        // Claude Code reads a directory's CLAUDE.md, not its AGENTS.md, when it works there.
        const storefrontClaudeMd = `${STOREFRONT_WORKSPACE_DIR}/CLAUDE.md`;
        if (storefrontAgentsMd && !fs.existsSync(path.join(input.root, storefrontClaudeMd))) {
            write(storefrontClaudeMd, '@AGENTS.md\n');
        }
        write('.claude/settings.json', claudeSettings());
        // Claude Code loads project skills only from `.claude/skills/`, so it gets its own copy.
        for (const skill of skills) {
            const target = `.claude/skills/${skill}`;
            fs.copySync(path.join(skillsDir, skill), path.join(input.root, target));
            result.written.push(`${target}/`);
        }
    }

    for (const client of input.agents) {
        const failure =
            client === 'cursor'
                ? await writeCursorConfig(input, write)
                : await writeClientConfig(client, input, write);
        if (failure) {
            result.failed.push(failure);
        }
    }
    return result;
}

type WriteFile = (file: string, text: string) => void;

/**
 * Writes the docs server into a client's config, then lets `vendure mcp install` add its entry
 * beside it. Returns the failure, if any.
 */
async function writeClientConfig(
    client: Exclude<AgentClient, 'cursor'>,
    input: WriteAgentFilesInput,
    write: WriteFile,
): Promise<AgentFileFailure | undefined> {
    const file = CLIENT_CONFIG_FILES[client];
    const target = path.join(input.root, file);
    let config: string;
    try {
        // Inside the try, so a file that is a directory or cannot be read is reported, not thrown.
        const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : undefined;
        config = withDocsServer(client, existing);
    } catch (e) {
        // An existing file create cannot read is left as it is.
        return {
            client,
            reason: `${file} was left as it is, because it could not be read (${e instanceof Error ? e.message : String(e)})`,
            retryable: false,
        };
    }
    write(file, config);
    const installed = input.mcpInstallUnavailable ?? (await installVendureServer(client, input));
    return 'reason' in installed
        ? { client, reason: installed.reason, retryable: installed.retryable }
        : undefined;
}

/**
 * Writes Cursor's config from the entry `vendure mcp install` prints. Running it again cannot
 * complete the file, so a failure is never retryable, and its reason says how to finish.
 */
async function writeCursorConfig(
    input: WriteAgentFilesInput,
    write: WriteFile,
): Promise<AgentFileFailure | undefined> {
    const file = CLIENT_CONFIG_FILES.cursor;
    const installed = input.mcpInstallUnavailable ?? (await installVendureServer('cursor', input));
    if (!('reason' in installed) && installed.printed) {
        let config: string;
        try {
            config = cursorConfig(installed.printed);
        } catch {
            write(file, docsServerConfig('cursor'));
            return {
                client: 'cursor',
                reason: `\`vendure mcp install\` printed an entry that is not JSON. Run ${cursorInstallStep(input.pmInfo.exec)}`,
                retryable: false,
            };
        }
        write(file, config);
        return undefined;
    }
    write(file, docsServerConfig('cursor'));
    if ('reason' in installed && !installed.retryable) {
        // Running it again fails the same way, and the reason says what to do instead.
        return { client: 'cursor', reason: installed.reason, retryable: false };
    }
    const why = 'reason' in installed ? installed.reason : '`vendure mcp install` printed no entry';
    return {
        client: 'cursor',
        reason: `${why.replace(/\.$/, '')}. Run ${cursorInstallStep(input.pmInfo.exec)}`,
        retryable: false,
    };
}

/** How to complete Cursor's config, which `vendure mcp install` only prints. */
export function cursorInstallStep(exec: string): string {
    return `\`${exec} vendure mcp install --client cursor\` and add the entry it prints to ${CLIENT_CONFIG_FILES.cursor}`;
}

/** The commands that add the `vendure` server to each client's config, as one sentence fragment. */
export function mcpInstallSteps(agents: readonly AgentClient[], exec: string): string {
    return agents
        .map(client =>
            client === 'cursor'
                ? cursorInstallStep(exec)
                : `\`${exec} vendure mcp install --client ${client}\``,
        )
        .join(', ');
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
        env: withBinsOnPath(bins),
    });
    if (run.spawnError) {
        return {
            reason: `Could not run \`vendure mcp install\`: ${run.spawnError.message}`,
            kind: 'failed',
            retryable: false,
        };
    }
    const envelope = parseEnvelope(run.stdout);
    if (run.code === 0 && envelope?.status === 'ok') {
        return { printed: envelope.output?.config ?? undefined };
    }
    const detail = run.output.trim() || 'exit code ' + String(run.code);
    return {
        reason: envelope?.error?.message ?? `\`vendure mcp install --client ${client}\` failed: ${detail}`,
        kind: 'failed',
        retryable: false,
    };
}

interface Envelope {
    status?: string;
    output?: { config?: string | null };
    error?: { message?: string };
}

/**
 * The process environment with the project's bins first on the path. Windows names the variable
 * `Path`, so the existing key is reused rather than adding a second `PATH`.
 */
export function withBinsOnPath(
    bins: readonly string[],
    env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    return { ...env, [key]: [...bins, env[key] ?? ''].join(path.delimiter) };
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
