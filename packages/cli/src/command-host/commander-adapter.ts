import {
    CommandDefinition,
    CommandEvent,
    internalFieldsOf,
    isIncompleteResult,
    JSON_SCHEMA_TARGET,
} from '@vendure/common/lib/command';
import { flagValueSyntax, MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import { Command, Option } from 'commander';
import fs from 'node:fs';

import { describeAccount, renewCredential, requireCredential } from '../auth/credential.js';
import { pluginCommandsHeading } from '../shared/command-registry.js';
import { findVendureProjectRoot } from '../shared/project-validation.js';
import { isNonInteractiveEnvironment } from '../utilities/utils.js';

import { hostErrors } from './host-errors.js';
import { errorResult, executeCommand, HostEnvironment, HostResult } from './host.js';
import { CORE_SOURCE, LoadedCommand } from './manifest.js';
import { compareCodeUnits, kebab } from './naming.js';
import { presentForPeople } from './present.js';
import { createClackPrompter } from './prompter.js';
import { writeSecretFile } from './secret-file.js';
import { createSpawn } from './spawn.js';
import { JsonOutput, redirectStdoutToStderr } from './stdio.js';

/** How long a command has to stop after it is cancelled, before the host gives up on it. */
const CANCEL_GRACE_MS = 10_000;

/**
 * How long a `service` command, such as `vendure dev`, has to stop after it is cancelled. It is
 * longer than {@link CANCEL_GRACE_MS}, because an extension stops its own processes, such as a
 * database, in a `finally` once the command has stopped. A process that never stops still can't
 * hold a script forever.
 */
const SERVICE_CANCEL_GRACE_MS = 30_000;

export interface AdapterOptions {
    /**
     * Loads the command declarations of the package that declared a command, its manifest's
     * `source`. Called only when a command runs, never to build the command line, which is built
     * from the manifests alone.
     */
    loadDefinitions(source: string): Promise<CommandDefinition[]>;
    /**
     * Loads one command with the extensions of other packages applied. Without it, the command
     * runs as `loadDefinitions` declares it.
     */
    loadCommand?(command: MergedManifestCommand): Promise<LoadedCommand>;
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
 * The commands this adapter registered from a manifest. {@link optionNotTaken} checks only these
 * ancestors: a command with commands under it, such as `cloud deploy`, reads its options wherever
 * they are on the line, and an option of it that the command that runs doesn't take would otherwise
 * be ignored.
 */
const manifestCommands = new WeakSet<Command>();

/**
 * The first option given to a manifest command above `command` that `command` doesn't take, such as
 * `--force` of `cloud deploy` in `cloud deploy --force plan`. Undefined when there is none.
 */
export function optionNotTaken(command: Command): string | undefined {
    for (let ancestor = command.parent; ancestor; ancestor = ancestor.parent) {
        if (!manifestCommands.has(ancestor)) {
            continue;
        }
        for (const option of ancestor.options) {
            const name = option.attributeName();
            if (
                ancestor.getOptionValueSource(name) !== 'cli' ||
                command.options.some(candidate => candidate.attributeName() === name)
            ) {
                continue;
            }
            // `--x` and `--no-x` set the same value: name the one that set it.
            const value: unknown = ancestor.getOptionValue(name);
            const given =
                ancestor.options.find(
                    candidate => candidate.attributeName() === name && candidate.negate === (value === false),
                ) ?? option;
            return given.long ?? given.short ?? given.flags;
        }
    }
    return undefined;
}

/**
 * Marks a manifest command as one with commands under it. Its action then sees a name that is none
 * of them, and reports it as cli.usage instead of Commander's "too many arguments".
 */
function acceptsCommandsUnder(command: Command): void {
    command.allowExcessArguments();
}

/** Ends the run with a host error: the envelope under `--json`, a coded line otherwise. */
function stop(result: HostResult): never {
    if (jsonRequested(process.argv)) {
        fs.writeSync(1, `${JSON.stringify(result.envelope)}\n`);
    } else {
        const error = result.envelope.error;
        process.stderr.write(`[${error?.code ?? 'cli.usage'}] ${error?.message ?? ''}\n`);
    }
    process.exit(result.exitCode);
}

/**
 * The groups this adapter made only to hold manifest commands, such as `cloud deploy` before the
 * command `cloud deploy` itself is registered. A manifest command at that path takes the group
 * over, with its commands.
 */
const manifestGroups = new WeakSet<Command>();

/**
 * The command line with every option moved after the full command path, when the arguments name a
 * command of the program, such as `vendure cloud project list --json` for
 * `vendure cloud --json project list`. Undefined when they don't.
 */
export function commandLineWithOptionsLast(program: Command, args: readonly string[]): string | undefined {
    const path: string[] = [];
    const rest: string[] = [];
    let command = program;
    for (const arg of args) {
        const child =
            arg.startsWith('-') || command.commands.length === 0 ? undefined : findChild(command, arg);
        if (child) {
            path.push(arg);
            command = child;
        } else {
            rest.push(arg);
        }
    }
    if (path.length === 0 || command.commands.length > 0) {
        return undefined;
    }
    return ['vendure', ...path, ...rest].join(' ');
}

/**
 * A group of manifest commands, such as `cloud`, takes no options of its own, so Commander refuses
 * an option given before the subcommand. When the arguments after it name a command, the run
 * stops with a coded error that names the same command line with the options at the end. Under
 * `--json`, any other error of the group is the `cli.usage` envelope, as for a command. Otherwise
 * Commander's own text is written as before.
 */
function reportOptionsBeforeSubcommand(group: Command): void {
    let root = group;
    while (root.parent) {
        root = root.parent;
    }
    // Commander writes its error text before it calls `exitOverride`. The text is held until the
    // error is known, so that the coded error or the envelope can take its place.
    let heldText = '';
    group.configureOutput({ writeErr: text => (heldText += text) });
    group.exitOverride(error => {
        const passThrough =
            error.exitCode === 0 || error.code === 'commander.help' || error.code === 'commander.version';
        const line =
            error.code === 'commander.unknownOption'
                ? commandLineWithOptionsLast(root, process.argv.slice(2))
                : undefined;
        const json = jsonRequested(process.argv);
        if (line) {
            const option = /'([^']+)'/.exec(error.message)?.[1] ?? 'An option';
            const result = errorResult(hostErrors.optionBeforeCommand, { option, line });
            if (json) {
                fs.writeSync(1, `${JSON.stringify(result.envelope)}\n`);
            } else {
                process.stderr.write(
                    `[${hostErrors.optionBeforeCommand.code}] ${result.envelope.error?.message ?? ''}\n`,
                );
            }
            process.exit(result.exitCode);
        }
        if (json && !passThrough) {
            const result = errorResult(hostErrors.usage, { message: error.message.replace(/^error: /, '') });
            fs.writeSync(1, `${JSON.stringify(result.envelope)}\n`);
            process.exit(result.exitCode);
        }
        process.stderr.write(heldText);
        process.exit(error.exitCode);
    });
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
                manifestGroups.add(group);
                reportOptionsBeforeSubcommand(group);
                if (parent === program && manifestCommand.source !== CORE_SOURCE) {
                    group.helpGroup(pluginCommandsHeading(manifestCommand.source));
                }
            }
            if (manifestCommands.has(group)) {
                acceptsCommandsUnder(group);
            }
            parent = group;
        }
        registerLeaf(parent, manifestCommand, options);
    }
}

