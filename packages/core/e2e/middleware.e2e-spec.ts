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
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                middleware: [
                    {
                        handler: json({ limit: '10mb' }),
                        route: '/admin-api',
                        beforeListen: true,
                    },
                ],
            },
        }),
    );

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
});
