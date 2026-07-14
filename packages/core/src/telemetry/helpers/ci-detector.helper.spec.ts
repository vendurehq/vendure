import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CI_ENV_VARS, isCI } from './ci-detector.helper';

describe('isCI()', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Clear all CI env vars before each test (using the source of truth)
        for (const envVar of CI_ENV_VARS) {
            delete process.env[envVar];
        }
    });

    afterEach(() => {
        // Restore original environment
        process.env = { ...originalEnv };
    });

    it('returns false when no CI vars are set', () => {
        expect(isCI()).toBe(false);
    });

    describe('returns true for each CI env var', () => {
        // Dynamically generate tests from the exported CI_ENV_VARS
        // This ensures tests stay in sync with source
        for (const envVar of CI_ENV_VARS) {
            it(`returns true when ${envVar} is set to "true"`, () => {
                process.env[envVar] = 'true';
                expect(isCI()).toBe(true);
            });

            it(`returns true when ${envVar} is set to "1"`, () => {
                process.env[envVar] = '1';
                expect(isCI()).toBe(true);
            });

            it(`returns true when ${envVar} is set to any non-empty value`, () => {
                process.env[envVar] = 'some-value';
                expect(isCI()).toBe(true);
            });
        }
    });

    describe('returns false for falsy values', () => {
        it('returns false when CI is set to "false"', () => {
            process.env.CI = 'false';
            expect(isCI()).toBe(false);
        });

        it('returns false when CI is set to "0"', () => {
            process.env.CI = '0';
            expect(isCI()).toBe(false);
        });

        it('returns false when CI is set to empty string', () => {
            process.env.CI = '';
            expect(isCI()).toBe(false);
        });
    });

    it('handles multiple CI vars simultaneously', () => {
        process.env.CI = 'true';
        process.env.GITHUB_ACTIONS = 'true';
        process.env.GITLAB_CI = 'true';
        expect(isCI()).toBe(true);
    });

    it('returns true if at least one CI var is truthy', () => {
        process.env.CI = 'false';
        process.env.GITHUB_ACTIONS = 'true';
        expect(isCI()).toBe(true);
    });

    it('returns false if all CI vars are falsy', () => {
        process.env.CI = 'false';
        process.env.GITHUB_ACTIONS = '0';
        process.env.GITLAB_CI = '';
        expect(isCI()).toBe(false);
    });
});
