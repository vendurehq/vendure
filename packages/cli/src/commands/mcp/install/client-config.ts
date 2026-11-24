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
    const text = toJson({ ...config, [key]: { ...servers, [SERVER_NAME]: entry } }, indentOf(existing));
    return { text, action };
}

/** The file's own indentation, so that adding the entry does not reformat every line. */
function indentOf(text: string): string | number {
    return /^([ \t]+)\S/m.exec(text)?.[1] ?? 2;
}

function toJson(value: unknown, indent: string | number = 2): string {
    return `${JSON.stringify(value, null, indent)}\n`;
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
 * dotted keys or an inline table, is refused rather than duplicated. The JSON configs keep their
 * indentation the same way.
 */
function updateTomlConfig(existing: string | undefined): ConfigUpdate {
    const table = tomlTable();
    if (existing === undefined || existing.trim() === '') {
        return { text: table, action: 'created' };
    }
    const lines = existing.split('\n');
    const isHeader = (line: string) => /^\s*\[/.test(line);
    // The `vendure` table and its sub-tables, however the key is quoted, such as
    // `[mcp_servers."vendure"]` or `[mcp_servers.vendure.env] # comment`.
    const isOwnHeader = (line: string) => {
        const keys = headerKeys(line);
        return keys[0] === 'mcp_servers' && keys[1] === SERVER_NAME;
    };
    const start = lines.findIndex(isOwnHeader);
    // A key named `vendure`, as in `vendure = { ... }` under `[mcp_servers]` or the dotted
    // `mcp_servers.vendure.command = ...`, outside the tables this function manages.
    const otherForm = lines.some(
        (line, index) =>
            !isHeader(line) &&
            !isWithinOwnTables(lines, index, isHeader, isOwnHeader) &&
            namesServerKey(line),
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
    // The own tables run until the next header that is not one of them. Blank lines and comments
    // just before that header belong to it, so they stay.
    let end = start + 1;
    while (end < lines.length && !(isHeader(lines[end]) && !isOwnHeader(lines[end]))) {
        end++;
    }
    while (end > start + 1 && (lines[end - 1].trim() === '' || lines[end - 1].trimStart().startsWith('#'))) {
        end--;
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

/** A TOML line without its comment. */
function withoutComment(line: string): string {
    const hash = line.indexOf('#');
    return hash === -1 ? line : line.slice(0, hash);
}

/** The dotted keys of a TOML table header, without quotes: `[a."b.c"]` gives `['a', 'b.c']`. */
function headerKeys(line: string): string[] {
    const header = withoutComment(line).trim();
    let start = 0;
    let end = header.length;
    while (header[start] === '[') {
        start++;
    }
    while (end > start && header[end - 1] === ']') {
        end--;
    }
    const keys: string[] = [];
    let key = '';
    let quote: string | undefined;
    for (const char of header.slice(start, end)) {
        if (quote && char === quote) {
            quote = undefined;
        } else if (quote) {
            key += char;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '.') {
            keys.push(key.trim());
            key = '';
        } else {
            key += char;
        }
    }
    keys.push(key.trim());
    return keys;
}

/** Whether a line uses `vendure` as a key, as in `vendure = ...` or `mcp_servers.vendure.command = ...`. */
function namesServerKey(line: string): boolean {
    // String values are blanked first, so a value such as "https://docs.vendure.io/mcp" is not
    // read as a `vendure.` key. Quoted keys, which come before the `=`, are kept.
    const text = withoutComment(line).replace(/=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g, '= ""');
    for (let at = text.indexOf(SERVER_NAME); at !== -1; at = text.indexOf(SERVER_NAME, at + 1)) {
        const before = at === 0 ? ' ' : text[at - 1];
        const after = text.slice(at + SERVER_NAME.length).trimStart();
        if (' \t.{,'.includes(before) && (after.startsWith('.') || after.startsWith('='))) {
            return true;
        }
    }
    return false;
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
