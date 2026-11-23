/**
 * The project-level MCP config of each client, and how `vendure mcp install` writes the `vendure`
 * entry into it. The entry has no absolute path, so the checked-in file works in every clone and
 * every git worktree: each starts the CLI that its own `node_modules` holds.
 *
 * Every function here is pure. It takes the text of the file, or `undefined` when there is none,
 * and returns the new text.
 */

export const MCP_CLIENTS = ['claude', 'cursor', 'vscode', 'codex'] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

/** The name of the server entry in every client's config. */
export const SERVER_NAME = 'vendure';

/**
 * `--no` and `--offline` stop npx from downloading anything. Without them, npx would install the
 * latest `@vendure/cli` into its cache when the project has none, or retry the registry for a
 * minute when offline. `vendure mcp` itself refuses to run from any CLI but the project's own.
 */
export const SERVER_COMMAND = { command: 'npx', args: ['--no', '--offline', '@vendure/cli', 'mcp'] };

export interface ClientConfigFile {
    /** The path of the config file, relative to the git root. */
    file: string;
    format: 'json' | 'toml';
    /**
     * Whether `vendure mcp install` writes the file. A client whose server working directory is not
     * documented gets the block printed instead, because `npx` and the project search both start
     * from that directory.
     */
    writes: boolean;
}

export const CLIENT_CONFIG: Record<McpClient, ClientConfigFile> = {
    // Claude Code starts the server in the folder it was opened in, and finds `.mcp.json` by
    // walking up from there.
    claude: { file: '.mcp.json', format: 'json', writes: true },
    // Cursor does not document the folder it starts a server in, and has no `cwd` key.
    cursor: { file: '.cursor/mcp.json', format: 'json', writes: false },
    // VS Code starts the server in the workspace folder, and `cwd` makes that explicit.
    vscode: { file: '.vscode/mcp.json', format: 'json', writes: true },
    // Codex reads `.codex/config.toml` in a trusted project and starts the server in its working
    // directory.
    codex: { file: '.codex/config.toml', format: 'toml', writes: true },
};

/** The `vendure` entry as each client spells it. */
export function serverEntry(client: McpClient): Record<string, unknown> {
    if (client === 'vscode') {
        return { type: 'stdio', ...SERVER_COMMAND, cwd: '${workspaceFolder}' };
    }
    return { ...SERVER_COMMAND };
}

/** The key that holds the servers in a client's JSON config. */
function serversKey(client: McpClient): string {
    return client === 'vscode' ? 'servers' : 'mcpServers';
}

/** The file could not be read as the config the client expects, so it was left alone. */
export class ConfigFileUnreadable extends Error {}

export interface ConfigUpdate {
    text: string;
    action: 'created' | 'updated' | 'unchanged';
}

/**
 * Writes the `vendure` entry into a client's config and leaves every other entry and key as it
 * was. Running it again with the same entry changes nothing.
 */
export function updateClientConfig(client: McpClient, existing: string | undefined): ConfigUpdate {
    return CLIENT_CONFIG[client].format === 'toml'
        ? updateTomlConfig(existing)
        : updateJsonConfig(client, existing);
}

/** The block to add to a client's config by hand, as `--print` shows it. */
export function configBlock(client: McpClient): string {
    return updateClientConfig(client, undefined).text;
}

function updateJsonConfig(client: McpClient, existing: string | undefined): ConfigUpdate {
    const key = serversKey(client);
    const entry = serverEntry(client);
    if (existing === undefined || existing.trim() === '') {
        return { text: toJson({ [key]: { [SERVER_NAME]: entry } }), action: 'created' };
    }
    let config: unknown;
    try {
        config = JSON.parse(existing);
    } catch (e) {
        throw new ConfigFileUnreadable(`it is not valid JSON (${(e as Error).message})`);
    }
    if (!isPlainObject(config)) {
        throw new ConfigFileUnreadable('it is not a JSON object');
    }
    const servers = config[key] ?? {};
    if (!isPlainObject(servers)) {
        throw new ConfigFileUnreadable(`its "${key}" is not an object`);
    }
    if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) {
        return { text: existing, action: 'unchanged' };
    }
    const action = servers[SERVER_NAME] === undefined ? 'created' : 'updated';
    return { text: toJson({ ...config, [key]: { ...servers, [SERVER_NAME]: entry } }), action };
}

function toJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TOML_TABLE = `[mcp_servers.${SERVER_NAME}]`;

/** The `vendure` table in TOML. Strings are written as JSON strings, which TOML accepts. */
function tomlTable(): string {
    const args = SERVER_COMMAND.args.map(arg => JSON.stringify(arg)).join(', ');
    return `${TOML_TABLE}\ncommand = ${JSON.stringify(SERVER_COMMAND.command)}\nargs = [${args}]\n`;
}

/**
 * Replaces the `[mcp_servers.vendure]` table, with any of its sub-tables, or appends it. Other
 * tables, keys and comments stay as they were. A `vendure` server written in another form, such as
 * dotted keys or an inline table, is refused rather than duplicated.
 */
function updateTomlConfig(existing: string | undefined): ConfigUpdate {
    const table = tomlTable();
    if (existing === undefined || existing.trim() === '') {
        return { text: table, action: 'created' };
    }
    const lines = existing.split('\n');
    const isHeader = (line: string) => /^\s*\[/.test(line);
    // A header without its trailing comment and whitespace, such as `[mcp_servers.vendure]`.
    const headerOf = (line: string) => line.replace(/#.*$/, '').replace(/\s+/g, '');
    const isOwnHeader = (line: string) => {
        const header = headerOf(line);
        return header === TOML_TABLE || header.startsWith(`[mcp_servers.${SERVER_NAME}.`);
    };
    // Any other header that names the server, such as `[mcp_servers."vendure"]`, would make this
    // function add a second table for it, which leaves the file invalid.
    const otherHeader = lines.find(
        line => isHeader(line) && !isOwnHeader(line) && headerOf(line).includes(SERVER_NAME),
    );
    if (otherHeader) {
        throw new ConfigFileUnreadable(
            `it has the header ${otherHeader.trim()}, which this command does not edit`,
        );
    }
    const start = lines.findIndex(isOwnHeader);
    // A key named `vendure`, as in `vendure = { ... }` under `[mcp_servers]` or the dotted
    // `mcp_servers.vendure.command = ...`, outside the tables this function manages.
    const ownKey = new RegExp(`(^|[\\s.{,])${SERVER_NAME}\\s*[.=]`);
    const otherForm = lines.some(
        (line, index) =>
            !isHeader(line) &&
            !isWithinOwnTables(lines, index, isHeader, isOwnHeader) &&
            ownKey.test(line.replace(/#.*$/, '')),
    );
    if (otherForm) {
        throw new ConfigFileUnreadable(
            `it defines the "${SERVER_NAME}" server outside a ${TOML_TABLE} table`,
        );
    }
    if (start === -1) {
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        return { text: `${existing}${separator}${table}`, action: 'created' };
    }
    // The own tables run until the next header that is not one of them.
    let end = start + 1;
    while (end < lines.length && !(isHeader(lines[end]) && !isOwnHeader(lines[end]))) {
        end++;
    }
    const current = lines.slice(start, end).join('\n').trim();
    if (current === table.trim()) {
        return { text: existing, action: 'unchanged' };
    }
    const before = lines.slice(0, start).join('\n');
    const after = lines.slice(end).join('\n');
    const text = [before, table.trimEnd(), after].filter(part => part !== '').join('\n');
    return { text: text.endsWith('\n') ? text : `${text}\n`, action: 'updated' };
}

/** Whether a line belongs to the `vendure` table or one of its sub-tables. */
function isWithinOwnTables(
    lines: string[],
    index: number,
    isHeader: (line: string) => boolean,
    isOwnHeader: (line: string) => boolean,
): boolean {
    for (let i = index; i >= 0; i--) {
        if (isHeader(lines[i])) {
            return isOwnHeader(lines[i]);
        }
    }
    return false;
}
