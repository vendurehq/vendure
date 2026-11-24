/* eslint-disable no-console */
/**
 * Generates the CLI reference in `docs/docs/reference/cli/` from the command manifest of
 * `@vendure/cli` (`packages/cli/dist/vendure-commands.json`), which the CLI build writes. Every
 * command declared with `defineCommand` gets a section on the page of its top-level group. The
 * index lists the built-in commands that are not declared with `defineCommand` yet, with their
 * descriptions.
 *
 * Build `@vendure/cli` first, then run `bun run docs:generate-cli-docs`.
 */
import { deleteGeneratedDocs } from '@vendure-io/docs-generator';
import {
    MergedManifestCommand,
    mergeManifests,
    readManifestFile,
} from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '../..');
const cliDist = path.join(repoRoot, 'packages/cli/dist');
const manifestPath = path.join(cliDist, 'vendure-commands.json');
const outputPath = path.join(repoRoot, 'docs/docs/reference/cli');
const docsUrl = '/reference/cli';
const cliGuideUrl = '/guides/developer-guide/cli/';

type JsonSchema = Record<string, any>;

/** The parts of a Commander command definition of `@vendure/cli` that the index reads. */
interface BuiltinCommand {
    name: string;
    description: string;
    action?: unknown;
    subcommands?: BuiltinCommand[];
}

/** The naming and exposure rules of the built CLI, so the reference names what the CLI uses. */
interface CliRules {
    kebab(name: string): string;
    compareCodeUnits(a: string, b: string): number;
    toolName(command: { path: string[] }): string;
    isExposed(command: MergedManifestCommand): boolean;
}

let rules: CliRules;

const BEHAVIORS: Record<MergedManifestCommand['behavior'], string> = {
    readonly: 'Read-only. It changes nothing.',
    mutating: 'Changes files, the database or the dev server.',
    destructive: 'Can destroy data. It asks for a named consent first.',
    service: 'Keeps running until it is stopped.',
};

void main();

async function main() {
    if (!fs.existsSync(manifestPath)) {
        console.error(`${manifestPath} does not exist. Build @vendure/cli first.`);
        process.exit(1);
    }
    const commands = mergeManifests([readManifestFile(manifestPath)]);
    const builtins = await loadBuiltinCommands();
    rules = await loadCliRules();

    deleteGeneratedDocs(outputPath);
    fs.mkdirSync(outputPath, { recursive: true });

    const groups = groupByFirstSegment(commands);
    for (const [group, commands] of groups) {
        writeFile(`${group}.mdx`, renderGroupPage(group, commands, builtins));
    }
    writeFile('index.mdx', renderIndex(groups, builtins));
    console.log(`Generated the CLI reference for ${commands.length} commands in ${outputPath}`);
}

async function loadCliRules(): Promise<CliRules> {
    const naming = await import(path.join(cliDist, 'command-host/naming.js'));
    const server = await import(path.join(cliDist, 'command-host/mcp/server.js'));
    return {
        kebab: naming.kebab,
        compareCodeUnits: naming.compareCodeUnits,
        toolName: server.toolName,
        isExposed: server.isExposed,
    };
}

async function loadBuiltinCommands(): Promise<BuiltinCommand[]> {
    const modulePath = path.join(cliDist, 'commands/builtins.js');
    const { builtinCommandDefs } = (await import(modulePath)) as { builtinCommandDefs: BuiltinCommand[] };
    return builtinCommandDefs;
}

function groupByFirstSegment(commands: MergedManifestCommand[]): Map<string, MergedManifestCommand[]> {
    const groups = new Map<string, MergedManifestCommand[]>();
    const sorted = [...commands].sort((a, b) => rules.compareCodeUnits(a.path.join(' '), b.path.join(' ')));
    for (const command of sorted) {
        const group = command.path[0];
        groups.set(group, [...(groups.get(group) ?? []), command]);
    }
    return new Map([...groups].sort(([a], [b]) => rules.compareCodeUnits(a, b)));
}

function writeFile(name: string, content: string) {
    fs.writeFileSync(path.join(outputPath, name), content);
}

function frontMatter(title: string): string {
    return `---\ntitle: "${title}"\ngenerated: true\n---\n\n`;
}

