/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { UuidIdStrategy } from '@vendure/core';
// This import is here to simulate the behaviour of
// the package end-user importing symbols from the
// @vendure/core barrel file. Doing so will then cause the
// recursive evaluation of all imported files. This tests
// the resilience of the id strategy implementation to the
// order of file evaluation.
import '@vendure/core/dist/index';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { getProductListDocument } from './graphql/shared-definitions';

describe('UuidIdStrategy', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        entityOptions: { entityIdStrategy: new UuidIdStrategy() },
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('uses uuids', async () => {
        const { products } = await adminClient.query(getProductListDocument, {
            options: {
                take: 1,
            },
        });

        expect(isV4Uuid(products.items[0].id)).toBe(true);
    });
});

/**
 * Returns true if the id string matches the format for a v4 UUID.
 */
function isV4Uuid(id: string): boolean {
    return /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i.test(id);
}
