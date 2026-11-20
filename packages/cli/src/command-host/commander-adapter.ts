import {
    COMMAND_ENVELOPE_SCHEMA_VERSION,
    CommandDefinition,
    CommandEnvelope,
    CommandEvent,
} from '@vendure/common/lib/command';
import { Command, Option } from 'commander';
import fs from 'node:fs';

import { findVendureProjectRoot } from '../shared/project-validation.js';
import { isNonInteractiveEnvironment } from '../utilities/utils.js';

import { hostErrors } from './host-errors.js';
import { executeCommand, HostEnvironment, HostResult } from './host.js';
import { MergedManifestCommand } from './manifest.js';
import { presentForPeople } from './present.js';
import { createClackPrompter } from './prompter.js';
import { createSpawn } from './spawn.js';
import { JsonOutput, redirectStdoutToStderr } from './stdio.js';

/** How long a command has to stop after it is cancelled, before the host gives up on it. */
const CANCEL_GRACE_MS = 10_000;

export interface AdapterOptions {
    /**
     * Loads the command declarations. Called only when a command runs, never to build the
     * command line, which is built from the manifest alone.
     */
    loadDefinitions(): Promise<CommandDefinition[]>;
}

function kebab(name: string): string {
    return name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/**
 * Whether the arguments ask for `--json`, or for `--format json`, its alias. Read from the raw
 * arguments because it has to work when Commander itself rejects them.
 */
export function jsonRequested(argv: readonly string[]): boolean {
    const dashDash = argv.indexOf('--');
    const args = dashDash === -1 ? argv : argv.slice(0, dashDash);
    return (
        args.includes('--json') ||
        args.includes('--format=json') ||
        args.some((arg, index) => arg === '--format' && args[index + 1] === 'json')
    );
}

function findChild(parent: Command, name: string): Command | undefined {
    return parent.commands.find(command => command.name() === name);
}

/**
 * Adds the commands of a manifest to a Commander program. Every field is an optional flag, so
 * that Commander never rejects a run before the host has read `--input` and decided what is
 * missing. A command goes under the group that already exists for its path, such as `add`.
 */
export function registerManifestCommands(
    program: Command,
    commands: MergedManifestCommand[],
    options: AdapterOptions,
): void {
    for (const manifestCommand of commands) {
        let parent = program;
        for (const segment of manifestCommand.path.slice(0, -1)) {
            let group = findChild(parent, segment);
            if (!group) {
                group = parent.command(segment).description(`${segment} commands`);
            }
            parent = group;
        }
        registerLeaf(parent, manifestCommand, options);
    }
}

function registerLeaf(parent: Command, manifestCommand: MergedManifestCommand, options: AdapterOptions) {
    const name = manifestCommand.path[manifestCommand.path.length - 1];
    const existing = findChild(parent, name);
    if (existing) {
        // A CLI plugin already replaced this command. The plugin's command wins.
        const via = /^Commands from (.+):$/.exec(existing.helpGroup())?.[1];
        if (via) {
            process.stderr.write(`Replaced command "${manifestCommand.path.join(' ')}" via ${via}\n`);
        }
        return;
    }
    const command = parent.command(name).description(manifestCommand.description);
    const positional = manifestCommand.cli.positional ?? [];
    const properties = (manifestCommand.input.properties ?? {}) as Record<string, Record<string, any>>;

    for (const field of positional) {
        command.argument(`[${kebab(field)}]`, properties[field]?.description);
    }
    for (const [field, schema] of Object.entries(properties)) {
        if (positional.includes(field)) {
            continue;
        }
        const flag = `--${kebab(field)}`;
        const short = manifestCommand.cli.flags?.[field]?.short;
        const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
        const placeholder = field in manifestCommand.consents ? 'digest' : kebab(field);
        const value = type === 'array' ? ` <${placeholder}...>` : ` <${placeholder}>`;
        const flags = `${short ? `${short}, ` : ''}${flag}${type === 'boolean' ? '' : value}`;
        const option = new Option(flags, (schema.description as string | undefined) ?? '');
        if (type === 'number' || type === 'integer') {
            option.argParser(raw => Number(raw));
        }
        if (Array.isArray(schema.enum) && type === 'string') {
            option.choices(schema.enum as string[]);
        }
        command.addOption(option);
    }
    command.addOption(new Option('--json', 'Write one JSON document to stdout, and events to stderr'));
    command.addOption(new Option('--input <json|->', 'Pass the whole input as a JSON document'));
    command.addOption(new Option('--format <type>', 'Alias for --json when set to "json"').hideHelp());

    command.configureOutput({
        writeErr: text => {
            if (!jsonRequested(process.argv)) {
                process.stderr.write(text);
            }
        },
    });
    command.exitOverride(error => {
        const passThrough =
            error.exitCode === 0 || error.code === 'commander.help' || error.code === 'commander.version';
        if (jsonRequested(process.argv) && !passThrough) {
            const result = hostResultFor(hostErrors.usage, {
                message: error.message.replace(/^error: /, ''),
            });
            fs.writeSync(1, `${JSON.stringify(result.envelope)}\n`);
            process.exit(result.exitCode);
        }
        process.exit(error.exitCode);
    });

    command.action(async (...args: any[]) => {
        const opts = command.opts();
        const positionalValues = Object.fromEntries(
            positional.map((field, index) => [field, args[index] as unknown]),
        );
        const code = await runLeaf(manifestCommand, command, positionalValues, opts, options);
        process.exit(code);
    });
}

function hostResultFor(
    error: { code: string; exit: number; message: (d: any) => string },
    details: unknown,
): HostResult {
    const envelope: CommandEnvelope = {
        schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
        status: 'error',
        error: { code: error.code, exit: error.exit, message: error.message(details) },
        notices: [],
    };
    return { envelope, exitCode: error.exit };
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

async function readInputDocument(source: string): Promise<Record<string, unknown>> {
    const text = source === '-' ? await readStdin() : source;
    const parsed = text.trim() === '' ? {} : JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The document must be a JSON object');
    }
    return parsed as Record<string, unknown>;
}

/** Wires cancellation: SIGINT, SIGTERM, and a `cancel` message over IPC from `vendure mcp`. */
function createCancellation(): AbortController {
    const controller = new AbortController();
    let cancelledAt = 0;
    const cancel = () => {
        if (controller.signal.aborted) {
            // A second request, after the first has had a moment, means the command did not stop.
            // `vendure mcp` sends a message and then a signal, which are one request.
            if (Date.now() - cancelledAt > 500) {
                process.exit(130);
            }
            return;
        }
        cancelledAt = Date.now();
        controller.abort();
    };
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    if (process.send) {
        process.on('message', message => {
            if ((message as { type?: string } | null)?.type === 'cancel') {
                cancel();
            }
        });
        // The channel alone must not keep the process alive.
        process.channel?.unref?.();
    }
    return controller;
}

async function runLeaf(
    manifestCommand: MergedManifestCommand,
    command: Command,
    positionalValues: Record<string, unknown>,
    opts: Record<string, any>,
    options: AdapterOptions,
): Promise<number> {
    const json = opts.json === true || opts.format === 'json';
    const out: JsonOutput | undefined = json ? redirectStdoutToStderr() : undefined;
    const controller = createCancellation();
    const properties = Object.keys(manifestCommand.input.properties ?? {});

    const finish = async (hostResult: HostResult, definition?: CommandDefinition): Promise<number> => {
        if (out) {
            await out.writeEnvelope(hostResult.envelope);
        } else if (definition) {
            await presentForPeople(definition, hostResult);
        } else if (hostResult.envelope.error) {
            process.stderr.write(`${hostResult.envelope.error.message}\n`);
        }
        return hostResult.exitCode;
    };

    let input: Record<string, unknown> = {};
    try {
        if (typeof opts.input === 'string') {
            input = await readInputDocument(opts.input);
        }
    } catch (e) {
        return finish(hostResultFor(hostErrors.inputUnreadable, { reason: (e as Error).message }));
    }
    // Flags the caller set win over the same field in the document.
    for (const field of properties) {
        const source = command.getOptionValueSource(field);
        if (opts[field] !== undefined && source !== 'default') {
            input[field] = opts[field];
            continue;
        }
        // A group that is also a command, such as `add`, reads its own options before it passes
        // the rest on. A field with the same name as one of them arrives there.
        const inherited = ancestorOptionValue(command, field);
        if (inherited !== undefined) {
            input[field] = inherited;
        }
    }
    for (const [field, value] of Object.entries(positionalValues)) {
        if (value !== undefined) {
            input[field] = value;
        }
    }

    const definitions = await options.loadDefinitions();
    const key = manifestCommand.path.join(' ');
    const def = definitions.find(candidate => candidate.path.join(' ') === key);
    const mismatch = def ? findMismatch(def, manifestCommand) : 'the command is not installed';
    if (!def || mismatch) {
        return finish(hostResultFor(hostErrors.manifestMismatch, { command: key, reason: mismatch }));
    }

    const emit = (event: CommandEvent) => {
        if (out) {
            out.writeEvent(event);
        } else if (event.type === 'notice') {
            process.stderr.write(`${event.level === 'warning' ? 'Warning: ' : ''}${String(event.message)}\n`);
        } else if (event.type === 'progress') {
            process.stderr.write(`${String(event.message)}\n`);
        }
    };
    const env: HostEnvironment = {
        cwd: process.cwd(),
        signal: controller.signal,
        mcp: process.env.VENDURE_CLI_MCP === '1',
        prompter: !json && !isNonInteractiveEnvironment() ? createClackPrompter() : undefined,
        emit,
        spawn: createSpawn(process.cwd(), controller.signal, chunk => process.stdout.write(chunk)),
        findProjectRoot: () => findVendureProjectRoot(),
    };

    const result = await Promise.race([
        executeCommand(def, input, env),
        new Promise<HostResult>(resolve => {
            controller.signal.addEventListener('abort', () => {
                setTimeout(() => resolve(hostResultFor(hostErrors.cancelled, {})), CANCEL_GRACE_MS).unref();
            });
        }),
    ]);
    return finish(result, def);
}

function ancestorOptionValue(command: Command, field: string): unknown {
    for (let ancestor = command.parent; ancestor; ancestor = ancestor.parent) {
        const source = ancestor.getOptionValueSource(field);
        if (source !== undefined && source !== 'default') {
            return ancestor.getOptionValue(field);
        }
    }
    return undefined;
}

/** Checks that the declaration the host loaded is the one the manifest was built from. */
function findMismatch(def: CommandDefinition, manifestCommand: MergedManifestCommand): string | undefined {
    if (def.behavior !== manifestCommand.behavior) {
        return `its behavior is "${def.behavior}" but the manifest says "${manifestCommand.behavior}"`;
    }
    const consents = Object.keys(def.consents ?? {})
        .sort()
        .join(',');
    if (consents !== Object.keys(manifestCommand.consents).sort().join(',')) {
        return 'its consents differ';
    }
    if ((def.plan !== undefined) !== manifestCommand.hasPlan) {
        return 'it differs in having a plan()';
    }
    return undefined;
}
