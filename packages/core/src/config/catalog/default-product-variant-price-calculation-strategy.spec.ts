import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { roundMoney } from '../../common/round-money';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import {
    createRequestContext,
    MockTaxRateService,
    taxCategoryReduced,
    taxCategoryStandard,
    taxRateCountryStandard,
    taxRateDefaultReduced,
    taxRateDefaultStandard,
    zoneDefault,
    zoneOther,
    zoneWithNoTaxRate,
} from '../../testing/order-test-utils';
import { ensureConfigLoaded } from '../config-helpers';

describe('DefaultProductVariantPriceCalculationStrategy', () => {
    let strategy: import('./default-product-variant-price-calculation-strategy').DefaultProductVariantPriceCalculationStrategy;
    const inputPrice = 6543;
    const productVariant = new ProductVariant({});

    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    beforeEach(async () => {
        // Dynamic import to avoid vitest circular dependency issue
        const { DefaultProductVariantPriceCalculationStrategy } =
            await import('./default-product-variant-price-calculation-strategy.js');
        strategy = new DefaultProductVariantPriceCalculationStrategy();
        const mockInjector = {
            get: () => {
                return new MockTaxRateService();
            },
        } as any;
        strategy.init(mockInjector);
    });

    describe('with prices which do not include tax', () => {
        it('standard tax, default zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: false,
            });
        });

        it('reduced tax, default zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryReduced,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: false,
            });
        });

        it('standard tax, other zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneOther,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: false,
            });
        });

        it('reduced tax, other zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryReduced,
                activeTaxZone: zoneOther,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: false,
            });
        });

        it('standard tax, unconfigured zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryReduced,
                activeTaxZone: zoneWithNoTaxRate,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: false,
            });
        });
    });

    describe('with prices which include tax', () => {
        it('standard tax, default zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: true,
            });
        });

        it('reduced tax, default zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryReduced,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: inputPrice,
                priceIncludesTax: true,
            });
        });

        it('standard tax, other zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneOther,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: roundMoney(taxRateDefaultStandard.netPriceOf(inputPrice)),
                priceIncludesTax: false,
            });
        });

        it('reduced tax, other zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryReduced,
                activeTaxZone: zoneOther,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: roundMoney(taxRateDefaultReduced.netPriceOf(inputPrice)),
                priceIncludesTax: false,
            });
        });

        it('standard tax, unconfigured zone', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneWithNoTaxRate,
                ctx,
                productVariant,
            });

            expect(result).toEqual({
                price: roundMoney(taxRateDefaultStandard.netPriceOf(inputPrice)),
                priceIncludesTax: false,
            });
        });
    });

    describe('with prices which include tax, given the applied taxRate', () => {
        // What TaxRateService returns when no rate matches.
        const noConfiguredTaxRate = new TaxRate({
            id: '0',
            name: 'No configured tax rate',
            value: 0,
            enabled: true,
        });
        const zoneOnlyCases = [
            { name: 'standard tax, default zone', taxCategory: taxCategoryStandard, zone: zoneDefault },
            { name: 'reduced tax, default zone', taxCategory: taxCategoryReduced, zone: zoneDefault },
            { name: 'standard tax, other zone', taxCategory: taxCategoryStandard, zone: zoneOther },
            { name: 'reduced tax, other zone', taxCategory: taxCategoryReduced, zone: zoneOther },
            {
                name: 'standard tax, unconfigured zone',
                taxCategory: taxCategoryStandard,
                zone: zoneWithNoTaxRate,
            },
        ];

        for (const { name, taxCategory, zone } of zoneOnlyCases) {
            it(`a zone-only setup gives the same price as without taxRate: ${name}`, async () => {
                const ctx = createRequestContext({ pricesIncludeTax: true });
                const taxRate =
                    zone === zoneWithNoTaxRate
                        ? noConfiguredTaxRate
                        : await new MockTaxRateService().getApplicableTaxRate(ctx, zone, taxCategory);
                const args = { inputPrice, taxCategory, activeTaxZone: zone, ctx, productVariant };
                expect(await strategy.calculate({ ...args, taxRate })).toEqual(
                    await strategy.calculate(args),
                );
            });
        }

        it('a country rate with the default zone rate value keeps the price as gross', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const sameValue = new TaxRate({ ...taxRateCountryStandard, id: 'sameValue', value: 20 });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
                taxRate: sameValue,
            });

            expect(result).toEqual({ price: inputPrice, priceIncludesTax: true });
        });

        it('a country rate in the default zone takes the net price out at the default zone rate', async () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = await strategy.calculate({
                inputPrice,
                taxCategory: taxCategoryStandard,
                activeTaxZone: zoneDefault,
                ctx,
                productVariant,
                taxRate: taxRateCountryStandard,
            });

            expect(result).toEqual({
                price: roundMoney(taxRateDefaultStandard.netPriceOf(inputPrice)),
                priceIncludesTax: false,
            });
        });
    });
});
