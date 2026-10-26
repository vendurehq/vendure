import { SUPER_ADMIN_USER_IDENTIFIER, SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const config = mergeConfig(testConfig(), {
    apiOptions: {
        csrfPrevention: true,
        // The deprecated debug flags must not turn stack traces back on for either API.
        adminApiDebug: true,
        shopApiDebug: true,
    },
    authOptions: {
        tokenMethod: 'cookie' as const,
        cookieOptions: { sameSite: 'lax' as const, secret: 'csrf-prevention-e2e' },
    },
});

const ADMIN_URL = `http://localhost:${config.apiOptions.port}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;
const SHOP_URL = `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath ?? 'shop-api'}`;

const LOGIN_MUTATION =
    `mutation { login(username: "${SUPER_ADMIN_USER_IDENTIFIER}", password: "${SUPER_ADMIN_USER_PASSWORD}") ` +
    '{ ... on CurrentUser { id identifier } ... on ErrorResult { errorCode } } }';

function post(contentType: string, body: string, extraHeaders: Record<string, string> = {}) {
    return fetch(ADMIN_URL, {
        method: 'POST',
        // A cross-site HTML form POST arrives as a top-level navigation, so the only thing that
        // marks it out from a legitimate call is the content type.
        headers: { 'content-type': contentType, origin: 'https://evil.example.com', ...extraHeaders },
        body,
    });
}

function formBody() {
    return new URLSearchParams({ query: LOGIN_MUTATION }).toString();
}

function multipartBody(boundary: string) {
    return (
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="operations"\r\n\r\n' +
        JSON.stringify({ query: LOGIN_MUTATION, variables: {} }) +
        `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="map"\r\n\r\n' +
        '{}' +
        `\r\n--${boundary}--\r\n`
    );
}

describe('apiOptions.csrfPrevention', () => {
    const { server } = createTestEnvironment(config);
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(async () => {
        // Apollo Server falls back to including stack traces in error responses whenever
        // NODE_ENV is not "production" or "test", and reads it when the server is constructed.
        // Running under "development" lets the stack trace tests below catch that fallback.
        // This applies to the whole suite, and the CSRF tests behave the same under either value.
        process.env.NODE_ENV = 'development';
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('rejects a form-urlencoded login and sets no session cookie', async () => {
        const res = await post('application/x-www-form-urlencoded', formBody());

        expect(res.status).toBe(400);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(await res.text()).toContain('Cross-Site Request Forgery');
    });

    it('rejects a multipart login and sets no session cookie', async () => {
        const boundary = '----csrfPreventionBoundary';
        const res = await post(`multipart/form-data; boundary=${boundary}`, multipartBody(boundary));

        expect(res.status).toBe(400);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(await res.text()).toContain('Cross-Site Request Forgery');
    });

    it('rejects a text/plain login', async () => {
        const res = await post('text/plain', JSON.stringify({ query: LOGIN_MUTATION }));

        expect(res.status).toBe(400);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(await res.text()).toContain('Cross-Site Request Forgery');
    });

    it('allows a normal application/json login', async () => {
        const res = await post('application/json', JSON.stringify({ query: LOGIN_MUTATION }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data.login.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);
        expect(res.headers.get('set-cookie')).toContain('session=');
    });

    it('rejects a GET query that sends no content-type', async () => {
        // Apollo treats a bare GET as something a browser could have sent without a preflight, so
        // storefronts which use GET for cacheable queries have to send the header too.
        const res = await fetch(`${ADMIN_URL}?query=${encodeURIComponent('{ me { id } }')}`);

        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Cross-Site Request Forgery');
    });

    it('allows a GET query when the client sends Apollo-Require-Preflight', async () => {
        const res = await fetch(`${ADMIN_URL}?query=${encodeURIComponent('{ me { id } }')}`, {
            headers: { 'apollo-require-preflight': 'true' },
        });

        expect(res.status).toBe(200);
    });

    it('allows a form content type when the client sends Apollo-Require-Preflight', async () => {
        // This is the header sent by @vendure/admin-ui, @vendure/dashboard and @vendure/testing,
        // which is what keeps their multipart asset uploads working.
        const res = await post('application/x-www-form-urlencoded', formBody(), {
            'apollo-require-preflight': 'true',
        });

        expect(res.status).toBe(200);
        expect((await res.json()).errors).toBeUndefined();
    });

    describe('error responses', () => {
        // Requests which Apollo rejects before running the GraphQL pipeline are formatted by
        // Apollo itself, so they must not expose a stack trace (and with it server file paths).
        it('omits the stack trace from a rejected CSRF request', async () => {
            const res = await post('text/plain', JSON.stringify({ query: LOGIN_MUTATION }));
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.errors[0].extensions.code).toBe('BAD_REQUEST');
            expect(body.errors[0].extensions.stacktrace).toBeUndefined();
        });

        for (const [apiName, url] of [
            ['admin', ADMIN_URL],
            ['shop', SHOP_URL],
        ]) {
            it(`omits the stack trace from a request with an empty body (${apiName} API)`, async () => {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '',
                });
                const body = await res.json();

                expect(res.status).toBe(400);
                expect(body.errors[0].extensions.code).toBe('BAD_REQUEST');
                expect(body.errors[0].extensions.stacktrace).toBeUndefined();
            });

            it(`omits the stack trace from a resolver error (${apiName} API)`, async () => {
                // An anonymous `me` query is rejected by the auth guard during execution.
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ query: '{ me { id } }' }),
                });
                const body = await res.json();

                expect(body.errors[0].extensions.code).toBe('FORBIDDEN');
                expect(body.errors[0].extensions.stacktrace).toBeUndefined();
            });
        }
    });
});
