import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { defaultConfig } from '../../config/default-config';
import { getStrategyName } from '../helpers/strategy-name.helper';
import { TelemetryConfig } from '../telemetry.types';

/**
 * Single-strategy (non-array) VendureConfig fields whose live strategy class is
 * compared against `defaultConfig` to detect customization. Grouped by the
 * options key they live under. Array-valued strategy fields are intentionally
 * excluded — they are reported elsewhere.
 */
const SINGLE_STRATEGY_PATHS: Record<string, string[]> = {
    authOptions: [
        'sessionCacheStrategy',
        'passwordHashingStrategy',
        'passwordValidationStrategy',
        'verificationTokenStrategy',
        'adminApiKeyStrategy',
        'shopApiKeyStrategy',
        'customerChannelAssignmentStrategy',
    ],
    assetOptions: ['assetNamingStrategy', 'assetStorageStrategy', 'assetPreviewStrategy'],
    catalogOptions: [
        'productVariantPriceSelectionStrategy',
        'productVariantPriceCalculationStrategy',
        'productVariantPriceUpdateStrategy',
        'stockDisplayStrategy',
        'stockLocationStrategy',
    ],
    orderOptions: [
        'orderItemPriceCalculationStrategy',
        'stockAllocationStrategy',
        'mergeStrategy',
        'checkoutMergeStrategy',
        'orderCodeStrategy',
        'orderByCodeAccessStrategy',
        'changedPriceHandlingStrategy',
        'orderLineDiscountDistributionStrategy',
        'orderPlacedStrategy',
        'orderSellerStrategy',
        'guestCheckoutStrategy',
    ],
    taxOptions: ['taxZoneStrategy', 'taxLineCalculationStrategy', 'orderTaxCalculationStrategy'],
    entityOptions: ['entityIdStrategy', 'moneyStrategy', 'slugStrategy'],
    importExportOptions: ['assetImportStrategy'],
    jobQueueOptions: ['jobQueueStrategy', 'jobBufferStorageStrategy'],
    schedulerOptions: ['schedulerStrategy'],
    systemOptions: ['cacheStrategy', 'instrumentationStrategy'],
};

/**
 * Collects configuration information for telemetry.
 * Only collects strategy class names and non-sensitive configuration values.
 */
@Injectable()
export class ConfigCollector {
    constructor(private readonly configService: ConfigService) {}

    collect(): TelemetryConfig {
        const customFieldsPerEntity = this.getCustomFieldsPerEntity();
        const customFieldsCount = Object.values(customFieldsPerEntity).reduce((sum, c) => sum + c, 0);
        return {
            assetStorageType: this.getAssetStorageType(),
            jobQueueType: this.getJobQueueType(),
            entityIdStrategy: this.getEntityIdStrategy(),
            defaultLanguage: this.getDefaultLanguage(),
            customFieldsCount,
            authenticationMethods: this.getAuthenticationMethods(),
            moneyStrategy: this.getMoneyStrategy(),
            cacheStrategy: this.getCacheStrategy(),
            taxLineCalculationStrategy: this.getTaxLineCalculationStrategy(),
            orderSellerStrategy: this.getOrderSellerStrategy(),
            paymentHandlerCodes: this.getPaymentHandlerCodes(),
            shippingCalculatorCodes: this.getShippingCalculatorCodes(),
            fulfillmentHandlerCodes: this.getFulfillmentHandlerCodes(),
            promotionConditionCount: this.getPromotionConditionCount(),
            promotionActionCount: this.getPromotionActionCount(),
            scheduledTaskCount: this.getScheduledTaskCount(),
            customFieldsPerEntity,
            hasCustomOrderProcess: this.hasCustomOrderProcess(),
            hasCustomPaymentProcess: this.hasCustomPaymentProcess(),
            hasCustomFulfillmentProcess: this.hasCustomFulfillmentProcess(),
            apiIntrospectionEnabled: this.getApiIntrospectionEnabled(),
            apiPlaygroundEnabled: this.getApiPlaygroundEnabled(),
            apiDebugEnabled: this.getApiDebugEnabled(),
            trustProxyEnabled: this.getTrustProxyEnabled(),
            corsWildcardOrigin: this.getCorsWildcardOrigin(),
            tokenMethods: this.getTokenMethods(),
            requireVerification: this.getRequireVerification(),
            authDisabled: this.getAuthDisabled(),
            defaultSuperadminCredentials: this.getDefaultSuperadminCredentials(),
            cookieSecure: this.getCookieSecure(),
            cookieSameSite: this.getCookieSameSite(),
            settingsStoreFieldCount: this.getSettingsStoreFieldCount(),
            customizedStrategies: this.getCustomizedStrategies(),
        };
    }

