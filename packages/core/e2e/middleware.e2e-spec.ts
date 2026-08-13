import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { json } from 'express';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

// https://github.com/vendurehq/vendure/issues/5028
//
// A route-scoped `beforeListen` body-parser must not disable body parsing on other routes.
// body-parser's `json()` is named `jsonParser`, which is the exact name NestJS's ExpressAdapter
// scans for (ignoring the mount path) when deciding whether to register its own global parser.
// Without the guard in `wrapEarlyMiddlewareHandler`, mounting `json()` on `/admin-api` makes NestJS
// skip its global parser, leaving `/shop-api` unable to parse JSON request bodies.
describe('route-scoped beforeListen middleware (#5028)', () => {
    const config = mergeConfig(testConfig(), {
        apiOptions: {
            middleware: [
                {
                    handler: json({ limit: '10mb' }),
                    route: '/admin-api',
                    beforeListen: true,
                },
            ],
        },
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    // A JSON body over Express's default 100kb limit but well under the scoped 10mb limit.
    const oversizedBody = JSON.stringify({
        query: '{ me { identifier } }',
        padding: 'x'.repeat(200 * 1024),
    });
    const postJson = (apiPath: string) =>
        fetch(`http://localhost:${config.apiOptions.port}${apiPath}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: oversizedBody,
        });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('parses JSON bodies on the shop API', async () => {
        const { activeChannel } = await shopClient.query(gql`
            query {
                activeChannel {
                    id
                    code
                }
            }
        `);
        expect(activeChannel.code).toBe('__default_channel__');
    });

    it('parses JSON bodies on the route-scoped admin API', async () => {
        await adminClient.asSuperAdmin();
        const { me } = await adminClient.query(gql`
            query {
                me {
                    identifier
                }
            }
        `);
        expect(me.identifier).toBe('superadmin');
    });

    // The scoped 10mb parser must still take effect on its own route...
    it('honours the raised body-size limit on the route-scoped admin API', async () => {
        const response = await postJson('/admin-api');
        expect(response.status).toBe(200);
    });

    // ...while the raised limit does not leak to other routes, which keep the default 100kb parser
    // and therefore reject the same oversized body (Vendure surfaces the PayloadTooLargeError as a
    // 5xx, so we only assert that the request was rejected rather than pinning an exact status).
    it('does not leak the raised body-size limit to other routes', async () => {
        const response = await postJson('/shop-api');
        expect(response.status).toBeGreaterThanOrEqual(400);
    });
});
