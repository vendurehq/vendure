import { cancel, intro, note, outro, spinner } from '@clack/prompts';
import { CommanderError } from 'commander';
import path from 'node:path';
import pc from 'picocolors';
import semver from 'semver';

import { OLDEST_NON_EOL_NODE_MAJOR, REQUIRED_NODE_VERSION } from './constants.js';
import { CreateError, toCreateError } from './errors.js';
import {
    buildProgram,
    isInteractive,
    RawCreateFlags,
    resolveCreateOptions,
    resolveLogLevel,
} from './options.js';
import { readPresetCatalog } from './presets.js';
import { promptForMissing } from './prompts.js';
import { Reporter, runCreate } from './run-create.js';
import { CliLogLevel } from './types.js';

export interface MainContext {
    version: string;
    assetsDir: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
}

/**
 * Runs `@vendure/create` with the given arguments and returns the exit code. With `--json`, stdout
 * carries exactly one JSON document: the result, or `{error: {code, message, fix}}`.
 */
export async function main(argv: string[], context: MainContext): Promise<number> {
    const stdout = context.stdout ?? process.stdout;
    const stderr = context.stderr ?? process.stderr;
    const env = context.env ?? process.env;
    const json = argv.includes('--json');
    const program = buildProgram(context.version)
        .exitOverride()
        .configureOutput({
            writeOut: text => (json ? stderr : stdout).write(text),
            writeErr: text => stderr.write(text),
            // Argument errors are reported below, as a CreateError.
            outputError: () => undefined,
        });

    let logLevel: CliLogLevel = 'info';
    try {
        try {
            program.parse(argv);
        } catch (e) {
            if (e instanceof CommanderError) {
                if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version') {
                    return 0;
                }
                throw new CreateError(
                    'create.invalid-arguments',
                    e.message.replace(/^error: /, ''),
                    'Run with --help to see the options.',
                );
            }
            throw e;
        }
        let flags = program.opts<RawCreateFlags>();
        let projectDirectory = program.args[0] as string | undefined;
        logLevel = resolveLogLevel(flags);
        checkNodeVersion(process.version, stderr);

        const presets = readPresetCatalog(context.assetsDir);
        const interactive = isInteractive(flags);
        if (interactive) {
            intro(`Let's create a ${pc.blue(pc.bold('Vendure App'))} ✨ ${pc.dim(`v${context.version}`)}`);
            ({ projectDirectory, flags } = await promptForMissing(projectDirectory, flags, presets));
        }
        const options = resolveCreateOptions(projectDirectory, flags, {
            cwd: context.cwd ?? process.cwd(),
            userAgent: env.npm_config_user_agent,
            presets,
        });
        const result = await runCreate(options, {
            createVersion: context.version,
            assetsDir: context.assetsDir,
            logLevel,
            reporter: interactive ? clackReporter() : streamReporter(stderr, logLevel),
            projectDirArg: projectDirectory ?? options.projectDir,
        });

        if (json) {
            stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (interactive) {
            note(result.next.map(line => pc.cyan(line)).join('\n'), 'Next steps');
            outro(`Created ${pc.green(options.name)}. Happy hacking!`);
        } else if (logLevel !== 'silent') {
            stderr.write(`\nCreated ${options.name}. Next:\n${result.next.map(l => `  ${l}`).join('\n')}\n`);
        }
        return 0;
    } catch (e) {
        const error = toCreateError(e);
        if (json) {
            stdout.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
        } else {
            const lines = [pc.red(`${error.message} (${error.code})`), ...(error.fix ? [error.fix] : [])];
            if (isInteractive({}) && logLevel !== 'silent') {
                cancel(lines.join('\n'));
            } else {
                stderr.write(lines.join('\n') + '\n');
            }
        }
        return 1;
    }
}

export function checkNodeVersion(currentVersion: string, stderr: NodeJS.WritableStream): void {
    if (!semver.satisfies(currentVersion, REQUIRED_NODE_VERSION)) {
        throw new CreateError(
            'create.node-version-unsupported',
            `You are running Node ${currentVersion}. Vendure requires Node ${REQUIRED_NODE_VERSION}.`,
            'Install a supported Node.js version: https://nodejs.org/en/download',
        );
    }
    if (semver.major(currentVersion) < OLDEST_NON_EOL_NODE_MAJOR) {
        stderr.write(
            pc.yellow(
                `You are running Node ${currentVersion}, which has reached end-of-life. ` +
                    'Consider upgrading to the current LTS release: https://nodejs.org/en/download\n',
            ),
        );
    }
}

function clackReporter(): Reporter {
    const s = spinner();
    return {
        start: message => s.start(message),
        stop: message => s.stop(message),
        warn: message => note(message, 'Warning'),
    };
}

function streamReporter(stream: NodeJS.WritableStream, logLevel: CliLogLevel): Reporter {
    const write = (message: string) => {
        if (logLevel !== 'silent') {
            stream.write(`${message}\n`);
        }
    };
    return { start: () => undefined, stop: write, warn: write };
}

export const defaultAssetsDir = (): string => path.join(import.meta.dirname, '../assets');
