import { INCLUDE_STACK_IN_ERRORS_ENV_VAR } from '@vendure/common/lib/shared-constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The default config is built when the module loads, so each case loads it again. */
async function loadDefaultConfig() {
    vi.resetModules();
    return (await import('./default-config')).defaultConfig;
}

describe('defaultConfig.apiOptions.includeStackInErrors', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is off by default', async () => {
        vi.stubEnv(INCLUDE_STACK_IN_ERRORS_ENV_VAR, undefined);
        expect((await loadDefaultConfig()).apiOptions.includeStackInErrors).toBe(false);
    });

    it('is on when vendure dev sets the environment variable', async () => {
        vi.stubEnv(INCLUDE_STACK_IN_ERRORS_ENV_VAR, 'true');
        expect((await loadDefaultConfig()).apiOptions.includeStackInErrors).toBe(true);
    });

    it('stays off for any other value of the variable', async () => {
        vi.stubEnv(INCLUDE_STACK_IN_ERRORS_ENV_VAR, '1');
        expect((await loadDefaultConfig()).apiOptions.includeStackInErrors).toBe(false);
    });
});
