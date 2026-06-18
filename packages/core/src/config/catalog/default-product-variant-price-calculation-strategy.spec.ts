import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { roundMoney } from '../../common/round-money';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import {
    createRequestContext,
    MockTaxRateService,
    taxCategoryReduced,
    taxCategoryStandard,
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
        const { DefaultProductVariantPriceCalculationStrategy } = await import(
            './default-product-variant-price-calculation-strategy.js'
        );
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
});
