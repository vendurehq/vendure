import cookieSession from 'cookie-session';
import express from 'express';
import { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../../config/default-config';

import { setSessionToken } from './set-session-token';

describe('setSessionToken', () => {
    const methods: Array<{ name: string; tokenMethod: Array<'bearer' | 'cookie'> }> = [
        { name: 'bearer', tokenMethod: ['bearer'] },
        { name: 'cookie', tokenMethod: ['cookie'] },
        { name: 'bearer and cookie', tokenMethod: ['bearer', 'cookie'] },
    ];

    for (const { name, tokenMethod } of methods) {
        describe(name, () => {
            for (const headersSent of [false, true]) {
                for (const sessionToken of ['replacement-token', '']) {
                    it(`${sessionToken ? 'sets' : 'clears'} a session ${headersSent ? 'after' : 'before'} headers are sent`, async () => {
                        const authOptions = {
                            ...defaultConfig.authOptions,
                            tokenMethod,
                            authTokenHeaderKey: 'vendure-auth-token',
                        };
                        const app = express();
                        app.use(cookieSession({ name: 'session', keys: ['session-token-test-key'] }));
                        let sessionError: unknown;
                        app.get('/', (req, res) => {
                            try {
                                setSessionToken({
                                    req,
                                    res,
                                    authOptions,
                                    rememberMe: false,
                                    sessionToken: 'initial-token',
                                });
                                if (headersSent) {
                                    res.flushHeaders();
                                }
                                setSessionToken({ req, res, authOptions, rememberMe: true, sessionToken });
                            } catch (error) {
                                sessionError = error;
                            }
                            res.end('complete');
                        });
                        const server = app.listen(0, '127.0.0.1');
                        await new Promise<void>(resolve => server.once('listening', resolve));
                        try {
                            const response = await fetch(
                                `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
                                { signal: AbortSignal.timeout(5000) },
                            );
                            expect(await response.text()).toBe('complete');
                            expect(sessionError).toBeUndefined();
                            const deliveredToken = headersSent ? 'initial-token' : sessionToken;
                            expect(response.headers.get(authOptions.authTokenHeaderKey)).toBe(
                                tokenMethod.includes('bearer') ? deliveredToken : null,
                            );
                            const cookie = response.headers
                                .getSetCookie()
                                .find(value => value.startsWith('session='));
                            if (tokenMethod.includes('cookie')) {
                                expect(cookie).toBeDefined();
                                const encoded = cookie?.split(';')[0].slice('session='.length) ?? '';
                                expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toEqual({
                                    token: deliveredToken,
                                });
                                if (!headersSent) {
                                    expect(cookie).toContain('expires=');
                                }
                            } else {
                                expect(cookie).toBeUndefined();
                            }
                        } finally {
                            server.closeAllConnections();
                            await new Promise<void>((resolve, reject) =>
                                server.close(error => (error ? reject(error) : resolve())),
                            );
                        }
                    });
                }
            }
        });
    }
});
