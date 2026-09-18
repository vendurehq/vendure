import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    dummyPaymentHandler,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { manualFulfillmentHandler } from '../src/config/fulfillment/manual-fulfillment-handler';

import {
    testAssignStockLocationToChannelDocument,
    testCreateStockLocationDocument,
    testRemoveStockLocationsFromChannelDocument,
} from './graphql/admin-definitions';
import { graphql, ResultOf } from './graphql/graphql-admin';
import {
    assignCollectionsToChannelDocument,
    assignFacetsToChannelDocument,
    assignProductOptionGroupsToChannelDocument,
    assignProductToChannelDocument,
    assignProductVariantToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createCollectionDocument,
    createFacetDocument,
    createProductDocument,
    createProductOptionGroupDocument,
    createRoleDocument,
    createShippingMethodDocument,
    getProductWithVariantsDocument,
    removeFacetsFromChannelDocument,
    removeProductFromChannelDocument,
    removeProductOptionGroupsFromChannelDocument,
    removeProductVariantFromChannelDocument,
} from './graphql/shared-definitions';

const getCollectionByIdDocument = graphql(`
    query GetCollectionById($id: ID!) {
        collection(id: $id) {
            id
            name
        }
    }
`);

const getFacetByIdDocument = graphql(`
    query GetFacetById($id: ID!) {
        facet(id: $id) {
            id
            name
        }
    }
`);

const getProductOptionGroupByIdDocument = graphql(`
    query GetProductOptionGroupById($id: ID!) {
        productOptionGroup(id: $id) {
            id
            code
        }
    }
`);

const getProductVariantByIdDocument = graphql(`
    query GetProductVariantById($id: ID!) {
        productVariant(id: $id) {
            id
            name
        }
    }
`);

const createPaymentMethodForScopeTestDocument = graphql(`
    mutation CreatePaymentMethodForScopeTest($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
            code
            name
        }
    }
`);

const assignPaymentMethodsToChannelDocument = graphql(`
    mutation AssignPaymentMethodsToChannelForScopeTest($input: AssignPaymentMethodsToChannelInput!) {
        assignPaymentMethodsToChannel(input: $input) {
            id
            name
        }
    }
`);

const assignShippingMethodsToChannelDocument = graphql(`
    mutation AssignShippingMethodsToChannelForScopeTest($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
            name
        }
    }
`);

const removeCollectionsFromChannelDocument = graphql(`
    mutation RemoveCollectionsFromChannelForScopeTest($input: RemoveCollectionsFromChannelInput!) {
        removeCollectionsFromChannel(input: $input) {
            id
            name
        }
    }
`);

const removePaymentMethodsFromChannelDocument = graphql(`
    mutation RemovePaymentMethodsFromChannelForScopeTest($input: RemovePaymentMethodsFromChannelInput!) {
        removePaymentMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`);

const removeShippingMethodsFromChannelDocument = graphql(`
    mutation RemoveShippingMethodsFromChannelForScopeTest($input: RemoveShippingMethodsFromChannelInput!) {
        removeShippingMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`);

const getPaymentMethodByIdDocument = graphql(`
    query GetPaymentMethodById($id: ID!) {
        paymentMethod(id: $id) {
            id
            name
        }
    }
`);

const getShippingMethodByIdDocument = graphql(`
    query GetShippingMethodById($id: ID!) {
        shippingMethod(id: $id) {
            id
            name
        }
    }
`);

const getStockLocationByIdDocument = graphql(`
    query GetStockLocationById($id: ID!) {
        stockLocation(id: $id) {
            id
            name
        }
    }
`);

const getProductChannelsDocument = graphql(`
    query GetProductChannels($id: ID!) {
        product(id: $id) {
            id
            channels {
                id
            }
        }
    }
`);

const getProductVariantChannelsDocument = graphql(`
    query GetProductVariantChannels($id: ID!) {
        productVariant(id: $id) {
            id
            channels {
                id
            }
        }
    }
`);

const getProductOptionGroupChannelsDocument = graphql(`
    query GetProductOptionGroupChannels($id: ID!) {
        productOptionGroup(id: $id) {
            id
            channels {
                id
            }
        }
    }
`);