    private getApiIntrospectionEnabled(): boolean | undefined {
        try {
            // introspection defaults to true when not explicitly disabled
            return this.configService.apiOptions.introspection !== false;
        } catch {
            return undefined;
        }
    }

    private getApiPlaygroundEnabled(): boolean | undefined {
        try {
            const api = this.configService.apiOptions;
            return !!(api.adminApiPlayground || api.shopApiPlayground);
        } catch {
            return undefined;
        }
    }

    private getApiDebugEnabled(): boolean | undefined {
        try {
            const api = this.configService.apiOptions;
            return !!(api.adminApiDebug || api.shopApiDebug);
        } catch {
            return undefined;
        }
    }

    private getTrustProxyEnabled(): boolean | undefined {
        try {
            return !!this.configService.apiOptions.trustProxy;
        } catch {
            return undefined;
        }
    }

    private getCorsWildcardOrigin(): boolean | undefined {
        try {
            const cors = this.configService.apiOptions.cors;
            if (!cors) {
                return false;
            }
            if (cors === true) {
                return true;
            }
            const origin = (cors as { origin?: unknown }).origin;
            return origin === true || origin === '*';
        } catch {
            return undefined;
        }
    }

    private getTokenMethods(): string[] | undefined {
        try {
            const tokenMethod = this.configService.authOptions.tokenMethod ?? 'cookie';
            const methods = Array.isArray(tokenMethod) ? tokenMethod : [tokenMethod];
            return methods.slice(0, 5).map(method => String(method).slice(0, 16));
        } catch {
            return undefined;
        }
    }

    private getRequireVerification(): boolean | undefined {
        try {
            // requireVerification defaults to true
            return this.configService.authOptions.requireVerification !== false;
        } catch {
            return undefined;
        }
    }

    private getAuthDisabled(): boolean | undefined {
        try {
            return !!this.configService.authOptions.disableAuth;
        } catch {
            return undefined;
        }
    }

    private getDefaultSuperadminCredentials(): boolean | undefined {
        try {
            // Compares against the well-known defaults only; the actual values
            // are never read into the payload.
            const credentials = this.configService.authOptions.superadminCredentials;
            return credentials?.identifier === 'superadmin' && credentials?.password === 'superadmin';
        } catch {
            return undefined;
        }
    }

    private getCookieSecure(): boolean | undefined {
        try {
            return this.configService.authOptions.cookieOptions?.secure === true;
        } catch {
            return undefined;
        }
    }

    private getCookieSameSite(): string | undefined {
        try {
            const sameSite = this.configService.authOptions.cookieOptions?.sameSite;
            return sameSite === undefined ? undefined : String(sameSite).slice(0, 16);
        } catch {
            return undefined;
        }
    }

    private getSettingsStoreFieldCount(): number | undefined {
        try {
            const fields = this.configService.settingsStoreFields;
            return Object.values(fields).reduce(
                (sum, namespaceFields) => sum + (Array.isArray(namespaceFields) ? namespaceFields.length : 0),
                0,
            );
        } catch {
            return undefined;
        }
    }

