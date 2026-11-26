import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStartupRecord } from '../shared/startup-record.js';

import { NotLoggedInError, SessionRefreshUnavailableError, SessionRejectedError } from './auth-errors.js';
import { readAuthStatus, refreshAccessToken } from './auth-session.js';
import { describeAccount, renewCredential } from './credential.js';
import { recordStartupEnvironment } from './startup-environment.js';

vi.mock('./auth-session.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./auth-session.js')>()),
    refreshAccessToken: vi.fn(),
    readAuthStatus: vi.fn(),
}));

const refresh = vi.mocked(refreshAccessToken);
const status = vi.mocked(readAuthStatus);

describe('renewCredential', () => {
    afterEach(() => vi.resetAllMocks());

    it('renews a stored login once, from the token that was refused', async () => {
        refresh.mockResolvedValue('renewed');

        await expect(renewCredential({ source: 'stored-login', token: 'refused' })).resolves.toEqual({
            source: 'stored-login',
            token: 'renewed',
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledWith('refused', {});
    });

    it('cannot renew VENDURE_CLOUD_TOKEN', async () => {
        await expect(renewCredential({ source: 'environment', token: 'vcdk' })).resolves.toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('gives nothing when the login is gone or its renewal was refused', async () => {
        refresh.mockRejectedValueOnce(new NotLoggedInError());
        await expect(renewCredential({ source: 'stored-login', token: 't' })).resolves.toBeUndefined();

        refresh.mockRejectedValueOnce(new SessionRejectedError());
        await expect(renewCredential({ source: 'stored-login', token: 't' })).resolves.toBeUndefined();
    });

    it('throws a transient failure, which keeps the login', async () => {
        refresh.mockRejectedValue(new SessionRefreshUnavailableError('no network'));

        await expect(renewCredential({ source: 'stored-login', token: 't' })).rejects.toThrow('no network');
    });
});

describe('describeAccount', () => {
    const organization = { workosOrganizationId: 'org_1', customerAccountId: 'acme', name: 'Acme' };

    beforeEach(() => {
        status.mockReturnValue({ loggedIn: true, consoleApiUrl: '', path: '', organization });
    });

    afterEach(() => {
        vi.resetAllMocks();
        vi.unstubAllEnvs();
        clearStartupRecord();
    });

    it('names the production Console, and the organization of a stored login', () => {
        vi.stubEnv('VENDURE_CONSOLE_API_URL', '');

        expect(describeAccount({ source: 'stored-login', token: 't' })).toEqual({
            consoleUrl: 'https://console.vendure.io',
            apiUrl: 'https://api.vendure.io',
            organization: { id: 'org_1', customerAccountId: 'acme', name: 'Acme' },
        });
    });

    it('gives only the Console for VENDURE_CLOUD_TOKEN', () => {
        vi.stubEnv('VENDURE_CONSOLE_API_URL', '');

        expect(describeAccount({ source: 'environment', token: 'vcdk' })).toEqual({
            consoleUrl: 'https://console.vendure.io',
            apiUrl: 'https://api.vendure.io',
        });
        expect(status).not.toHaveBeenCalled();
    });

    it('takes the Console from the environment the CLI started with', () => {
        vi.stubEnv('VENDURE_CONSOLE_API_URL', 'https://staging.api.vendure.io');
        recordStartupEnvironment();
        // A project's `.env` loaded after startup.
        vi.stubEnv('VENDURE_CONSOLE_API_URL', 'http://127.0.0.1:9');

        expect(describeAccount({ source: 'environment', token: 'vcdk' })).toEqual({
            consoleUrl: 'https://staging.console.vendure.io',
            apiUrl: 'https://staging.api.vendure.io',
        });
    });
});
