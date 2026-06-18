import path from 'path';

import { mergeConfig } from './merge-config';
import { PartialVendureConfig, RuntimeVendureConfig } from './vendure-config';

let activeConfig: RuntimeVendureConfig;
const defaultConfigPath = path.join(__dirname, 'default-config');
/**
 * Reset the activeConfig object back to the initial default state.
 */
export function resetConfig() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    activeConfig = require(defaultConfigPath).defaultConfig;
}

/**
 * Override the default config by merging in the supplied values. Should only be used prior to
 * bootstrapping the app.
 */
export async function setConfig(userConfig: PartialVendureConfig) {
    if (!activeConfig) {
        activeConfig = (await import(defaultConfigPath)).defaultConfig;
    }
    activeConfig = mergeConfig(activeConfig, userConfig);
}

/**
 * Ensures that the config has been loaded. This is necessary for tests which
 * do not go through the normal bootstrap process.
 */
export async function ensureConfigLoaded() {
    if (!activeConfig) {
        activeConfig = (await import(defaultConfigPath)).defaultConfig;
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
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            activeConfig = require(defaultConfigPath).defaultConfig;
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.log(
                'Error loading config. If this is a test, make sure you have called ensureConfigLoaded() before using the config.',
            );
        }
    }
    return activeConfig;
}