    /**
     * Compares the live strategy class of each single-strategy field against the
     * default config and returns the dotted paths that differ. Emits paths only,
     * never class names, so custom project vocabulary cannot leak.
     */
    private getCustomizedStrategies(): string[] | undefined {
        try {
            const result: string[] = [];
            for (const [optionsKey, fields] of Object.entries(SINGLE_STRATEGY_PATHS)) {
                const liveOptions = (this.configService as any)[optionsKey];
                const defaultOptions = (defaultConfig as any)[optionsKey];
                for (const field of fields) {
                    try {
                        const liveStrategy = liveOptions?.[field];
                        const defaultStrategy = defaultOptions?.[field];
                        if (liveStrategy == null || defaultStrategy == null) {
                            continue;
                        }
                        const liveName = getStrategyName(liveStrategy);
                        const defaultName = getStrategyName(defaultStrategy);
                        if (liveName === 'unknown' || defaultName === 'unknown') {
                            continue;
                        }
                        if (liveName !== defaultName) {
                            result.push(`${optionsKey}.${field}`);
                        }
                    } catch {
                        // Skip this field on any per-field failure
                    }
                }
            }
            return result.slice(0, 64).map(path => path.slice(0, 64));
        } catch {
            return undefined;
        }
    }

    private getDefaultLanguage(): string | undefined {
        try {
            return this.configService.defaultLanguageCode;
        } catch {
            return undefined;
        }
    }

    private getAssetStorageType(): string {
        try {
            return getStrategyName(this.configService.assetOptions.assetStorageStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getJobQueueType(): string {
        try {
            return getStrategyName(this.configService.jobQueueOptions.jobQueueStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getEntityIdStrategy(): string {
        try {
            const strategy =
                this.configService.entityOptions.entityIdStrategy ?? this.configService.entityIdStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getAuthenticationMethods(): string[] {
        try {
            const methods = new Set<string>();

            const adminStrategies = this.configService.authOptions.adminAuthenticationStrategy;
            const shopStrategies = this.configService.authOptions.shopAuthenticationStrategy;

            for (const strategy of adminStrategies) {
                methods.add(getStrategyName(strategy));
            }

            for (const strategy of shopStrategies) {
                methods.add(getStrategyName(strategy));
            }

            return Array.from(methods).sort((a, b) => a.localeCompare(b));
        } catch {
            return [];
        }
    }

    private getMoneyStrategy(): string {
        try {
            const strategy = this.configService.entityOptions.moneyStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getCacheStrategy(): string {
        try {
            return getStrategyName(this.configService.systemOptions.cacheStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getTaxLineCalculationStrategy(): string {
        try {
            return getStrategyName(this.configService.taxOptions.taxLineCalculationStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getOrderSellerStrategy(): string {
        try {
            const strategy = this.configService.orderOptions.orderSellerStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getPaymentHandlerCodes(): string[] {
        try {
            return this.configService.paymentOptions.paymentMethodHandlers.map(h => h.code);
        } catch {
            return [];
        }
    }

    private getShippingCalculatorCodes(): string[] {
        try {
            return this.configService.shippingOptions.shippingCalculators.map(c => c.code);
        } catch {
            return [];
        }
    }

    private getFulfillmentHandlerCodes(): string[] {
        try {
            return this.configService.shippingOptions.fulfillmentHandlers.map(h => h.code);
        } catch {
            return [];
        }
    }

    private getPromotionConditionCount(): number {
        try {
            return this.configService.promotionOptions.promotionConditions?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getPromotionActionCount(): number {
        try {
            return this.configService.promotionOptions.promotionActions?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getScheduledTaskCount(): number {
        try {
            return this.configService.schedulerOptions.tasks?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getCustomFieldsPerEntity(): Record<string, number> {
        try {
            const customFields = this.configService.customFields;
            const result: Record<string, number> = {};

            for (const entityName of Object.keys(customFields)) {
                const fields = customFields[entityName as keyof typeof customFields];
                if (Array.isArray(fields) && fields.length > 0) {
                    result[entityName] = fields.length;
                }
            }

            return result;
        } catch {
            return {};
        }
    }

    private hasCustomOrderProcess(): boolean {
        try {
            return (this.configService.orderOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }

    private hasCustomPaymentProcess(): boolean {
        try {
            return (this.configService.paymentOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }

    private hasCustomFulfillmentProcess(): boolean {
        try {
            return (this.configService.shippingOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }
}
