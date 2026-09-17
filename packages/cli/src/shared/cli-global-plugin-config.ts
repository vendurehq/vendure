import fs from 'fs-extra';
import path from 'node:path';

import { getVendureCliConfigDir } from './cli-config-dir';

/**
 * The user-level CLI config, `cli.json` in {@link getVendureCliConfigDir}.
 *
 * This is the global counterpart of `package.json#vendure.cli`. A project
 * states which plugins it loads in its own package.json; a machine states it
 * here. Both are allowlists, because a package that is merely installed must
 * never be able to add commands on its own — globally that would mean adding
 * them to every shell on the machine.
 */
export interface GlobalCliConfig {
    /**
     * Allowlist of packages to load as CLI plugins, in registration order.
     * Same meaning as the project allowlist.
     */
    plugins?: string[];
    /**
     * Extra directories to resolve those packages from, tried after the CLI's
     * own installation directory.
     *
     * Present so a plugin can be found under an install layout the CLI does
     * not otherwise reach — pnpm, Volta and asdf all arrange global packages
     * differently — without waiting for a release. It is also where a
     * CLI-managed plugin directory would be listed, if one is added later.
     */
    pluginRoots?: string[];
}

/**
 * Names the environment variable that supplements the global allowlist.
 *
 * Exists for environments where there is no project and no writable home
 * directory: a container image, or an ephemeral sandbox an agent is given. The
 * image installs the packages and sets this, with no setup step to run and no
 * file to write.
 */
export const CLI_PLUGINS_ENV_VAR = 'VENDURE_CLI_PLUGINS';

export function getGlobalCliConfigPath(env: NodeJS.ProcessEnv = process.env): string {
    return path.join(getVendureCliConfigDir(env), 'cli.json');
}

/**
 * Reads the user-level config. A missing file is not an error: it means no
 * global plugins are enabled, which is the default.
 *
 * A malformed file is also not an error, for the same reason a broken plugin
 * is not: the CLI has to stay usable enough to fix the problem. The reason is
 * returned so the caller can report it.
 */
export function readGlobalCliConfig(env: NodeJS.ProcessEnv = process.env): {
    config: GlobalCliConfig;
    path: string;
    error?: string;
} {
    const configPath = getGlobalCliConfigPath(env);
    if (!fs.existsSync(configPath)) {
        return { config: {}, path: configPath };
    }
    try {
        const parsed = fs.readJsonSync(configPath) as GlobalCliConfig;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { config: {}, path: configPath, error: 'Expected a JSON object' };
        }
        return { config: parsed, path: configPath };
    } catch (e) {
        return { config: {}, path: configPath, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Package names from {@link CLI_PLUGINS_ENV_VAR}, which is a comma-separated
 * list. Blank entries are dropped so a trailing comma is not an error.
 */
export function readEnvPluginNames(env: NodeJS.ProcessEnv = process.env): string[] {
    return (env[CLI_PLUGINS_ENV_VAR] ?? '')
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0);
}

/**
 * The global allowlist: the config file's list, then any names the environment
 * variable adds that it does not already contain.
 *
 * Order matters, because it is registration order, and among plugins that set
 * `replaces: true` the last listed wins. The file is listed first so that
 * naming a package in the environment is what decides.
 */
export function getGlobalPluginAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
    return mergeEnvPluginNames(readGlobalCliConfig(env).config.plugins ?? [], env);
}

/**
 * As {@link getGlobalPluginAllowlist}, for a caller that has already read the
 * config file and should not read it a second time.
 */
export function mergeEnvPluginNames(configured: string[], env: NodeJS.ProcessEnv = process.env): string[] {
    const names = [...new Set(configured)];
    for (const name of readEnvPluginNames(env)) {
        if (!names.includes(name)) {
            names.push(name);
        }
    }
    return names;
}

/**
 * Writes the global allowlist, creating the config directory and preserving
 * anything else the file holds.
 */
export function writeGlobalPluginAllowlist(
    plugins: string[],
    env: NodeJS.ProcessEnv = process.env,
): { path: string; plugins: string[] } {
    const configPath = getGlobalCliConfigPath(env);
    const { config } = readGlobalCliConfig(env);
    fs.ensureDirSync(path.dirname(configPath));
    fs.writeJsonSync(configPath, { ...config, plugins }, { spaces: 4 });
    return { path: configPath, plugins };
}

export function addGlobalPlugin(
    packageName: string,
    env: NodeJS.ProcessEnv = process.env,
): { path: string; plugins: string[] } {
    const { config } = readGlobalCliConfig(env);
    const plugins = [...(config.plugins ?? [])];
    if (!plugins.includes(packageName)) {
        plugins.push(packageName);
    }
    return writeGlobalPluginAllowlist(plugins, env);
}

export function removeGlobalPlugin(
    packageName: string,
    env: NodeJS.ProcessEnv = process.env,
): { path: string; plugins: string[] } {
    const { config } = readGlobalCliConfig(env);
    return writeGlobalPluginAllowlist(
        (config.plugins ?? []).filter(name => name !== packageName),
        env,
    );
}
