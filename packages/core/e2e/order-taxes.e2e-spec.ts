/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { summate } from '@vendure/common/lib/shared-utils';
import {
    Channel,
    Injector,
    Order,
    RequestContext,
    TaxZoneStrategy,
    TransactionalConnection,
    Zone,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    getProductsWithVariantPricesDocument,
    updateChannelDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderWithPriceDataDocument,
    setBillingAddressDocument,
    setShippingAddressDocument,
    testOrderFragment,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { sortById } from './utils/test-order-utils';

/**
 * Determines active tax zone based on:
 *
 * 1. billingAddress country, if set
 * 2. else shippingAddress country, is set
 * 3. else channel default tax zone.
 */
class TestTaxZoneStrategy implements TaxZoneStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector): void | Promise<void> {
        this.connection = injector.get(TransactionalConnection);
    }

    async determineTaxZone(
        ctx: RequestContext,
        zones: Zone[],
        channel: Channel,
        order?: Order,
    ): Promise<Zone> {
        if (!order?.billingAddress?.countryCode && !order?.shippingAddress?.countryCode) {
            return channel.defaultTaxZone;
        }

        const countryCode = order?.billingAddress?.countryCode || order?.shippingAddress?.countryCode;
        const zoneForCountryCode = await this.getZoneForCountryCode(ctx, countryCode);
        return zoneForCountryCode ?? channel.defaultTaxZone;
    }

    private getZoneForCountryCode(ctx: RequestContext, countryCode?: string): Promise<Zone | null> {
        return this.connection
            .getRepository(ctx, Zone)
            .createQueryBuilder('zone')
            .leftJoin('zone.members', 'country')
            .where('country.code = :countryCode', {
                countryCode,
            })
            .getOne();
    }
}

export const getTaxRateListDocument = graphql(`
    query GetTaxRateList($options: TaxRateListOptions) {
        taxRates(options: $options) {
            items {
                id
                name
                enabled
                value
                category {
                    id
                    name
                }
                zone {
                    id
                    name
                }
            }
            totalItems
        }
    }
`);

