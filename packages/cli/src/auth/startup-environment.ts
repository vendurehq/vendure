/**
 * The environment variables that choose the credential the CLI acts with, where it sends it, and
 * where the stored login lives. A command can load a project's `.env` file into `process.env`, as
 * loading the Vendure config does, so these are read as they were when the CLI started instead. A
 * cloned repository's `.env` can then never choose them.
 */
export const AUTH_ENVIRONMENT_VARIABLES = [
    'VENDURE_CLOUD_TOKEN',
    'VENDURE_CONSOLE_API_URL',
    'VENDURE_CLI_CONFIG_DIR',
] as const;

// Shared through `globalThis`, so a second copy of this package in the same process, such as the one
// a plugin resolves, reads the same record.
const STARTUP_ENVIRONMENT = Symbol.for('@vendure/cli/startup-environment');

type StartupEnvironment = Partial<Record<(typeof AUTH_ENVIRONMENT_VARIABLES)[number], string>>;

function readRecord(): StartupEnvironment | undefined {
    return (globalThis as Record<symbol, StartupEnvironment | undefined>)[STARTUP_ENVIRONMENT];
}

/**
 * Records the auth variables as they are now. The CLI calls it first thing at startup, before any
 * command can load a `.env` file.
 */
export function recordStartupEnvironment(env: NodeJS.ProcessEnv = process.env): void {
    (globalThis as Record<symbol, StartupEnvironment | undefined>)[STARTUP_ENVIRONMENT] = Object.fromEntries(
        AUTH_ENVIRONMENT_VARIABLES.map(name => [name, env[name]]),
    );
}

/** Forgets the record. For tests. */
export function clearStartupEnvironment(): void {
    delete (globalThis as Record<symbol, StartupEnvironment | undefined>)[STARTUP_ENVIRONMENT];
}

/**
 * The environment the auth code reads: `env` when a caller passes one, as tests do. Otherwise the
 * process environment, with the auth variables as they were at startup. Outside the CLI, where
 * nothing recorded them, it is the process environment as it is.
 */
export function authEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (env) {
        return env;
    }
    const startup = readRecord();
    if (!startup) {
        return process.env;
    }
    return { ...process.env, ...startup };
}
