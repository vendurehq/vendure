/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Channel,
    Customer,
    defaultTaxCountryCode,
    Injector,
    mergeConfig,
    Order,
    RequestContext,
    TaxZoneStrategy,
    TransactionalConnection,
    Zone,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createCountryDocument } from './graphql/admin-definitions';
import {
    addCustomersToGroupDocument,
    createCustomerGroupDocument,
    createTaxRateDocument,
    createZoneDocument,
    getCustomerListDocument,
    getProductsWithVariantPricesDocument,
    removeCustomersFromGroupDocument,
    updateChannelDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    adjustItemQuantityDocument,
    getActiveOrderWithPriceDataDocument,
    setBillingAddressDocument,
    setShippingAddressDocument,
} from './graphql/shop-definitions';

const B2B_GROUP = 'B2B';
const B2B_ZONE = 'b2b';

/**
 * Taxes by the billing country, and applies the B2B reverse charge to customers in the 'B2B'
 * customer group: the 0% rate of the 'b2b' Zone, and no country rate.
 */
class TestTaxZoneStrategy implements TaxZoneStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async determineTaxZone(ctx: RequestContext, zones: Zone[], channel: Channel, order?: Order) {
        if (await this.isBusinessCustomer(ctx, order)) {
            return zones.find(zone => zone.name === B2B_ZONE)!;
        }
        return channel.defaultTaxZone;
    }

    async determineTaxCountryCode(ctx: RequestContext, channel: Channel, activeTaxZone: Zone, order?: Order) {
        if (await this.isBusinessCustomer(ctx, order)) {
            return undefined;
        }
        return order?.billingAddress?.countryCode || defaultTaxCountryCode(channel, activeTaxZone, order);
    }

    private async isBusinessCustomer(ctx: RequestContext, order?: Order): Promise<boolean> {
        if (!order?.customerId) {
            return false;
        }
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { id: order.customerId },
            relations: { groups: true },
        });
        return !!customer?.groups.some(group => group.name === B2B_GROUP);
    }
}

