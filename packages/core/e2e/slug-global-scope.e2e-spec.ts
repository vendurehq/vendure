import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { DefaultSlugStrategy, mergeConfig } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { createChannelDocument } from './graphql/shared-definitions';

// OSS-1000 — `new DefaultSlugStrategy({ uniqueness: 'global' })` keeps slugs unique across all channels,
// for setups such as a marketplace where one storefront shows several channels' products.
describe('Slug uniqueness: global', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            entityOptions: { slugStrategy: new DefaultSlugStrategy({ uniqueness: 'global' }) },
        }),
    );
    const B_TOKEN = 'slug-global-b';
    const C_TOKEN = 'slug-global-c';
    let bChannelId: string;

    const createProduct = graphql(`
        mutation GlobalSlugCreateProduct($input: CreateProductInput!) {
            createProduct(input: $input) {
                id
                slug
            }
        }
    `);
    const assignProducts = graphql(`
        mutation GlobalSlugAssignProducts($input: AssignProductsToChannelInput!) {
            assignProductsToChannel(input: $input) {
                id
            }
        }
    `);
    const slugForEntity = graphql(`
        query GlobalSlugForEntity($input: SlugForEntityInput!) {
            slugForEntity(input: $input)
        }
    `);

    async function newProduct(token: string, slug: string) {
        adminClient.setChannelToken(token);
        const { createProduct: p } = await adminClient.query(createProduct, {
            input: { translations: [{ languageCode: LanguageCode.en, name: slug, slug, description: '' }] },
        });
        return p;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, token] of [
            ['global-b', B_TOKEN],
            ['global-c', C_TOKEN],
        ]) {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            if (code === 'global-b') {
                bChannelId = (createChannel as any).id;
            }
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a slug used in one channel is suffixed in another', async () => {
        expect((await newProduct(B_TOKEN, 'global-one')).slug).toBe('global-one');
        expect((await newProduct(C_TOKEN, 'global-one')).slug).toBe('global-one-2');
    });

    it('slugForEntity checks every channel', async () => {
        adminClient.setChannelToken(C_TOKEN);
        const { slugForEntity: s } = await adminClient.query(slugForEntity, {
            input: { entityName: 'Product', fieldName: 'slug', inputValue: 'global one' },
        });
        expect(s).toBe('global-one-1');
    });

    it('assigning to another channel never conflicts', async () => {
        const p = await newProduct(C_TOKEN, 'global-two');
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignProductsToChannel } = await adminClient.query(assignProducts, {
            input: { channelId: bChannelId, productIds: [p.id] },
        });
        expect(assignProductsToChannel.map(x => x.id)).toEqual([p.id]);
    });
});
