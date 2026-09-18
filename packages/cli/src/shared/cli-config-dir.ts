import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The directory holding the CLI's own user-level state, which is state that
 * belongs to the machine and the person rather than to any one project: the
 * star prompt's marker file, and the global CLI plugin allowlist.
 *
 * `VENDURE_CLI_CONFIG_DIR` overrides everything, which is how tests point the
 * CLI at a temporary directory without touching the real one.
 *
 * A plugin's own state is the plugin's business and does not belong here.
 * `@vendure/cloud`, for one, keeps its credentials elsewhere under its own
 * rules.
 */
export function getVendureCliConfigDir(env: NodeJS.ProcessEnv = process.env): string {
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
