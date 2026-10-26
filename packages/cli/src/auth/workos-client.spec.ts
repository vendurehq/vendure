import { describe, expect, it } from 'vitest';

import { DeviceAuthorization, pollDeviceAuthorization, startDeviceAuthorization } from './workos-client';

const CLIENT = { clientId: 'client_01TEST', apiHostname: 'api.workos.com' };

const DEVICE: DeviceAuthorization = {
    deviceCode: 'device_1',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://auth.example.com/device',
    verificationUriComplete: 'https://auth.example.com/device?code=ABCD-EFGH',
    expiresIn: 300,
    interval: 5,
};

const APPROVED = {
    access_token: 'access',
    refresh_token: 'refresh',
    user: { id: 'user_01', email: 'dev@example.com', first_name: null, last_name: null },
};

/** Answers poll requests in order and records each wait the poll asked for. */
function poll(responses: Array<{ status: number; body: unknown }>) {
    const waits: number[] = [];
    let clock = 0;
    return {
        waits,
        options: {
            now: () => clock,
            sleep: (ms: number) => {
                waits.push(ms);
                clock += ms;
                return Promise.resolve();
            },
            fetch: (() => {
                const next = responses.shift();
                return next
                    ? Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }))
                    : Promise.reject(new Error('Unexpected request'));
            }) as typeof globalThis.fetch,
        },
    };
}

describe('pollDeviceAuthorization', () => {
    it('waits the interval between polls and adds five seconds after slow_down', async () => {
        const run = poll([
            { status: 400, body: { error: 'authorization_pending' } },
            { status: 400, body: { error: 'slow_down' } },
            { status: 400, body: { error: 'authorization_pending' } },
            { status: 200, body: APPROVED },
        ]);

        const result = await pollDeviceAuthorization(CLIENT, DEVICE, run.options);

        expect(run.waits).toEqual([5000, 5000, 10_000, 10_000]);
        expect(result.accessToken).toBe('access');
    });

    it('stops when WorkOS reports the device code expired', async () => {
        const run = poll([{ status: 400, body: { error: 'expired_token' } }]);

        await expect(pollDeviceAuthorization(CLIENT, DEVICE, run.options)).rejects.toThrow(
            'The login code expired before it was approved.',
        );
    });

    it('stops polling once the device code lifetime has passed', async () => {
        const pending = { status: 400, body: { error: 'authorization_pending' } };
        const run = poll(Array.from({ length: 100 }, () => pending));

        await expect(
            pollDeviceAuthorization(CLIENT, { ...DEVICE, expiresIn: 12 }, run.options),
        ).rejects.toThrow('The login code expired');
        expect(run.waits).toEqual([5000, 5000, 5000]);
    });

    it('names an unexpected WorkOS error code', async () => {
        const run = poll([{ status: 403, body: { code: 'sso_required' } }]);

        await expect(pollDeviceAuthorization(CLIENT, DEVICE, run.options)).rejects.toThrow(
            'The login failed: WorkOS answered sso_required (HTTP 403).',
        );
    });
});

describe('startDeviceAuthorization', () => {
    const authorization = {
        device_code: 'device_1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.example.com/device',
        verification_uri_complete: 'https://auth.example.com/device?code=ABCD-EFGH',
        expires_in: 300,
        interval: 5,
    };

    it('posts the client id to the WorkOS host Console published', async () => {
        const requests: string[] = [];
        const fetch = ((url: string, init: RequestInit) => {
            requests.push(`${url} ${String(init.body)}`);
            return Promise.resolve(new Response(JSON.stringify(authorization)));
        }) as typeof globalThis.fetch;

        await startDeviceAuthorization(
            { clientId: 'client_01TEST', apiHostname: 'auth.vendure.io' },
            { fetch },
        );

        expect(requests).toEqual([
            'https://auth.vendure.io/user_management/authorize/device client_id=client_01TEST',
        ]);
    });

    it('refuses a verification URL that is not HTTPS before it reaches the browser opener', async () => {
        const fetch = (() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({ ...authorization, verification_uri_complete: 'file:///etc/passwd' }),
                ),
            )) as typeof globalThis.fetch;

        await expect(startDeviceAuthorization(CLIENT, { fetch })).rejects.toThrow(
            'WorkOS returned a malformed device authorization.',
        );
    });
});
