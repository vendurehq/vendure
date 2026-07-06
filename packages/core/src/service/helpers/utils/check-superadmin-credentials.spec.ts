import { describe, expect, it, vi } from 'vitest';

import { checkSuperadminCredentials } from './check-superadmin-credentials';

const DEFAULTS = { identifier: 'superadmin', password: 'superadmin' };
const SAFE = { identifier: 'admin@example.com', password: 'a-very-long-random-passphrase' };

describe('checkSuperadminCredentials', () => {
    it('throws in production when both identifier and password are default', () => {
        expect(() => checkSuperadminCredentials(DEFAULTS, { nodeEnv: 'production' })).toThrow(
            /Refusing to start/,
        );
    });

    it('throws in production when only the password is default', () => {
        expect(() =>
            checkSuperadminCredentials(
                { identifier: 'admin@example.com', password: 'superadmin' },
                { nodeEnv: 'production' },
            ),
        ).toThrow(/Refusing to start/);
    });

    it('does not throw in production when the identifier is default but the password is strong', () => {
        const logger = { warn: vi.fn() };
        expect(() =>
            checkSuperadminCredentials(
                { identifier: 'superadmin', password: 'a-very-long-random-passphrase' },
                { nodeEnv: 'production', logger },
            ),
        ).not.toThrow();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns in development when defaults are used', () => {
        const logger = { warn: vi.fn() };
        checkSuperadminCredentials(DEFAULTS, { nodeEnv: 'development', logger });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/Default superadmin password/);
    });

    it('warns in staging / non-production environments when defaults are used', () => {
        const logger = { warn: vi.fn() };
        checkSuperadminCredentials(DEFAULTS, { nodeEnv: 'staging', logger });
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('is silent in test environment even when defaults are used', () => {
        const logger = { warn: vi.fn() };
        checkSuperadminCredentials(DEFAULTS, { nodeEnv: 'test', logger });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is silent (and does not throw) when credentials are non-default in production', () => {
        const logger = { warn: vi.fn() };
        expect(() => checkSuperadminCredentials(SAFE, { nodeEnv: 'production', logger })).not.toThrow();
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