/**
 * Regression tests for GHSA-422x-jq57-j238.
 *
 * The `assign*ToChannel` mutations check that the Administrator has permission on the *target*
 * Channel, but used to load the source entities with an unscoped lookup. An Administrator scoped
 * to their own Channel could therefore name the id of an entity belonging to a completely
 * different Channel and pull it into their own Channel, gaining full edit and delete control
 * over the shared underlying record.
 */
describe('assign-to-channel source Channel scoping', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        paymentOptions: {
            paymentMethodHandlers: [dummyPaymentHandler],
        },
    });

    const VICTIM_CHANNEL_TOKEN = 'victim_channel_token';
    const ATTACKER_CHANNEL_TOKEN = 'attacker_channel_token';
    const PARTNER_CHANNEL_TOKEN = 'partner_channel_token';
    const ATTACKER_EMAIL = 'attacker@test.com';
    const ATTACKER_PASSWORD = 'test';
    const VICTIM_ADMIN_EMAIL = 'victim-admin@test.com';
    const VICTIM_ADMIN_PASSWORD = 'test';

    let attackerChannelId: string;
    let victimChannelId: string;
    let partnerChannelId: string;
    let defaultOnlyProductId: string;
    let victimProduct: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;
    let victimCollectionId: string;
    let victimFacetId: string;
    let victimOptionGroupId: string;
    let victimPaymentMethodId: string;
    let victimShippingMethodId: string;
    let victimStockLocationId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        const { createChannel: victimChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'victim-channel',
                token: VICTIM_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        victimChannelId = (victimChannel as { id: string }).id;

        const { createChannel: attackerChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'attacker-channel',
                token: ATTACKER_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        attackerChannelId = (attackerChannel as { id: string }).id;

        // A third Channel the victim-Channel Administrator also controls, used to prove that the fix
        // scopes to the active Channel rather than to the default Channel.
        const { createChannel: partnerChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'partner-channel',
                token: PARTNER_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        partnerChannelId = (partnerChannel as { id: string }).id;

        // Everything below is created in the default Channel and then assigned to the victim
        // Channel. The attacker's Channel has no relationship with any of it.
        const { product } = await adminClient.query(getProductWithVariantsDocument, { id: 'T_1' });
        victimProduct = product as NonNullable<typeof product>;

        const { createCollection } = await adminClient.query(createCollectionDocument, {
            input: {
                filters: [],
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Victim Collection',
                        description: '',
                        slug: 'victim-collection',
                    },
                ],
            },
        });
        victimCollectionId = createCollection.id;

        const { createFacet } = await adminClient.query(createFacetDocument, {
            input: {
                code: 'victim-facet',
                isPrivate: false,
                translations: [{ languageCode: LanguageCode.en, name: 'Victim Facet' }],
                values: [
                    {
                        code: 'victim-facet-value',
                        translations: [{ languageCode: LanguageCode.en, name: 'Victim Facet Value' }],
                    },
                ],
            },
        });
        victimFacetId = createFacet.id;

        const { createProductOptionGroup } = await adminClient.query(createProductOptionGroupDocument, {
            input: {
                code: 'victim-option-group',
                translations: [{ languageCode: LanguageCode.en, name: 'Victim Option Group' }],
                options: [
                    {
                        code: 'victim-option',
                        translations: [{ languageCode: LanguageCode.en, name: 'Victim Option' }],
                    },
                ],
            },
        });
        victimOptionGroupId = createProductOptionGroup.id;

        await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: victimChannelId, productIds: [victimProduct.id] },
        });
        await adminClient.query(assignCollectionsToChannelDocument, {
            input: { channelId: victimChannelId, collectionIds: [victimCollectionId] },
        });
        await adminClient.query(assignFacetsToChannelDocument, {
            input: { channelId: victimChannelId, facetIds: [victimFacetId] },
        });
        await adminClient.query(assignProductOptionGroupsToChannelDocument, {
            input: { channelId: victimChannelId, productOptionGroupIds: [victimOptionGroupId] },
        });

        const { createPaymentMethod } = await adminClient.query(createPaymentMethodForScopeTestDocument, {
            input: {
                code: 'victim-payment-method',
                enabled: true,
                handler: {
                    code: dummyPaymentHandler.code,
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    { languageCode: LanguageCode.en, name: 'Victim Payment Method', description: '' },
                ],
            },
        });
        victimPaymentMethodId = createPaymentMethod.id;

        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'victim-shipping-method',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '500' },
                        { name: 'includesTax', value: 'auto' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
                translations: [
                    { languageCode: LanguageCode.en, name: 'Victim Shipping Method', description: '' },
                ],
            },
        });
        victimShippingMethodId = createShippingMethod.id;

        const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
            input: { name: 'Victim Stock Location' },
        });
        victimStockLocationId = createStockLocation.id;

        await adminClient.query(assignPaymentMethodsToChannelDocument, {
            input: { channelId: victimChannelId, paymentMethodIds: [victimPaymentMethodId] },
        });
        await adminClient.query(assignShippingMethodsToChannelDocument, {
            input: { channelId: victimChannelId, shippingMethodIds: [victimShippingMethodId] },
        });
        await adminClient.query(testAssignStockLocationToChannelDocument, {
            input: { channelId: victimChannelId, stockLocationIds: [victimStockLocationId] },
        });

        // Stays in the default Channel only, so it is invisible to the victim-Channel Administrator.
        const { createProduct } = await adminClient.query(createProductDocument, {
            input: {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Default Channel Only Product',
                        slug: 'default-channel-only-product',
                        description: '',
                    },
                ],
            },
        });
        defaultOnlyProductId = createProduct.id;

        const { createRole: victimAdminRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'victim-channel-admin',
                description: 'victim and partner channel admin',
                channelIds: [victimChannelId, partnerChannelId],
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateCatalog,
                    Permission.UpdateCatalog,
                    Permission.DeleteCatalog,
                    Permission.ReadProduct,
                    Permission.CreateProduct,
                    Permission.UpdateProduct,
                    Permission.DeleteProduct,
                ],
            },
        });

        await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Vic',
                lastName: 'Tim',
                emailAddress: VICTIM_ADMIN_EMAIL,
                password: VICTIM_ADMIN_PASSWORD,
                roleIds: [victimAdminRole.id],
            },
        });

        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'attacker-channel-admin',
                description: 'attacker channel admin',
                channelIds: [attackerChannelId],
                permissions: [
                    Permission.ReadCatalog,
                    Permission.CreateCatalog,
                    Permission.UpdateCatalog,
                    Permission.DeleteCatalog,
                    Permission.ReadProduct,
                    Permission.CreateProduct,
                    Permission.UpdateProduct,
                    Permission.ReadSettings,
                    Permission.UpdateSettings,
                    Permission.DeleteSettings,
                    Permission.ReadPaymentMethod,
                    Permission.UpdatePaymentMethod,
                    Permission.ReadShippingMethod,
                    Permission.UpdateShippingMethod,
                    Permission.ReadStockLocation,
                    Permission.CreateStockLocation,
                    Permission.UpdateStockLocation,
                    Permission.DeleteStockLocation,
                ],
            },
        });

        await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Att',
                lastName: 'Acker',
                emailAddress: ATTACKER_EMAIL,
                password: ATTACKER_PASSWORD,
                roleIds: [createRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function loginAsAttacker() {
        adminClient.setChannelToken(ATTACKER_CHANNEL_TOKEN);
        await adminClient.asUserWithCredentials(ATTACKER_EMAIL, ATTACKER_PASSWORD);
    }

    async function asSuperAdminIn(channelToken: string) {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(channelToken);
    }

    async function loginAsVictimChannelAdmin() {
        adminClient.setChannelToken(VICTIM_CHANNEL_TOKEN);
        await adminClient.asUserWithCredentials(VICTIM_ADMIN_EMAIL, VICTIM_ADMIN_PASSWORD);
    }

    it('attacker cannot see the victim entities to begin with', async () => {
        await loginAsAttacker();

        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product).toBeNull();

        const { collection } = await adminClient.query(getCollectionByIdDocument, {
            id: victimCollectionId,
        });
        expect(collection).toBeNull();

        const { facet } = await adminClient.query(getFacetByIdDocument, { id: victimFacetId });
        expect(facet).toBeNull();

        const { productOptionGroup } = await adminClient.query(getProductOptionGroupByIdDocument, {
            id: victimOptionGroupId,
        });
        expect(productOptionGroup).toBeNull();

        const { productVariant } = await adminClient.query(getProductVariantByIdDocument, {
            id: victimProduct.variants[0].id,
        });
        expect(productVariant).toBeNull();

        const { paymentMethod } = await adminClient.query(getPaymentMethodByIdDocument, {
            id: victimPaymentMethodId,
        });
        expect(paymentMethod).toBeNull();

        const { shippingMethod } = await adminClient.query(getShippingMethodByIdDocument, {
            id: victimShippingMethodId,
        });
        expect(shippingMethod).toBeNull();

        const { stockLocation } = await adminClient.query(getStockLocationByIdDocument, {
            id: victimStockLocationId,
        });
        expect(stockLocation).toBeNull();
    });

    it('assignProductsToChannel cannot pull in a Product from another Channel', async () => {
        await loginAsAttacker();

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: attackerChannelId, productIds: [victimProduct.id] },
        });
        expect(assignProductsToChannel).toEqual([]);

        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product).toBeNull();

        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: fromDefaultChannel } = await adminClient.query(getProductChannelsDocument, {
            id: victimProduct.id,
        });
        expect(fromDefaultChannel?.channels.map(c => c.id).sort()).toEqual(['T_1', victimChannelId].sort());
    });

    it('assignProductVariantsToChannel cannot pull in a ProductVariant from another Channel', async () => {
        await loginAsAttacker();

        const { assignProductVariantsToChannel } = await adminClient.query(
            assignProductVariantToChannelDocument,
            {
                input: {
                    channelId: attackerChannelId,
                    productVariantIds: [victimProduct.variants[0].id],
                },
            },
        );
        expect(assignProductVariantsToChannel).toEqual([]);

        const { productVariant } = await adminClient.query(getProductVariantByIdDocument, {
            id: victimProduct.variants[0].id,
        });
        expect(productVariant).toBeNull();

        // The parent Product must not have been dragged in either.
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product).toBeNull();
    });

    it('assignCollectionsToChannel cannot pull in a Collection from another Channel', async () => {
        await loginAsAttacker();

        const { assignCollectionsToChannel } = await adminClient.query(assignCollectionsToChannelDocument, {
            input: { channelId: attackerChannelId, collectionIds: [victimCollectionId] },
        });
        expect(assignCollectionsToChannel).toEqual([]);

        const { collection } = await adminClient.query(getCollectionByIdDocument, {
            id: victimCollectionId,
        });
        expect(collection).toBeNull();
    });

    it('assignFacetsToChannel cannot pull in a Facet from another Channel', async () => {
        await loginAsAttacker();

        const { assignFacetsToChannel } = await adminClient.query(assignFacetsToChannelDocument, {
            input: { channelId: attackerChannelId, facetIds: [victimFacetId] },
        });
        expect(assignFacetsToChannel).toEqual([]);

        const { facet } = await adminClient.query(getFacetByIdDocument, { id: victimFacetId });
        expect(facet).toBeNull();
    });

    it('assignProductOptionGroupsToChannel cannot pull in a ProductOptionGroup from another Channel', async () => {
        await loginAsAttacker();

        const { assignProductOptionGroupsToChannel } = await adminClient.query(
            assignProductOptionGroupsToChannelDocument,
            {
                input: {
                    channelId: attackerChannelId,
                    productOptionGroupIds: [victimOptionGroupId],
                },
            },
        );
        expect(assignProductOptionGroupsToChannel).toEqual([]);

        const { productOptionGroup } = await adminClient.query(getProductOptionGroupByIdDocument, {
            id: victimOptionGroupId,
        });
        expect(productOptionGroup).toBeNull();
    });

    it('assignPaymentMethodsToChannel cannot pull in a PaymentMethod from another Channel', async () => {
        await loginAsAttacker();

        const { assignPaymentMethodsToChannel } = await adminClient.query(
            assignPaymentMethodsToChannelDocument,
            {
                input: { channelId: attackerChannelId, paymentMethodIds: [victimPaymentMethodId] },
            },
        );
        expect(assignPaymentMethodsToChannel).toEqual([]);

        const { paymentMethod } = await adminClient.query(getPaymentMethodByIdDocument, {
            id: victimPaymentMethodId,
        });
        expect(paymentMethod).toBeNull();
    });

    it('assignShippingMethodsToChannel cannot pull in a ShippingMethod from another Channel', async () => {
        await loginAsAttacker();

        const { assignShippingMethodsToChannel } = await adminClient.query(
            assignShippingMethodsToChannelDocument,
            {
                input: { channelId: attackerChannelId, shippingMethodIds: [victimShippingMethodId] },
            },
        );
        expect(assignShippingMethodsToChannel).toEqual([]);

        const { shippingMethod } = await adminClient.query(getShippingMethodByIdDocument, {
            id: victimShippingMethodId,
        });
        expect(shippingMethod).toBeNull();
    });

    it('assignStockLocationsToChannel cannot pull in a StockLocation from another Channel', async () => {
        await loginAsAttacker();

        const { assignStockLocationsToChannel } = await adminClient.query(
            testAssignStockLocationToChannelDocument,
            {
                input: { channelId: attackerChannelId, stockLocationIds: [victimStockLocationId] },
            },
        );
        expect(assignStockLocationsToChannel).toEqual([]);

        const { stockLocation } = await adminClient.query(getStockLocationByIdDocument, {
            id: victimStockLocationId,
        });
        expect(stockLocation).toBeNull();
    });

    it('a Channel-scoped admin can assign an entity visible in their active Channel to another Channel', async () => {
        await loginAsVictimChannelAdmin();

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: partnerChannelId, productIds: [victimProduct.id] },
        });
        expect(assignProductsToChannel.map(p => p.id)).toEqual([victimProduct.id]);

        adminClient.setChannelToken(PARTNER_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product?.id).toBe(victimProduct.id);
    });

    it('assigns only the ids visible in the active Channel when the input mixes both', async () => {
        await loginAsVictimChannelAdmin();

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: partnerChannelId,
                productIds: [victimProduct.id, defaultOnlyProductId],
            },
        });
        expect(assignProductsToChannel.map(p => p.id)).toEqual([victimProduct.id]);

        adminClient.setChannelToken(PARTNER_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: defaultOnlyProductId,
        });
        expect(product).toBeNull();
    });

    it('a Channel-scoped admin can remove an entity visible in their active Channel from another Channel', async () => {
        await loginAsVictimChannelAdmin();

        const { removeProductsFromChannel } = await adminClient.query(removeProductFromChannelDocument, {
            input: { channelId: partnerChannelId, productIds: [victimProduct.id] },
        });
        expect(removeProductsFromChannel.map(p => p.id)).toEqual([victimProduct.id]);

        adminClient.setChannelToken(PARTNER_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product).toBeNull();
    });

    it('removeProductsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeProductsFromChannel } = await adminClient.query(removeProductFromChannelDocument, {
            input: { channelId: attackerChannelId, productIds: [victimProduct.id] },
        });
        expect(removeProductsFromChannel).toEqual([]);

        // The Product is untouched in the Channel it really belongs to.
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductChannelsDocument, { id: victimProduct.id });
        expect(product?.channels.map(c => c.id).sort()).toEqual(['T_1', victimChannelId].sort());
    });

    it('removeProductVariantsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeProductVariantsFromChannel } = await adminClient.query(
            removeProductVariantFromChannelDocument,
            {
                input: { channelId: attackerChannelId, productVariantIds: [victimProduct.variants[0].id] },
            },
        );
        expect(removeProductVariantsFromChannel).toEqual([]);

        // The ProductVariant is untouched in the Channels it really belongs to.
        await asSuperAdminIn(E2E_DEFAULT_CHANNEL_TOKEN);
        const { productVariant } = await adminClient.query(getProductVariantChannelsDocument, {
            id: victimProduct.variants[0].id,
        });
        expect(productVariant?.channels.map(c => c.id).sort()).toEqual(['T_1', victimChannelId].sort());
    });

    it('removeCollectionsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeCollectionsFromChannel } = await adminClient.query(
            removeCollectionsFromChannelDocument,
            {
                input: { channelId: attackerChannelId, collectionIds: [victimCollectionId] },
            },
        );
        expect(removeCollectionsFromChannel).toEqual([]);

        // Collection has no `channels` field in the Admin API, so read it back by id in the
        // victim Channel instead.
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        const { collection } = await adminClient.query(getCollectionByIdDocument, {
            id: victimCollectionId,
        });
        expect(collection?.id).toBe(victimCollectionId);
    });

    it('removeFacetsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeFacetsFromChannel } = await adminClient.query(removeFacetsFromChannelDocument, {
            input: { channelId: attackerChannelId, facetIds: [victimFacetId] },
        });
        expect(removeFacetsFromChannel).toEqual([]);

        // Facet has no `channels` field in the Admin API, so read it back by id in the victim
        // Channel instead.
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        const { facet } = await adminClient.query(getFacetByIdDocument, { id: victimFacetId });
        expect(facet?.id).toBe(victimFacetId);
    });

    it('removeProductOptionGroupsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeProductOptionGroupsFromChannel } = await adminClient.query(
            removeProductOptionGroupsFromChannelDocument,
            {
                input: { channelId: attackerChannelId, productOptionGroupIds: [victimOptionGroupId] },
            },
        );
        expect(removeProductOptionGroupsFromChannel).toEqual([]);

        // The ProductOptionGroup is untouched in the Channels it really belongs to.
        await asSuperAdminIn(E2E_DEFAULT_CHANNEL_TOKEN);
        const { productOptionGroup } = await adminClient.query(getProductOptionGroupChannelsDocument, {
            id: victimOptionGroupId,
        });
        expect(productOptionGroup?.channels.map(c => c.id).sort()).toEqual(['T_1', victimChannelId].sort());
    });

    it('removePaymentMethodsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removePaymentMethodsFromChannel } = await adminClient.query(
            removePaymentMethodsFromChannelDocument,
            {
                input: { channelId: attackerChannelId, paymentMethodIds: [victimPaymentMethodId] },
            },
        );
        expect(removePaymentMethodsFromChannel).toEqual([]);

        // PaymentMethod has no `channels` field in the Admin API, so read it back by id in the
        // victim Channel instead.
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        const { paymentMethod } = await adminClient.query(getPaymentMethodByIdDocument, {
            id: victimPaymentMethodId,
        });
        expect(paymentMethod?.id).toBe(victimPaymentMethodId);
    });

    it('removeShippingMethodsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeShippingMethodsFromChannel } = await adminClient.query(
            removeShippingMethodsFromChannelDocument,
            {
                input: { channelId: attackerChannelId, shippingMethodIds: [victimShippingMethodId] },
            },
        );
        expect(removeShippingMethodsFromChannel).toEqual([]);

        // ShippingMethod has no `channels` field in the Admin API, so read it back by id in the
        // victim Channel instead.
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        const { shippingMethod } = await adminClient.query(getShippingMethodByIdDocument, {
            id: victimShippingMethodId,
        });
        expect(shippingMethod?.id).toBe(victimShippingMethodId);
    });

    it('removeStockLocationsFromChannel is a no-op for an entity not visible in the active Channel', async () => {
        await loginAsAttacker();

        const { removeStockLocationsFromChannel } = await adminClient.query(
            testRemoveStockLocationsFromChannelDocument,
            {
                input: { channelId: attackerChannelId, stockLocationIds: [victimStockLocationId] },
            },
        );
        expect(removeStockLocationsFromChannel).toEqual([]);

        // StockLocation has no `channels` field in the Admin API, so read it back by id in the
        // victim Channel instead.
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        const { stockLocation } = await adminClient.query(getStockLocationByIdDocument, {
            id: victimStockLocationId,
        });
        expect(stockLocation?.id).toBe(victimStockLocationId);
    });

    it('SuperAdmin in the default Channel can still assign entities to another Channel', async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: attackerChannelId, productIds: [victimProduct.id] },
        });
        expect(assignProductsToChannel.map(p => p.id)).toEqual([victimProduct.id]);

        const { assignProductVariantsToChannel } = await adminClient.query(
            assignProductVariantToChannelDocument,
            {
                input: {
                    channelId: attackerChannelId,
                    productVariantIds: [victimProduct.variants[0].id],
                },
            },
        );
        expect(assignProductVariantsToChannel.map(v => v.id)).toEqual([victimProduct.variants[0].id]);

        const { assignCollectionsToChannel } = await adminClient.query(assignCollectionsToChannelDocument, {
            input: { channelId: attackerChannelId, collectionIds: [victimCollectionId] },
        });
        expect(assignCollectionsToChannel.map(c => c.id)).toEqual([victimCollectionId]);

        const { assignFacetsToChannel } = await adminClient.query(assignFacetsToChannelDocument, {
            input: { channelId: attackerChannelId, facetIds: [victimFacetId] },
        });
        expect(assignFacetsToChannel.map(f => f.id)).toEqual([victimFacetId]);

        const { assignProductOptionGroupsToChannel } = await adminClient.query(
            assignProductOptionGroupsToChannelDocument,
            {
                input: {
                    channelId: attackerChannelId,
                    productOptionGroupIds: [victimOptionGroupId],
                },
            },
        );
        expect(assignProductOptionGroupsToChannel.map(g => g.id)).toEqual([victimOptionGroupId]);

        const { assignPaymentMethodsToChannel } = await adminClient.query(
            assignPaymentMethodsToChannelDocument,
            {
                input: { channelId: attackerChannelId, paymentMethodIds: [victimPaymentMethodId] },
            },
        );
        expect(assignPaymentMethodsToChannel.map(m => m.id)).toEqual([victimPaymentMethodId]);

        const { assignShippingMethodsToChannel } = await adminClient.query(
            assignShippingMethodsToChannelDocument,
            {
                input: { channelId: attackerChannelId, shippingMethodIds: [victimShippingMethodId] },
            },
        );
        expect(assignShippingMethodsToChannel.map(m => m.id)).toEqual([victimShippingMethodId]);

        const { assignStockLocationsToChannel } = await adminClient.query(
            testAssignStockLocationToChannelDocument,
            {
                input: { channelId: attackerChannelId, stockLocationIds: [victimStockLocationId] },
            },
        );
        expect(assignStockLocationsToChannel.map(l => l.id)).toEqual([victimStockLocationId]);

        adminClient.setChannelToken(ATTACKER_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: victimProduct.id,
        });
        expect(product?.id).toBe(victimProduct.id);
        const { paymentMethod } = await adminClient.query(getPaymentMethodByIdDocument, {
            id: victimPaymentMethodId,
        });
        expect(paymentMethod?.id).toBe(victimPaymentMethodId);
    });

    it('removeProductsFromChannel removes a variant which is no longer in the active Channel', async () => {
        // The Product and its variants are in the victim Channel and the partner Channel. One variant
        // is then removed from the victim Channel, so an Administrator working there cannot see it.
        // Removing the Product from the partner Channel must still take that variant with it, otherwise
        // the variant is left in the partner Channel with no Product.
        await asSuperAdminIn(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: partnerChannelId, productIds: [victimProduct.id], priceFactor: 1 },
        });

        const strayVariantId = victimProduct.variants[1].id;
        await asSuperAdminIn(VICTIM_CHANNEL_TOKEN);
        await adminClient.query(removeProductVariantFromChannelDocument, {
            input: { channelId: victimChannelId, productVariantIds: [strayVariantId] },
        });

        const { removeProductsFromChannel } = await adminClient.query(removeProductFromChannelDocument, {
            input: { channelId: partnerChannelId, productIds: [victimProduct.id] },
        });
        expect(removeProductsFromChannel.map(p => p.id)).toEqual([victimProduct.id]);

        await asSuperAdminIn(E2E_DEFAULT_CHANNEL_TOKEN);
        const { productVariant } = await adminClient.query(getProductVariantChannelsDocument, {
            id: strayVariantId,
        });
        expect(productVariant?.channels.map(c => c.id)).not.toContain(partnerChannelId);
    });
});
