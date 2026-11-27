import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { User } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { InitialData } from '../src/index';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    createChannelDocument,
    getAssetListDocument,
    getCollectionsDocument,
    getProductListDocument,
    getProductWithVariantsDocument,
} from './graphql/shared-definitions';

type ChannelFragment = FragmentOf<typeof channelFragment>;

describe('populate() function', () => {
    let channel2: ChannelFragment;
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        // logger: new DefaultLogger(),
        customFields: {
            Product: [
                { type: 'string', name: 'pageType' },
                {
                    name: 'owner',
                    public: true,
                    nullable: true,
                    type: 'relation',
                    entity: User,
                    eager: true,
                },
                {
                    name: 'keywords',
                    public: true,
                    nullable: true,
                    type: 'string',
                    list: true,
                },
                {
                    name: 'localName',
                    type: 'localeString',
                },
            ],
            ProductVariant: [
                { type: 'boolean', name: 'valid' },
                { type: 'int', name: 'weight' },
            ],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, collections: [] },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'Channel 2',
                token: 'channel-2',
                defaultCurrencyCode: CurrencyCode.EUR,
                defaultLanguageCode: LanguageCode.en,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_2',
                pricesIncludeTax: true,
            },
        });
        channel2 = createChannel as ChannelFragment;
        await server.destroy();
    }, TEST_SETUP_TIMEOUT_MS);

    /**
     * Runs `populate()` on the test server before the tests of a `describe` block, and closes the
     * app it bootstrapped after them. The setup bootstraps a full server and imports products and
     * assets, so it gets the setup timeout rather than the default hook timeout.
     *
     * The teardown closes the app even when the setup timed out. A timed-out setup keeps running,
     * and its app would keep the port. The next block's bootstrap would then fail with EADDRINUSE.
     */
    function populateForBlock(
        initialDataForPopulate: InitialData,
        csvFile: string,
        channelToken?: () => string,
    ): void {
        let bootstrapping: Promise<void> | undefined;
        beforeAll(async () => {
            await populate(
                async () => {
                    bootstrapping = server.bootstrap();
                    await bootstrapping;
                    return server.app;
                },
                initialDataForPopulate,
                csvFile,
                channelToken?.(),
            );
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            // Without an app this block started, `server.app` is the previous block's, which that
            // block closed.
            const started = await bootstrapping?.then(
                () => true,
                () => false,
            );
            if (started) {
                await server.app.close();
            }
        }, TEST_SETUP_TIMEOUT_MS);
    }

    const initialDataWithCollection = (collectionName: string): InitialData => ({
        defaultLanguage: initialData.defaultLanguage,
        defaultZone: initialData.defaultZone,
        taxRates: [],
        shippingMethods: [],
        paymentMethods: [],
        countries: [],
        collections: [{ name: collectionName, filters: [] }],
    });

    describe('populating default channel', () => {
        populateForBlock(
            initialDataWithCollection('Collection 1'),
            path.join(__dirname, 'fixtures', 'product-import.csv'),
        );

        it('populates products', async () => {
            await adminClient.asSuperAdmin();
            const { products } = await adminClient.query(getProductListDocument);
            expect(products.totalItems).toBe(4);
            expect(products.items.map(i => i.name).sort()).toEqual([
                'Artists Smock',
                'Giotto Mega Pencils',
                'Mabef M/02 Studio Easel',
                'Perfect Paper Stretcher',
            ]);
        });

        it('populates assets', async () => {
            const { assets } = await adminClient.query(getAssetListDocument);
            expect(assets.items.map(i => i.name).sort()).toEqual([
                'box-of-12.jpg',
                'box-of-8.jpg',
                'pps1.jpg',
                'pps2.jpg',
            ]);
        });

        it('populates collections', async () => {
            const { collections } = await adminClient.query(getCollectionsDocument);
            expect(collections.items.map(i => i.name).sort()).toEqual(['Collection 1']);
        });
    });

    describe('populating a non-default channel', () => {
        populateForBlock(
            initialDataWithCollection('Collection 2'),
            path.join(__dirname, 'fixtures', 'product-import-channel.csv'),
            () => channel2.token,
        );

        it('populates products', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(channel2.token);
            const { products } = await adminClient.query(getProductListDocument);
            expect(products.totalItems).toBe(1);
            expect(products.items.map(i => i.name).sort()).toEqual(['Model Hand']);
        });

        it('populates assets', async () => {
            const { assets } = await adminClient.query(getAssetListDocument);
            expect(assets.items.map(i => i.name).sort()).toEqual(['vincent-botta-736919-unsplash.jpg']);
        });

        it('populates collections', async () => {
            const { collections } = await adminClient.query(getCollectionsDocument);
            expect(collections.items.map(i => i.name).sort()).toEqual(['Collection 2']);
        });

        it('product also assigned to default channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { products } = await adminClient.query(getProductListDocument);
            expect(products.items.map(i => i.name).includes('Model Hand')).toBe(true);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1445
    describe('clashing option names', () => {
        populateForBlock(
            initialDataWithCollection('Collection 1'),
            path.join(__dirname, 'fixtures', 'product-import-option-values.csv'),
        );

        it('populates variants & options', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { products } = await adminClient.query(getProductListDocument, {
                options: {
                    filter: {
                        slug: { eq: 'foo' },
                    },
                },
            });
            expect(products.totalItems).toBe(1);
            const fooProduct = products.items[0];
            expect(fooProduct.name).toBe('Foo');

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: fooProduct.id,
            });

            expect(product?.variants.length).toBe(4);
            expect(product?.optionGroups.map(og => og.name).sort()).toEqual(['Bar', 'Foo']);
            expect(
                product?.variants
                    .find(v => v.sku === 'foo-fiz-buz')
                    ?.options.map(o => o.name)
                    .sort(),
            ).toEqual(['buz', 'fiz']);
        });
    });
});
