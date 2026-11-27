import { INestApplicationContext } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import {
    Channel,
    Country,
    PaymentMethod,
    Product,
    ShippingMethod,
    TaxCategory,
    TaxRate,
    Zone,
} from '../../entity';
import { SeedSentinelService } from '../../service/helpers/seed-sentinel/seed-sentinel.service';
import { ChannelService } from '../../service/services/channel.service';
import { CountryService } from '../../service/services/country.service';
import { PaymentMethodService } from '../../service/services/payment-method.service';
import { ShippingMethodService } from '../../service/services/shipping-method.service';
import { StockLocationService } from '../../service/services/stock-location.service';
import { TaxCategoryService } from '../../service/services/tax-category.service';
import { TaxRateService } from '../../service/services/tax-rate.service';
import { ZoneService } from '../../service/services/zone.service';

import { createSuperAdminContext } from './preset-context';
import { validatePresetOptions } from './preset-registry';
import { PresetResult, PresetServices } from './preset-types';
import { presetDatabaseNotEmptyError } from './seed-errors';

/**
 * @description
 * Applies a base-data preset to the default Channel, in one transaction. The preset's data and the
 * `vendure.seed.preset` sentinel commit together, or nothing is written.
 *
 * It refuses with a {@link SeedError}:
 *
 * - `core.preset-unknown` or `core.preset-invalid-option` when the name or the options are wrong;
 * - `core.preset-database-not-empty` when the database is not empty: it has countries, zones,
 *   tax categories or rates, shipping or payment methods, products, more than one Channel, or a
 *   preset sentinel.
 *
 * Errors are never swallowed: any failure rolls the transaction back and is thrown.
 *
 * @example
 * ```ts
 * import { applyPreset, bootstrapWorker } from '\@vendure/core';
 *
 * const { app } = await bootstrapWorker(config);
 * const result = await applyPreset(app, 'single-country', { country: 'NZ', currency: 'NZD' });
 * await app.close();
 * ```
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export async function applyPreset(
    app: INestApplicationContext,
    presetName: string,
    options: Record<string, string> = {},
): Promise<PresetResult> {
    const preset = validatePresetOptions(presetName, options);
    const connection = app.get(TransactionalConnection);
    const sentinels = app.get(SeedSentinelService);
    const services: PresetServices = {
        configService: app.get(ConfigService),
        channelService: app.get(ChannelService),
        zoneService: app.get(ZoneService),
        countryService: app.get(CountryService),
        taxCategoryService: app.get(TaxCategoryService),
        taxRateService: app.get(TaxRateService),
        shippingMethodService: app.get(ShippingMethodService),
        paymentMethodService: app.get(PaymentMethodService),
        stockLocationService: app.get(StockLocationService),
    };
    const ctx = await createSuperAdminContext(app);

    return connection.withTransaction(ctx, async txCtx => {
        const appliedPreset = await sentinels.getPresetSentinel(txCtx);
        // Sequential, not Promise.all: the queries share the transaction's query runner.
        const countries = await connection.getRepository(txCtx, Country).count();
        const zones = await connection.getRepository(txCtx, Zone).count();
        const taxRates = await connection.getRepository(txCtx, TaxRate).count();
        const channels = await connection.getRepository(txCtx, Channel).count();
        const taxCategories = await connection.getRepository(txCtx, TaxCategory).count();
        const shippingMethods = await connection.getRepository(txCtx, ShippingMethod).count();
        const paymentMethods = await connection.getRepository(txCtx, PaymentMethod).count();
        // Deleted products count too: changing the channel currency rewrites their prices.
        const products = await connection.getRepository(txCtx, Product).count();
        const existing = {
            countries,
            zones,
            taxRates,
            taxCategories,
            shippingMethods,
            paymentMethods,
            products,
        };
        if (appliedPreset || channels > 1 || Object.values(existing).some(count => count > 0)) {
            throw presetDatabaseNotEmptyError({
                ...existing,
                channels,
                appliedPreset: appliedPreset?.name,
            });
        }
        const result = await preset.apply(txCtx, services, options);
        await sentinels.setPresetSentinel(txCtx, {
            name: preset.name,
            options,
            appliedAt: new Date().toISOString(),
        });
        return result;
    });
}