function renderIndex(groups: Map<string, MergedManifestCommand[]>, builtins: BuiltinCommand[]): string {
    const lines = [
        frontMatter('CLI'),
        'The reference of the `vendure` commands that `@vendure/cli` declares with `defineCommand`. It is ' +
            'generated from the command manifest of the CLI, `vendure-commands.json`.',
        '',
        'Run `vendure commands --json` in a project for the commands it really has, including those that ' +
            'plugins add' +
            (groups.has('guide') ? ', and `vendure guide` for how an agent works with the CLI.' : '.'),
        '',
        '## Every command',
        '',
        '| Command | Behavior | Description |',
        '| ------- | -------- | ----------- |',
    ];
    for (const [group, commands] of groups) {
        for (const command of commands) {
            lines.push(
                `| [\`vendure ${command.path.join(' ')}\`](${docsUrl}/${group}#${anchor(command)}) | ` +
                    `${command.behavior} | ${cell(command.description)} |`,
            );
        }
    }
    lines.push(
        '',
        '## Options of every command',
        '',
        '| Option | Description |',
        '| ------ | ----------- |',
        '| `--json` | Write one JSON document to stdout, and events to stderr. `--format json` is an alias. |',
        '| `--input <json\\|->` | Pass the whole input as a JSON document, or read it from stdin with `-`. |',
        '',
        'With `--json`, a command writes one envelope: `{ schemaVersion, status, output, needs, error, notices }`. ' +
            '`status` is `ok`, `failed`, `incomplete` or `error`. See ' +
            `[JSON output for scripts and agents](${cliGuideUrl}#json-output-for-scripts-and-agents).`,
    );

    const notPorted = notPortedCommands(groups, builtins);
    if (notPorted.length) {
        lines.push(
            '',
            '## Commands without a generated reference',
            '',
            'These commands are not declared with `defineCommand` yet, so they have no generated reference. ' +
                'Run `vendure <command> --help` for their options. ' +
                `The [CLI guide](${cliGuideUrl}) covers several of them.`,
            '',
            ...notPorted.map(
                builtin =>
                    `- \`vendure ${builtin.name}\`: ${escapeMdx(sentence(builtin.description))}` +
                    (groups.has(builtin.name)
                        ? ` Its subcommands are on the [\`vendure ${builtin.name}\`](${docsUrl}/${builtin.name}) page.`
                        : ''),
            ),
        );
    }
    return lines.join('\n') + '\n';
}

/**
 * The built-in commands that have no generated reference: one that runs an action of its own with
 * no `defineCommand` command at its path, or a group with no `defineCommand` command below it.
 */
function notPortedCommands(groups: Map<string, MergedManifestCommand[]>, builtins: BuiltinCommand[]) {
    return builtins.filter(builtin => {
        const ported = groups.get(builtin.name) ?? [];
        if (builtin.action) {
            return !ported.some(command => command.path.length === 1);
        }
        return ported.length === 0;
    });
}

function renderGroupPage(
    group: string,
    commands: MergedManifestCommand[],
    builtins: BuiltinCommand[],
): string {
    const lines = [frontMatter(`vendure ${group}`)];
    const builtin = builtins.find(b => b.name === group);
    // A built-in that runs an action of its own describes that action, not the group.
    if (builtin && !builtin.action && commands.every(command => command.path.length > 1)) {
        lines.push(escapeMdx(sentence(builtin.description)), '');
    }
    for (const command of commands) {
        lines.push(...renderCommand(command), '');
    }
    return lines.join('\n').replace(/\n+$/, '\n');
}