function registerLeaf(parent: Command, manifestCommand: MergedManifestCommand, options: AdapterOptions) {
    const name = manifestCommand.path[manifestCommand.path.length - 1];
    const existing = findChild(parent, name);
    const group = existing && manifestGroups.has(existing) ? existing : undefined;
    if (existing && !group) {
        // The merge refuses a command whose path a built-in command already has, so only a
        // caller that skipped it gets here.
        throw new Error(`The command "${manifestCommand.path.join(' ')}" is already registered`);
    }
    const command = (group ?? parent.command(name)).description(manifestCommand.description);
    if (group) {
        manifestGroups.delete(group);
        // It has commands under it already.
        acceptsCommandsUnder(command);
    }
    manifestCommands.add(command);
    if (parent.parent === null && manifestCommand.source !== CORE_SOURCE) {
        command.helpGroup(pluginCommandsHeading(manifestCommand.source));
    }
    const positional = manifestCommand.cli.positional ?? [];
    const properties = (manifestCommand.input.properties ?? {}) as Record<string, Record<string, any>>;

    for (const field of positional) {
        command.argument(`[${kebab(field)}]`, properties[field]?.description);
    }
    // A positional field is also a flag, so that a fix or a need can always name it as one.
    for (const [field, schema] of Object.entries(properties)) {
        const flag = `--${kebab(field)}`;
        const short = manifestCommand.cli.flags?.[field]?.short;
        const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
        const { value, negatable } = flagValueSyntax(manifestCommand, field, schema, kebab(field));
        const flags = `${short ? `${short}, ` : ''}${flag}${value}`;
        const option = new Option(flags, (schema.description as string | undefined) ?? '');
        if (type === 'number' || type === 'integer') {
            option.argParser(raw => Number(raw));
        }
        if (Array.isArray(schema.enum) && type === 'string') {
            option.choices(schema.enum as string[]);
        }
        command.addOption(option);
        if (negatable) {
            // `--no-<flag>` sets the field to false. Defined after `--<flag>`, it leaves the value
            // undefined when neither is given, so the command's own default applies, for example
            // a `wait` field that is true for people and false under `vendure mcp`.
            command.addOption(new Option(`--no-${kebab(field)}`, `Sets ${flag} to false`));
        }
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
            stop(errorResult(hostErrors.usage, { message: error.message.replace(/^error: /, '') }));
        }
        process.exit(error.exitCode);
    });

    command.action(async (...args: any[]) => {
        const path = manifestCommand.path.join(' ');
        if (command.commands.length > 0 && command.args.length > positional.length) {
            stop(
                errorResult(hostErrors.usage, {
                    message: `"${command.args[positional.length]}" is not a command of "${path}"`,
                }),
            );
        }
        const notTaken = optionNotTaken(command);
        if (notTaken) {
            stop(errorResult(hostErrors.usage, { message: `${notTaken} is not an option of "${path}"` }));
        }
        const opts = hostFlags(command);
        const positionalValues = Object.fromEntries(
            positional.map((field, index) => [field, args[index] as unknown]),
        );
        const code = await runLeaf(manifestCommand, command, positionalValues, opts, options);
        process.exit(code);
    });
}

