import cookieSession from 'cookie-session';
import express from 'express';
import ms from 'ms';
import { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../../config/default-config';

import { setSessionToken } from './set-session-token';

type Case = {
    tokenMethod: Array<'bearer' | 'cookie'>;
    headersSent: boolean;
    sessionToken: string;
    expectedHeader: string | null;
    expectedCookieToken: string | null;
    expectedOneYearExpiry: boolean;
};

const AUTH_TOKEN_HEADER_KEY = 'vendure-auth-token';

// #5519 - when the response headers have already been sent, the session token written
// before that point is the one the client receives.
const cases: Case[] = [
    {
        tokenMethod: ['bearer'],
        headersSent: false,
        sessionToken: 'replacement-token',
        expectedHeader: 'replacement-token',
        expectedCookieToken: null,
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['bearer'],
        headersSent: false,
        sessionToken: '',
        expectedHeader: '',
        expectedCookieToken: null,
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['bearer'],
        headersSent: true,
        sessionToken: 'replacement-token',
        expectedHeader: 'initial-token',
        expectedCookieToken: null,
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['bearer'],
        headersSent: true,
        sessionToken: '',
        expectedHeader: 'initial-token',
        expectedCookieToken: null,
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['cookie'],
        headersSent: false,
        sessionToken: 'replacement-token',
        expectedHeader: null,
        expectedCookieToken: 'replacement-token',
        expectedOneYearExpiry: true,
    },
    {
        tokenMethod: ['cookie'],
        headersSent: false,
        sessionToken: '',
        expectedHeader: null,
        expectedCookieToken: '',
        expectedOneYearExpiry: true,
    },
    {
        tokenMethod: ['cookie'],
        headersSent: true,
        sessionToken: 'replacement-token',
        expectedHeader: null,
        expectedCookieToken: 'initial-token',
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['cookie'],
        headersSent: true,
        sessionToken: '',
        expectedHeader: null,
        expectedCookieToken: 'initial-token',
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['bearer', 'cookie'],
        headersSent: false,
        sessionToken: 'replacement-token',
        expectedHeader: 'replacement-token',
        expectedCookieToken: 'replacement-token',
        expectedOneYearExpiry: true,
    },
    {
        tokenMethod: ['bearer', 'cookie'],
        headersSent: false,
        sessionToken: '',
        expectedHeader: '',
        expectedCookieToken: '',
        expectedOneYearExpiry: true,
    },
    {
        tokenMethod: ['bearer', 'cookie'],
        headersSent: true,
        sessionToken: 'replacement-token',
        expectedHeader: 'initial-token',
        expectedCookieToken: 'initial-token',
        expectedOneYearExpiry: false,
    },
    {
        tokenMethod: ['bearer', 'cookie'],
        headersSent: true,
        sessionToken: '',
        expectedHeader: 'initial-token',
        expectedCookieToken: 'initial-token',
        expectedOneYearExpiry: false,
    },
];

describe('setSessionToken', () => {
    it.each(cases)(
        'tokenMethod $tokenMethod, headersSent $headersSent, sessionToken $sessionToken',
        async ({
            tokenMethod,
            headersSent,
            sessionToken,
            expectedHeader,
            expectedCookieToken,
            expectedOneYearExpiry,
        }) => {
            const authOptions = {
                ...defaultConfig.authOptions,
                tokenMethod,
                authTokenHeaderKey: AUTH_TOKEN_HEADER_KEY,
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
                const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
                    signal: AbortSignal.timeout(5000),
                });
                expect(await response.text()).toBe('complete');
                expect(sessionError).toBeUndefined();
                expect(response.headers.get(AUTH_TOKEN_HEADER_KEY)).toBe(expectedHeader);

                const cookie = response.headers.getSetCookie().find(value => value.startsWith('session='));
                if (expectedCookieToken === null) {
                    expect(cookie).toBeUndefined();
                    return;
                }
                if (!cookie) {
                    expect.fail('expected a session cookie');
                }
                const encoded = cookie.split(';')[0].slice('session='.length);
                expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toEqual({
                    token: expectedCookieToken,
                });
                const expires = /expires=([^;]+)/.exec(cookie)?.[1];
                if (!expectedOneYearExpiry) {
                    // rememberMe arrived after the cookie was written, so it stays a browser-session cookie.
                    expect(expires).toBeUndefined();
                } else {
                    // rememberMe: true sets maxAge to 1 year. The tolerance covers the cookie's
                    // whole-second precision and the time the request takes.
                    expect(Math.abs(new Date(expires ?? 0).getTime() - (Date.now() + ms('1y')))).toBeLessThan(
                        ms('1m'),
                    );
                }
            } finally {
                server.closeAllConnections();
                await new Promise<void>((resolve, reject) =>
                    server.close(error => (error ? reject(error) : resolve())),
                );
            }
        },
    );
});