function renderCommand(command: MergedManifestCommand): string[] {
    const name = command.path.join(' ');
    const properties = (command.input.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set<string>((command.input.required as string[] | undefined) ?? []);
    const positional = command.cli.positional ?? [];
    const lines = [
        `<a name="${anchor(command)}"></a>`,
        '',
        `## vendure ${name}`,
        '',
        escapeMdx(sentence(command.description)),
        '',
        '```bash',
        `vendure ${[name, ...positional.map(field => `[${rules.kebab(field)}]`)].join(' ')}` +
            (Object.keys(properties).length > positional.length ? ' [options]' : ''),
        '```',
        '',
        `- **Behavior:** \`${command.behavior}\`. ${BEHAVIORS[command.behavior]}`,
        rules.isExposed(command)
            ? `- **Developer MCP tool:** \`${rules.toolName(command)}\``
            : '- **Developer MCP tool:** none. This command runs only on the command line.',
    ];
    if (command.hasPlan) {
        lines.push('- Shows a preview of what it will do before it asks for consent.');
    }

    // Consents are fields too, but they have their own section.
    const options = Object.entries(properties).filter(([field]) => !(field in command.consents));
    if (options.length) {
        lines.push(
            '',
            '### Options',
            '',
            '| Option | Type | Description |',
            '| ------ | ---- | ----------- |',
        );
        for (const [field, schema] of options) {
            lines.push(
                `| ${renderFlag(command, field, schema, positional)} | ${renderType(schema)} | ` +
                    `${cell(describeField(command, field, schema, required))} |`,
            );
        }
    }

    const consents = Object.entries(command.consents);
    if (consents.length) {
        lines.push(
            '',
            '### Consents',
            '',
            'Without the consent, the command returns `incomplete` with a preview and a digest. Pass the ' +
                'digest as the value of the consent to run it. `--yes` never grants a consent.',
            '',
        );
        for (const [consent, description] of consents) {
            lines.push(`- \`--${rules.kebab(consent)} <digest>\`: ${escapeMdx(description)}`);
        }
    }

    const output = command.output?.properties as Record<string, JsonSchema> | undefined;
    if (output && Object.keys(output).length) {
        lines.push('', '### Output', '', '| Field | Type | Description |', '| ----- | ---- | ----------- |');
        const outputRequired = new Set<string>((command.output?.required as string[] | undefined) ?? []);
        for (const [field, schema] of Object.entries(output)) {
            lines.push(
                `| \`${field}\`${outputRequired.has(field) ? '' : ' (optional)'} | ${renderType(schema)} | ` +
                    `${cell(schema.description ? sentence(String(schema.description)) : '')} |`,
            );
        }
    }

    if (command.errors.length) {
        lines.push('', '### Errors', '');
        for (const error of command.errors) {
            lines.push(`- \`${error.code}\` (exit code ${error.exit})`);
        }
    }

    if (command.examples.length) {
        lines.push('', '### Examples', '', '```bash', ...command.examples, '```');
    }
    return lines;
}

function renderFlag(command: MergedManifestCommand, field: string, schema: JsonSchema, positional: string[]) {
    const short = command.cli.flags?.[field]?.short;
    const type = primaryType(schema);
    const placeholder = rules.kebab(field);
    const value = type === 'boolean' ? '' : type === 'array' ? ` <${placeholder}...>` : ` <${placeholder}>`;
    const flags = [`\`--${rules.kebab(field)}${escapeCode(value)}\``];
    if (short) {
        flags.unshift(`\`${short}\``);
    }
    if (type === 'boolean') {
        flags.push(`\`--no-${rules.kebab(field)}\``);
    }
    if (positional.includes(field)) {
        flags.unshift(`\`[${rules.kebab(field)}]\``);
    }
    return flags.join(', ');
}

function describeField(
    command: MergedManifestCommand,
    field: string,
    schema: JsonSchema,
    required: Set<string>,
) {
    const parts: string[] = [];
    if (required.has(field)) {
        parts.push('Required.');
    }
    if (schema.description) {
        parts.push(sentence(String(schema.description)));
    }
    if (schema.default !== undefined) {
        parts.push(`Default: \`${JSON.stringify(schema.default)}\`.`);
    }
    const meta = command.cli.fields?.[field];
    // The host asks for every missing required field in a terminal, and for an optional field only
    // when it declares `prompt`.
    if (meta?.prompt && !required.has(field)) {
        parts.push('Asked for in an interactive terminal.');
    }
    if (meta?.hasChoices && !Array.isArray(schema.enum)) {
        parts.push('The valid values depend on the project, and an `input` need lists them.');
    }
    return parts.join(' ');
}

function primaryType(schema: JsonSchema): string | undefined {
    return Array.isArray(schema.type) ? schema.type[0] : schema.type;
}

function renderType(schema: JsonSchema): string {
    return cell(typeText(schema));
}

function typeText(schema: JsonSchema): string {
    if (Array.isArray(schema.enum)) {
        return schema.enum.map((value: unknown) => `\`${JSON.stringify(value)}\``).join(' or ');
    }
    if (schema.const !== undefined) {
        return `\`${JSON.stringify(schema.const)}\``;
    }
    const variants = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(variants)) {
        return variants.map((variant: JsonSchema) => typeText(variant)).join(' or ');
    }
    const type = primaryType(schema);
    if (type === 'array') {
        return schema.items ? `array of ${typeText(schema.items)}` : 'array';
    }
    if (type === 'integer') {
        return 'number';
    }
    return type ?? 'any';
}

function anchor(command: MergedManifestCommand): string {
    return command.path.join('-').toLowerCase();
}

/** Escapes the characters MDX would read as JSX or expressions outside code. */
function escapeMdx(text: string): string {
    return text.replace(/[{}<>]/g, c => `\\${c}`);
}

/** A table cell: one line, with `|` escaped. Code spans keep `<` and `{` as they are. */
function cell(text: string): string {
    return text
        .split(/(`[^`]*`)/)
        .map(part => (part.startsWith('`') ? part : escapeMdx(part)))
        .join('')
        .replace(/\|/g, '\\|')
        .replace(/\n+/g, ' ');
}

function escapeCode(text: string): string {
    return text.replace(/\|/g, '\\|');
}

function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`;
}
