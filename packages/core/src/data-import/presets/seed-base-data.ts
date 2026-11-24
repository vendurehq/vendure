import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { isGraphQlErrorResult } from '../../common/error/error-result';
import { manualFulfillmentHandler } from '../../config/fulfillment/manual-fulfillment-handler';
import { dummyPaymentHandler } from '../../config/payment/dummy-payment-method-handler';
import { defaultShippingCalculator } from '../../config/shipping-method/default-shipping-calculator';
import { defaultShippingEligibilityChecker } from '../../config/shipping-method/default-shipping-eligibility-checker';

import { ISO_COUNTRIES } from './iso-countries';
import { PresetResult, PresetServices } from './preset-types';

/**
 * @description
 * A tax category of a {@link BaseDataPlan}, with its rates.
 */
export interface BaseDataTaxCategory {
    name: string;
    isDefault?: boolean;
    /**
     * The rate on the preset's zone, in percent. In a tax-inclusive channel it is the rate the
     * entered prices include, so the default tax zone always has one.
     */
    zoneRate: number;
    /** The name of the zone rate. Defaults to the category name followed by the zone name. */
    zoneRateName?: string;
    /** Rates for single countries in the zone, keyed by country code, in percent. */
    countryRates?: Record<string, number>;
}

/**
 * @description
 * The data a preset creates, in declarative form. {@link seedBaseData} turns it into entities.
 */
export interface BaseDataPlan {
    preset: string;
    options: Record<string, string>;
    currencyCode: CurrencyCode;
    pricesIncludeTax: boolean;
    zone: { name: string; countryCodes: string[] };
    taxCategories: BaseDataTaxCategory[];
    /** The price of the flat-rate shipping method, in minor units. */
    shippingRate: number;
}

/**
 * @description
 * Creates the data of a {@link BaseDataPlan} through the services, in the transaction of `ctx`. It
 * never catches an error, so any failure rolls the whole preset back.
 */
export async function seedBaseData(
    ctx: RequestContext,
    services: PresetServices,
    plan: BaseDataPlan,
): Promise<PresetResult> {
    const countryIds = new Map<string, ID>();
    for (const { code, name } of ISO_COUNTRIES) {
        const country = await services.countryService.create(ctx, {
            code,
            enabled: true,
            translations: [{ languageCode: ctx.languageCode, name }],
        });
        countryIds.set(code, country.id);
    }
    const idOf = (code: string): ID => {
        const id = countryIds.get(code);
        if (id === undefined) {
            throw new Error(`The ${plan.preset} preset names an unknown country code: ${code}`);
        }
        return id;
    };

    const zone = await services.zoneService.create(ctx, {
        name: plan.zone.name,
        memberIds: plan.zone.countryCodes.map(idOf),
    });

    let taxRates = 0;
    for (const category of plan.taxCategories) {
        const taxCategory = await services.taxCategoryService.create(ctx, {
            name: category.name,
            isDefault: category.isDefault ?? false,
        });
        await services.taxRateService.create(ctx, {
            name: category.zoneRateName ?? `${category.name} ${plan.zone.name}`,
            enabled: true,
            value: category.zoneRate,
            categoryId: taxCategory.id,
            zoneId: zone.id,
        });
        taxRates++;
        for (const [countryCode, value] of Object.entries(category.countryRates ?? {})) {
            await services.taxRateService.create(ctx, {
                name: `${category.name} ${countryCode}`,
                enabled: true,
                value,
                categoryId: taxCategory.id,
                regionId: idOf(countryCode),
            });
            taxRates++;
        }
    }

    const standardRate = plan.taxCategories.find(c => c.isDefault)?.zoneRate ?? 0;
    await services.shippingMethodService.create(ctx, {
        code: 'flat-rate',
        fulfillmentHandler: manualFulfillmentHandler.code,
        checker: {
            code: defaultShippingEligibilityChecker.code,
            arguments: [{ name: 'orderMinimum', value: '0' }],
        },
        calculator: {
            code: defaultShippingCalculator.code,
            arguments: [
                { name: 'rate', value: String(plan.shippingRate) },
                { name: 'includesTax', value: 'auto' },
                { name: 'taxRate', value: String(standardRate) },
            ],
        },
        translations: [{ languageCode: ctx.languageCode, name: 'Flat rate', description: '' }],
    });

    let paymentMethods = 0;
    const notices: string[] = [];
    const dummyHandlerConfigured = services.configService.paymentOptions.paymentMethodHandlers.some(
        h => h.code === dummyPaymentHandler.code,
    );
    if (process.env.NODE_ENV !== 'production' && !dummyHandlerConfigured) {
        notices.push(
            'No test payment method was created, because dummyPaymentHandler is not in paymentOptions.paymentMethodHandlers.',
        );
    }
    if (process.env.NODE_ENV !== 'production' && dummyHandlerConfigured) {
        await services.paymentMethodService.create(ctx, {
            code: 'test-payment',
            enabled: true,
            handler: {
                code: dummyPaymentHandler.code,
                arguments: [{ name: 'automaticSettle', value: 'false' }],
            },
            translations: [
                {
                    languageCode: ctx.languageCode,
                    name: 'Test payment',
                    description: 'Takes no real payment. Created only outside production.',
                },
            ],
        });
        paymentMethods++;
    }

    // The core bootstrap creates a default stock location when there is none, so it normally
    // exists already. It is reused rather than duplicated.
    let stockLocations = 0;
    const existingStockLocation = await services.stockLocationService.defaultStockLocation(ctx);
    if (!existingStockLocation) {
        await services.stockLocationService.create(ctx, {
            name: 'Default Stock Location',
            description: 'The default stock location',
        });
        stockLocations++;
    }

    const channel = await services.channelService.getDefaultChannel(ctx);
    const updated = await services.channelService.update(ctx, {
        id: channel.id,
        defaultCurrencyCode: plan.currencyCode,
        availableCurrencyCodes: [plan.currencyCode],
        availableLanguageCodes: [channel.defaultLanguageCode],
        pricesIncludeTax: plan.pricesIncludeTax,
        defaultTaxZoneId: zone.id,
        defaultShippingZoneId: zone.id,
    });
    if (isGraphQlErrorResult(updated)) {
        throw new Error(`Could not update the default channel: ${updated.message}`);
    }

    return {
        preset: plan.preset,
        options: plan.options,
        created: {
            countries: countryIds.size,
            zones: 1,
            taxCategories: plan.taxCategories.length,
            taxRates,
            shippingMethods: 1,
            paymentMethods,
            stockLocations,
        },
        notices,
        channel: {
            defaultCurrencyCode: plan.currencyCode,
            pricesIncludeTax: plan.pricesIncludeTax,
            defaultTaxZone: plan.zone.name,
            defaultShippingZone: plan.zone.name,
        },
    };
}
