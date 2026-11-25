import { resolveVendureCliConfigDir } from '../shared/cli-config-dir.js';
import { clearStartupRecord, readStartupRecord, writeStartupRecord } from '../shared/startup-record.js';

/**
 * The environment variables that choose the credential the CLI acts with, where it sends it, and
 * where the stored login lives. A command can load a project's `.env` file into `process.env`, as
 * loading the Vendure config does, so these are read as they were when the CLI started instead. A
 * cloned repository's `.env` can then never choose them.
 *
 * `VENDURE_CLI_CONFIG_DIR` stands for the config directory as resolved at startup, which also covers
 * the `XDG_CONFIG_HOME`, `APPDATA` and home directory it falls back to.
 */
export const AUTH_ENVIRONMENT_VARIABLES = [
    'VENDURE_CLOUD_TOKEN',
    'VENDURE_CONSOLE_API_URL',
    'VENDURE_CLI_CONFIG_DIR',
] as const;

/**
 * Records the auth variables as they are now. The CLI calls it first thing at startup, before any
 * command can load a `.env` file.
 */
export function recordStartupEnvironment(env: NodeJS.ProcessEnv = process.env): void {
    writeStartupRecord({
        VENDURE_CLOUD_TOKEN: env.VENDURE_CLOUD_TOKEN,
        VENDURE_CONSOLE_API_URL: env.VENDURE_CONSOLE_API_URL,
        VENDURE_CLI_CONFIG_DIR: resolveVendureCliConfigDir(env),
    });
}

/** Forgets the record. For tests. */
export function clearStartupEnvironment(): void {
    clearStartupRecord();
}

/**
 * The environment the auth code reads: `env` when a caller passes one, as tests do. Otherwise the
 * process environment, with the auth variables as they were at startup. Outside the CLI, where
 * nothing recorded them, it is the process environment as it is.
 *
 * It is also the environment to start a CLI child process with, so the child records the same
 * values rather than ones a `.env` put into this process.
 */
export function authEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (env) {
        return env;
    }
    const startup = readStartupRecord();
    if (!startup) {
        return process.env;
    }
    return { ...process.env, ...startup };
}