describe('Order taxes', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        taxOptions: {
            taxZoneStrategy: new TestTaxZoneStrategy(),
        },
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
    });

    type OrderSuccessResult = FragmentOf<typeof updatedOrderFragment> | FragmentOf<typeof testOrderFragment>;
    const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(
        input => !!input.lines,
    );

    type ActiveOrderWithPriceData = NonNullable<
        ResultOf<typeof getActiveOrderWithPriceDataDocument>['activeOrder']
    >;
    const activeOrderGuard: ErrorResultGuard<ActiveOrderWithPriceData> = createErrorResultGuard(
        input => !!input.taxSummary,
    );

    type TaxRateList = ResultOf<typeof getTaxRateListDocument>['taxRates'];
    const taxRatesGuard: ErrorResultGuard<TaxRateList> = createErrorResultGuard<TaxRateList>(
        input => !!input.items,
    );

    let products: ResultOf<typeof getProductsWithVariantPricesDocument>['products']['items'];

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-order-taxes.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(getProductsWithVariantPricesDocument);
        products = result.products.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('Channel.pricesIncludeTax = false', () => {
        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    pricesIncludeTax: false,
                },
            });
            await shopClient.asAnonymousUser();
        });

        it('prices are correct', async () => {
            const variant = products.sort(sortById)[0].variants.sort(sortById)[0];
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variant.id,
                quantity: 2,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            expect(activeOrder?.totalWithTax).toBe(240);
            expect(activeOrder?.total).toBe(200);
            expect(activeOrder?.lines[0].taxRate).toBe(20);
            expect(activeOrder?.lines[0].linePrice).toBe(200);
            expect(activeOrder?.lines[0].lineTax).toBe(40);
            expect(activeOrder?.lines[0].linePriceWithTax).toBe(240);
            expect(activeOrder?.lines[0].unitPrice).toBe(100);
            expect(activeOrder?.lines[0].unitPriceWithTax).toBe(120);
            expect(activeOrder?.lines[0].taxLines).toEqual([
                {
                    description: 'Standard Tax Europe',
                    taxRate: 20,
                },
            ]);
        });
    });

    describe('Channel.pricesIncludeTax = true', () => {
        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    pricesIncludeTax: true,
                },
            });
            await shopClient.asAnonymousUser();
        });

        it('prices are correct', async () => {
            const variant = products[0].variants[0];
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variant.id,
                quantity: 2,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            expect(activeOrder?.totalWithTax).toBe(200);
            expect(activeOrder?.total).toBe(167);
            expect(activeOrder?.lines[0].taxRate).toBe(20);
            expect(activeOrder?.lines[0].linePrice).toBe(167);
            expect(activeOrder?.lines[0].lineTax).toBe(33);
            expect(activeOrder?.lines[0].linePriceWithTax).toBe(200);
            expect(activeOrder?.lines[0].unitPrice).toBe(83);
            expect(activeOrder?.lines[0].unitPriceWithTax).toBe(100);
            expect(activeOrder?.lines[0].taxLines).toEqual([
                {
                    description: 'Standard Tax Europe',
                    taxRate: 20,
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/1216
        it('re-calculates OrderLine prices when shippingAddress causes activeTaxZone change', async () => {
            const { taxRates } = await adminClient.query(getTaxRateListDocument);
            taxRatesGuard.assertSuccess(taxRates);
            // Set the TaxRates to Asia to 0%

            const taxRatesAsia = taxRates.items.filter(tr => tr.name.includes('Asia'));
            for (const taxRate of taxRatesAsia) {
                await adminClient.query(updateTaxRateDocument, {
                    input: {
                        id: taxRate.id,
                        value: 0,
                    },
                });
            }

            await shopClient.query(setShippingAddressDocument, {
                input: {
                    countryCode: 'CN',
                    streetLine1: '123 Lugu St',
                    city: 'Beijing',
                    province: 'Beijing',
                    postalCode: '12340',
                },
            });

            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            expect(activeOrder?.totalWithTax).toBe(166);
            expect(activeOrder?.total).toBe(166);
            expect(activeOrder?.lines[0].taxRate).toBe(0);
            expect(activeOrder?.lines[0].linePrice).toBe(166);
            expect(activeOrder?.lines[0].lineTax).toBe(0);
            expect(activeOrder?.lines[0].linePriceWithTax).toBe(166);
            expect(activeOrder?.lines[0].unitPrice).toBe(83);
            expect(activeOrder?.lines[0].unitPriceWithTax).toBe(83);
            expect(activeOrder?.lines[0].taxLines).toEqual([
                {
                    description: 'Standard Tax Asia',
                    taxRate: 0,
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/1216
        it('re-calculates OrderLine prices when billingAddress causes activeTaxZone change', async () => {
            await shopClient.query(setBillingAddressDocument, {
                input: {
                    countryCode: 'US',
                    streetLine1: '123 Chad Street',
                    city: 'Houston',
                    province: 'Texas',
                    postalCode: '12345',
                },
            });

            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            expect(activeOrder?.totalWithTax).toBe(199);
            expect(activeOrder?.total).toBe(166);
            expect(activeOrder?.lines[0].taxRate).toBe(20);
            expect(activeOrder?.lines[0].linePrice).toBe(166);
            expect(activeOrder?.lines[0].lineTax).toBe(33);
            expect(activeOrder?.lines[0].linePriceWithTax).toBe(199);
            expect(activeOrder?.lines[0].unitPrice).toBe(83);
            expect(activeOrder?.lines[0].unitPriceWithTax).toBe(100);
            expect(activeOrder?.lines[0].taxLines).toEqual([
                {
                    description: 'Standard Tax Americas',
                    taxRate: 20,
                },
            ]);
        });
    });

    it('taxSummary works', async () => {
        await adminClient.query(updateChannelDocument, {
            input: {
                id: 'T_1',
                pricesIncludeTax: false,
            },
        });
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: products[0].variants[0].id,
            quantity: 2,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: products[1].variants[0].id,
            quantity: 2,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: products[2].variants[0].id,
            quantity: 2,
        });

        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);

        expect(activeOrder?.taxSummary).toEqual([
            {
                description: 'Standard Tax Europe',
                taxRate: 20,
                taxBase: 200,
                taxTotal: 40,
            },
            {
                description: 'Reduced Tax Europe',
                taxRate: 10,
                taxBase: 200,
                taxTotal: 20,
            },
            {
                description: 'Zero Tax Europe',
                taxRate: 0,
                taxBase: 200,
                taxTotal: 0,
            },
        ]);

        // ensure that the summary total add up to the overall totals

        activeOrderGuard.assertSuccess(activeOrder);

        const taxSummaryBaseTotal = summate(activeOrder.taxSummary, 'taxBase');
        const taxSummaryTaxTotal = summate(activeOrder.taxSummary, 'taxTotal');

        expect(taxSummaryBaseTotal).toBe(activeOrder.total);
        expect(taxSummaryBaseTotal + taxSummaryTaxTotal).toBe(activeOrder.totalWithTax);
    });
});
