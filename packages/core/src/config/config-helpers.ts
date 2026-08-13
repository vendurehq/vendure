import path from 'path';

import { mergeConfig } from './merge-config';
import { PartialVendureConfig, RuntimeVendureConfig } from './vendure-config';

let activeConfig: RuntimeVendureConfig;
const defaultConfigPath = path.join(__dirname, 'default-config');

// The default config is loaded lazily to avoid circular-import issues, and cached here so that
// both the async (`import()`) and sync (`require()`) loaders return the same instance. The async
// loader is the reliable one under bundler/test runtimes (e.g. vitest hooks dynamic import but not
// the extensionless `require()`), so any code path that has already loaded the config asynchronously
// leaves the cache populated for the synchronous callers.
let cachedDefaultConfig: RuntimeVendureConfig | undefined;

async function loadDefaultConfig(): Promise<RuntimeVendureConfig> {
    if (!cachedDefaultConfig) {
        cachedDefaultConfig = (await import(defaultConfigPath)).defaultConfig;
    }
    return cachedDefaultConfig as RuntimeVendureConfig;
}

function loadDefaultConfigSync(): RuntimeVendureConfig {
    if (!cachedDefaultConfig) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        cachedDefaultConfig = require(defaultConfigPath).defaultConfig;
    }
    return cachedDefaultConfig as RuntimeVendureConfig;
}

/**
 * Reset the activeConfig object back to the initial default state.
 */
export function resetConfig() {
    activeConfig = loadDefaultConfigSync();
}

/**
 * Override the default config by merging in the supplied values. Should only be used prior to
 * bootstrapping the app.
 */
export async function setConfig(userConfig: PartialVendureConfig) {
    if (!activeConfig) {
        activeConfig = await loadDefaultConfig();
    }
    activeConfig = mergeConfig(activeConfig, userConfig);
}

/**
 * Ensures that the config has been loaded. This is necessary for tests which
 * do not go through the normal bootstrap process.
 */
export async function ensureConfigLoaded() {
    if (!activeConfig) {
        activeConfig = await loadDefaultConfig();
    }
}

/**
 * Returns the app config object. In general this function should only be
 * used before bootstrapping the app. In all other contexts, the {@link ConfigService}
 * should be used to access config settings.
 */
export function getConfig(): Readonly<RuntimeVendureConfig> {
    if (!activeConfig) {
        try {
            activeConfig = loadDefaultConfigSync();
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.log(
                'Error loading config. If this is a test, make sure you have called ensureConfigLoaded() before using the config.',
            );
        }
    }
    return activeConfig;
}