// The eu Zone holds DE and FR, with country rates DE 19% and FR 20%, and a 19% zone rate. The
// b2b Zone has a 0% zone rate.
describe('TaxZoneStrategy.determineTaxCountryCode()', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { taxOptions: { taxZoneStrategy: new TestTaxZoneStrategy() } }),
    );
    const standardTaxCategoryId = 'T_1';
    const countryIds: Record<string, string> = {};
    let variantIds: string[];
    let customerId: string;
    let customerEmail: string;
    let b2bGroupId: string;

    const address = (countryCode: string) => ({
        countryCode,
        streetLine1: '1 Main St',
        city: 'City',
        postalCode: '12345',
    });

    async function activeOrderLines() {
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        return activeOrder!.lines.map(({ unitPrice, unitPriceWithTax, taxRate }) => ({
            unitPrice,
            unitPriceWithTax,
            taxRate,
        }));
    }

    async function startOrder(asCustomer: boolean, lineCount = 1) {
        if (asCustomer) {
            await shopClient.asUserWithCredentials(customerEmail, 'test');
        } else {
            await shopClient.asAnonymousUser();
        }
        for (const productVariantId of variantIds.slice(0, lineCount)) {
            await shopClient.query(addItemToOrderDocument, { productVariantId, quantity: 1 });
        }
        await shopClient.query(setShippingAddressDocument, { input: address('DE') });
    }

    let inB2BGroup = false;
    async function setB2B(isBusiness: boolean) {
        if (isBusiness === inB2BGroup) {
            return;
        }
        inB2BGroup = isBusiness;
        await adminClient.query(isBusiness ? addCustomersToGroupDocument : removeCustomersFromGroupDocument, {
            groupId: b2bGroupId,
            customerIds: [customerId],
        });
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        for (const [code, name] of [
            ['DE', 'Germany'],
            ['FR', 'France'],
        ]) {
            const { createCountry } = await adminClient.query(createCountryDocument, {
                input: { code, enabled: true, translations: [{ languageCode: LanguageCode.en, name }] },
            });
            countryIds[code] = createCountry.id;
        }
        const { createZone: euZone } = await adminClient.query(createZoneDocument, {
            input: { name: 'eu', memberIds: [countryIds.DE, countryIds.FR] },
        });
        const { createZone: b2bZone } = await adminClient.query(createZoneDocument, {
            input: { name: B2B_ZONE, memberIds: [] },
        });
        await adminClient.query(updateChannelDocument, {
            input: { id: 'T_1', defaultTaxZoneId: euZone.id },
        });
        for (const input of [
            { name: 'eu', zoneId: euZone.id, value: 19 },
            { name: 'b2b', zoneId: b2bZone.id, value: 0 },
            { name: 'DE', regionId: countryIds.DE, value: 19 },
            { name: 'FR', regionId: countryIds.FR, value: 20 },
        ]) {
            await adminClient.query(createTaxRateDocument, {
                input: { ...input, categoryId: standardTaxCategoryId, enabled: true },
            });
        }

        const { products } = await adminClient.query(getProductsWithVariantPricesDocument);
        variantIds = products.items[0].variants.slice(0, 2).map(v => v.id);
        const { customers } = await adminClient.query(getCustomerListDocument);
        customerId = customers.items[0].id;
        customerEmail = customers.items[0].emailAddress;
        const { createCustomerGroup } = await adminClient.query(createCustomerGroupDocument, {
            input: { name: B2B_GROUP },
        });
        b2bGroupId = createCustomerGroup.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('billing address', () => {
        it('an Order shipped to DE gets the DE rate', async () => {
            await startOrder(false);
            expect((await activeOrderLines())[0].taxRate).toBe(19);
        });

        it('billing to FR gets the FR rate', async () => {
            await shopClient.query(setBillingAddressDocument, { input: address('FR') });
            expect((await activeOrderLines())[0].taxRate).toBe(20);
        });

        it('changing the billing country taxes the Order again', async () => {
            await shopClient.query(setBillingAddressDocument, { input: address('DE') });
            expect((await activeOrderLines())[0].taxRate).toBe(19);
        });
    });

    describe('reverse charge, prices exclude tax', () => {
        beforeAll(async () => {
            await updateVariantPrices(10000);
        });

        it('a consumer pays the DE rate', async () => {
            await setB2B(false);
            await startOrder(true);
            expect(await activeOrderLines()).toEqual([
                { unitPrice: 10000, unitPriceWithTax: 11900, taxRate: 19 },
            ]);
        });

        it('the same customer in the B2B group pays 0%, not the DE country rate', async () => {
            await setB2B(true);
            await shopClient.query(setShippingAddressDocument, { input: address('DE') });
            expect(await activeOrderLines()).toEqual([
                { unitPrice: 10000, unitPriceWithTax: 10000, taxRate: 0 },
            ]);
        });
    });

    describe('reverse charge, prices include tax', () => {
        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, { input: { id: 'T_1', pricesIncludeTax: true } });
            await updateVariantPrices(11900);
        });

        afterAll(async () => {
            await adminClient.query(updateChannelDocument, { input: { id: 'T_1', pricesIncludeTax: false } });
        });

        it('a consumer keeps the entered gross price', async () => {
            await setB2B(false);
            await startOrder(true, 2);
            const consumerLine = { unitPrice: 10000, unitPriceWithTax: 11900, taxRate: 19 };
            expect(await activeOrderLines()).toEqual([consumerLine, consumerLine]);
        });

        it('moved into the B2B group, editing one line nets out every line', async () => {
            await setB2B(true);
            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: activeOrder!.lines[0].id,
                quantity: 2,
            });
            const businessLine = { unitPrice: 10000, unitPriceWithTax: 10000, taxRate: 0 };
            expect(await activeOrderLines()).toEqual([businessLine, businessLine]);
        });

        it('moved back out of the group, every line gets the gross price again', async () => {
            await setB2B(false);
            await shopClient.query(setShippingAddressDocument, { input: address('DE') });
            const consumerLine = { unitPrice: 10000, unitPriceWithTax: 11900, taxRate: 19 };
            expect(await activeOrderLines()).toEqual([consumerLine, consumerLine]);
        });
    });

    async function updateVariantPrices(price: number) {
        await adminClient.query(updateProductVariantsDocument, {
            input: variantIds.map(id => ({ id, price })),
        });
    }
});
