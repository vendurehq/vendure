import { homedir } from 'node:os';
import path from 'node:path';

import { readStartupRecord } from './startup-record.js';

/**
 * The directory holding the CLI's own user-level state, which is state that
 * belongs to the machine and the person rather than to any one project: the
 * star prompt's marker file, and the global CLI plugin allowlist.
 *
 * `VENDURE_CLI_CONFIG_DIR` overrides everything, which is how tests point the
 * CLI at a temporary directory without touching the real one.
 *
 * A plugin's own state is the plugin's business and does not belong here. A
 * plugin that needs the user's login reads it through `getAccessToken()`
 * rather than from these files.
 *
 * With no `env`, it is the directory as the CLI resolved it at startup, so a
 * project's `.env` loaded later can't move it. Outside the CLI, where nothing
 * recorded it, it is resolved from `process.env`. An `env` a caller passes
 * decides it and skips the record, on purpose: that is how tests choose one.
 */
export function getVendureCliConfigDir(env?: NodeJS.ProcessEnv): string {
    if (env) {
        return resolveVendureCliConfigDir(env);
    }
    return readStartupRecord()?.VENDURE_CLI_CONFIG_DIR ?? resolveVendureCliConfigDir(process.env);
}

/** {@link getVendureCliConfigDir} as `env` decides it, without the startup record. */
export function resolveVendureCliConfigDir(env: NodeJS.ProcessEnv): string {
    if (env.VENDURE_CLI_CONFIG_DIR) {
        return env.VENDURE_CLI_CONFIG_DIR;
    }
    if (env.XDG_CONFIG_HOME) {
        return path.join(env.XDG_CONFIG_HOME, 'vendure');
    }
    if (process.platform === 'win32' && env.APPDATA) {
        return path.join(env.APPDATA, 'vendure');
    }
    return path.join(homedir(), '.config', 'vendure');
}
