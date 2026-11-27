/**
 * What the CLI recorded about its environment as it started, before any command could load a
 * project's `.env` file into `process.env`. {@link recordStartupEnvironment} writes it.
 *
 * Shared through `globalThis`, so a second copy of this package in the same process, such as the one
 * a plugin resolves, reads the same record.
 */
export interface StartupRecord {
    VENDURE_CLOUD_TOKEN?: string;
    VENDURE_CONSOLE_API_URL?: string;
    /** The Console app that pairs with `VENDURE_CONSOLE_API_URL`, such as a loopback one. */
    VENDURE_CONSOLE_APP_URL?: string;
    /**
     * The CLI's config directory, as resolved at startup. It depends on more than
     * `VENDURE_CLI_CONFIG_DIR`, since without it `XDG_CONFIG_HOME`, `APPDATA` or the home directory
     * decide, so the record holds the result.
     */
    VENDURE_CLI_CONFIG_DIR: string;
}

const STARTUP_RECORD = Symbol.for('@vendure/cli/startup-environment');

type Store = Record<symbol, StartupRecord | undefined>;

export function readStartupRecord(): StartupRecord | undefined {
    return (globalThis as Store)[STARTUP_RECORD];
}

export function writeStartupRecord(record: StartupRecord): void {
    (globalThis as Store)[STARTUP_RECORD] = record;
}

export function clearStartupRecord(): void {
    delete (globalThis as Store)[STARTUP_RECORD];
}
