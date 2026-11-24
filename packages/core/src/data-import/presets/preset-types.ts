import { CurrencyCode } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService } from '../../config/config.service';
import { ChannelService } from '../../service/services/channel.service';
import { CountryService } from '../../service/services/country.service';
import { PaymentMethodService } from '../../service/services/payment-method.service';
import { ShippingMethodService } from '../../service/services/shipping-method.service';
import { StockLocationService } from '../../service/services/stock-location.service';
import { TaxCategoryService } from '../../service/services/tax-category.service';
import { TaxRateService } from '../../service/services/tax-rate.service';
import { ZoneService } from '../../service/services/zone.service';

/**
 * @description
 * An option that a {@link Preset} accepts, such as `country`.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface PresetOptionDefinition {
    description: string;
    required?: boolean;
}

/**
 * @description
 * The services a {@link Preset} creates its data with.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface PresetServices {
    configService: ConfigService;
    channelService: ChannelService;
    zoneService: ZoneService;
    countryService: CountryService;
    taxCategoryService: TaxCategoryService;
    taxRateService: TaxRateService;
    shippingMethodService: ShippingMethodService;
    paymentMethodService: PaymentMethodService;
    stockLocationService: StockLocationService;
}

/**
 * @description
 * What a {@link Preset} created, with a count per entity.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface PresetResult {
    preset: string;
    options: Record<string, string>;
    created: {
        countries: number;
        zones: number;
        taxCategories: number;
        taxRates: number;
        shippingMethods: number;
        paymentMethods: number;
        stockLocations: number;
    };
    /** Things the preset left out, and why, for example the test payment method. */
    notices: string[];
    channel: {
        defaultCurrencyCode: CurrencyCode;
        pricesIncludeTax: boolean;
        defaultTaxZone: string;
        defaultShippingZone: string;
    };
}

/**
 * @description
 * A base-data preset: a typical starting point for a new store. It sets the default Channel's
 * currencies, languages and `pricesIncludeTax`, and creates countries, zones, tax categories and
 * rates, a shipping method, a test payment method outside production, and a stock location.
 *
 * A preset runs once, on an empty database, through {@link applyPreset}.
 *
 * @docsCategory import-export
 * @docsPage Presets
 * @since 4.0.0
 */
export interface Preset {
    name: string;
    description: string;
    options?: Record<string, PresetOptionDefinition>;
    /**
     * Whether the preset is released. An unreleased preset is left out of `listPresets()` and
     * treated as unknown. Defaults to released.
     */
    released?: () => boolean;
    /**
     * Checks the values of the options, after the required options have been checked. Returns the
     * first problem, or `undefined`. It must not touch the database, so a caller such as
     * `@vendure/create` can validate options before any database exists.
     */
    validate?(options: Record<string, string>): { option: string; reason: string } | undefined;
    /**
     * Creates the data. Options have been checked against `options` before this is called.
     */
    apply(
        ctx: RequestContext,
        services: PresetServices,
        options: Record<string, string>,
    ): Promise<PresetResult>;
}