/**
 * The host's own flags of a run. A CLI plugin can declare a shared `--json` on the program, which
 * then takes the flag before this command sees it, so a flag not given to the command is read from
 * the commands above it, unless it only has its default there.
 */
function hostFlags(command: Command): { json?: boolean; format?: string; input?: string } {
    const opts = command.opts();
    const read = (name: 'json' | 'format' | 'input') => opts[name] ?? ancestorOptionValue(command, name);
    return {
        json: read('json') as boolean | undefined,
        format: read('format') as string | undefined,
        input: read('input') as string | undefined,
    };
}

/** Whether this process runs a tool call for `vendure mcp`, which marks its child processes. */
function isMcpCall(): boolean {
    return process.env.VENDURE_CLI_MCP === '1';
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

/** What {@link createCancellation} listens to. The process, except in tests. */
export interface CancellationSource {
    on(event: 'SIGINT' | 'SIGTERM' | 'message', listener: (message?: unknown) => void): unknown;
    send?: unknown;
    channel?: { unref?(): void } | null;
    exit(code: number): never;
}

/**
 * Wires cancellation: SIGINT, SIGTERM, and a `cancel` message over IPC from `vendure mcp`.
 *
 * The first request aborts `ctx.signal`, and the command has {@link CANCEL_GRACE_MS} to stop. A
 * second signal from a person, after a moment, ends the process at once. `vendure mcp` sends the
 * message first, then SIGINT to the whole process group to stop the processes the command
 * started. That signal belongs to the same request, so it never ends the process early.
 */
export function createCancellation(source: CancellationSource = process): AbortController {
    const controller = new AbortController();
    let cancelledAt = 0;
    let cancelledOverIpc = false;
    const cancel = (via: 'signal' | 'ipc') => {
        if (controller.signal.aborted) {
            if (via === 'signal' && !cancelledOverIpc && Date.now() - cancelledAt > 500) {
                source.exit(130);
            }
            return;
        }
        cancelledAt = Date.now();
        cancelledOverIpc = via === 'ipc';
        controller.abort();
    };
    source.on('SIGINT', () => cancel('signal'));
    source.on('SIGTERM', () => cancel('signal'));
    if (source.send) {
        source.on('message', message => {
            if ((message as { type?: string } | null)?.type === 'cancel') {
                cancel('ipc');
            }
        });
        // The channel alone must not keep the process alive.
        source.channel?.unref?.();
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
        return finish(errorResult(hostErrors.inputUnreadable, { reason: (e as Error).message }));
    }
    Object.assign(input, collectFlagInput(command, properties, positionalValues));

    const key = manifestCommand.path.join(' ');
    let loaded: LoadedCommand;
    try {
        loaded = options.loadCommand
            ? await options.loadCommand(manifestCommand)
            : {
                  definition: (await options.loadDefinitions(manifestCommand.source)).find(
                      candidate => candidate.path.join(' ') === key,
                  ),
                  manifestCommand,
                  dropped: [],
              };
    } catch (e) {
        return finish(
            errorResult(hostErrors.pluginDefinitionsFailed, {
                plugin: manifestCommand.source,
                command: key,
                reason: e instanceof Error ? e.message : String(e),
            }),
        );
    }
    const usedDropped = droppedExtensionInput(loaded, input);
    if (usedDropped) {
        return finish(usedDropped);
    }
    const def = loaded.definition;
    const mismatch =
        loaded.mismatch ??
        (def ? await findMismatch(def, loaded.manifestCommand) : 'the command is not installed');
    if (!def || mismatch) {
        return finish(errorResult(hostErrors.manifestMismatch, { command: key, reason: mismatch }));
    }

    const env = createHostEnvironment(controller, out);
    // An extension that failed to load is a warning of the run, in its envelope's notices too.
    env.notices = loaded.dropped.map(dropped => ({
        level: 'warning' as const,
        message: `[${dropped.error.code}] ${dropped.error.message}`,
    }));
    const result = await executeWithCancellation(def, input, env, controller);
    return finish(result, def);
}

/**
 * A `cli.usage` error for input to an extension that failed to load, so a flag of that extension
 * is refused rather than dropped without a word, or `undefined` when the input uses none.
 */
export function droppedExtensionInput(
    loaded: Pick<LoadedCommand, 'dropped' | 'manifestCommand'>,
    input: Record<string, unknown>,
): HostResult | undefined {
    const key = loaded.manifestCommand.path.join(' ');
    for (const dropped of loaded.dropped) {
        const field = dropped.fields.find(name => input[name] !== undefined);
        if (field !== undefined) {
            return errorResult(hostErrors.usage, {
                message:
                    `--${kebab(field)} comes from ${dropped.package}, whose extension of "${key}" ` +
                    `failed to load: ${dropped.reason}`,
            });
        }
    }
    return undefined;
}

/**
 * The host environment of a run. With `out`, the run is under `--json`: events go to stderr as
 * tagged lines and no one is asked. Without it, events are printed for a person, who is asked
 * for what is missing when the terminal allows it.
 */
export function createHostEnvironment(controller: AbortController, out?: JsonOutput): HostEnvironment {
    const emit = (event: CommandEvent) => {
        if (out) {
            out.writeEvent(event);
        } else if (event.type === 'notice') {
            process.stderr.write(`${event.level === 'warning' ? 'Warning: ' : ''}${String(event.message)}\n`);
        } else if (event.type === 'progress') {
            process.stderr.write(`${String(event.message)}\n`);
        } else if (event.type === 'output') {
            // Text from `ctx.output`, such as the output of the processes `vendure dev` runs,
            // written unchanged to the stream it names.
            (event.stream === 'stderr' ? process.stderr : process.stdout).write(String(event.text));
        }
    };
    return {
        cwd: process.cwd(),
        signal: controller.signal,
        mcp: isMcpCall(),
        prompter: !out && !isNonInteractiveEnvironment() ? createClackPrompter() : undefined,
        emit,
        spawn: createSpawn(process.cwd(), controller.signal, text => process.stdout.write(text), {
            wholeLines: !!out,
        }),
        findProjectRoot: () => findVendureProjectRoot(),
        writeSecret: (command, field, value) => writeSecretFile(command, field, value),
        requireCredential: async (_kind, ctx) => {
            const result = await requireCredential({
                signal: ctx.signal,
                mayPrompt: ctx.ask !== undefined,
                signIn: async () => {
                    const { signInWithDevice } = await import('../commands/auth/sign-in.js');
                    await signInWithDevice(ctx);
                },
            });
            return isIncompleteResult(result) ? { needs: result.needs } : { credential: result };
        },
        refreshCredential: (_kind, credential, ctx) => renewCredential(credential, { signal: ctx.signal }),
        describeAccount: (_kind, credential) => describeAccount(credential),
    };
}

/**
 * Runs a command, and gives up on it when it does not stop in time after it is cancelled.
 *
 * A `service` command, such as `vendure dev`, gets {@link SERVICE_CANCEL_GRACE_MS} instead of
 * {@link CANCEL_GRACE_MS}: an extension that wraps it stops its own processes once `next()`
 * resolves, in its `finally`, and the host waits for that. A second Ctrl+C still ends the process
 * at once (see {@link createCancellation}).
 */
export function executeWithCancellation(
    def: CommandDefinition,
    input: Record<string, unknown>,
    env: HostEnvironment,
    controller: AbortController,
): Promise<HostResult> {
    const grace = def.behavior === 'service' ? SERVICE_CANCEL_GRACE_MS : CANCEL_GRACE_MS;
    return Promise.race([
        executeCommand(def, input, env),
        new Promise<HostResult>(resolve => {
            controller.signal.addEventListener('abort', () => {
                setTimeout(() => resolve(errorResult(hostErrors.cancelled, {})), grace).unref();
            });
        }),
    ]);
}

/**
 * The input fields a caller set on the command line, as flags or positional arguments. They win
 * over the same fields in an `--input` document. A boolean field set with `--no-<flag>` is false.
 */
export function collectFlagInput(
    command: Command,
    properties: string[],
    positionalValues: Record<string, unknown> = {},
): Record<string, unknown> {
    const opts = command.opts();
    const input: Record<string, unknown> = {};
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
    return input;
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
export async function findMismatch(
    def: CommandDefinition,
    manifestCommand: MergedManifestCommand,
): Promise<string | undefined> {
    if (def.behavior !== manifestCommand.behavior) {
        return `its behavior is "${def.behavior}" but the manifest says "${manifestCommand.behavior}"`;
    }
    const consents = Object.keys(def.consents ?? {})
        .sort(compareCodeUnits)
        .join(',');
    if (consents !== Object.keys(manifestCommand.consents).sort(compareCodeUnits).join(',')) {
        return 'its consents differ';
    }
    if ((def.plan !== undefined) !== manifestCommand.hasPlan) {
        return 'it differs in having a plan()';
    }
    const secrets = (list: string[] | undefined) => [...(list ?? [])].sort(compareCodeUnits).join(',');
    if (secrets(def.secretOutputs) !== secrets(manifestCommand.secretOutputs)) {
        return 'its secret outputs differ';
    }
    // The host loads the schemas to run the command anyway, and `watch` leaves an old manifest
    // in place, so a field that was added, renamed or removed is caught here.
    // An internal field is in the schema, but never in the manifest.
    const declared = Object.keys(
        ((await def.schemas()).input['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET })
            .properties as object | undefined) ?? {},
    ).filter(field => !internalFieldsOf(def.cli).includes(field));
    const listed = Object.keys((manifestCommand.input.properties as object | undefined) ?? {}).filter(
        field => !(field in manifestCommand.consents),
    );
    if (declared.sort(compareCodeUnits).join(',') !== listed.sort(compareCodeUnits).join(',')) {
        return 'its input fields differ';
    }
    return undefined;
}
