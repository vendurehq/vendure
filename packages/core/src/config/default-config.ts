import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    DEFAULT_APIKEY_HEADER_KEY,
    DEFAULT_AUTH_TOKEN_HEADER_KEY,
    DEFAULT_CHANNEL_TOKEN_KEY,
    SUPER_ADMIN_USER_IDENTIFIER,
    SUPER_ADMIN_USER_PASSWORD,
} from '@vendure/common/lib/shared-constants';
import { randomBytes } from 'crypto';

import { TypeORMHealthCheckStrategy } from '../health-check/typeorm-health-check-strategy';
import { InMemoryJobQueueStrategy } from '../job-queue/in-memory-job-queue-strategy';
import { InMemoryJobBufferStorageStrategy } from '../job-queue/job-buffer/in-memory-job-buffer-storage-strategy';
import { NoopSchedulerStrategy } from '../scheduler/noop-scheduler-strategy';
import { cleanSessionsTask } from '../scheduler/tasks/clean-sessions-task';

import { RandomBytesApiKeyStrategy } from './api-key-strategy/random-bytes-api-key-strategy';
import { DefaultAssetImportStrategy } from './asset-import-strategy/default-asset-import-strategy';
import { DefaultAssetNamingStrategy } from './asset-naming-strategy/default-asset-naming-strategy';
import { NoAssetPreviewStrategy } from './asset-preview-strategy/no-asset-preview-strategy';
import { NoAssetStorageStrategy } from './asset-storage-strategy/no-asset-storage-strategy';
import { BcryptPasswordHashingStrategy } from './auth/bcrypt-password-hashing-strategy';
import { DefaultPasswordValidationStrategy } from './auth/default-password-validation-strategy';
import { DefaultVerificationTokenStrategy } from './auth/default-verification-token-strategy';
import { NativeAuthenticationStrategy } from './auth/native-authentication-strategy';
import { defaultCollectionFilters } from './catalog/default-collection-filters';
import { DefaultProductVariantPriceCalculationStrategy } from './catalog/default-product-variant-price-calculation-strategy';
import { DefaultProductVariantPriceSelectionStrategy } from './catalog/default-product-variant-price-selection-strategy';
import { DefaultProductVariantPriceUpdateStrategy } from './catalog/default-product-variant-price-update-strategy';
import { DefaultStockDisplayStrategy } from './catalog/default-stock-display-strategy';
import { MultiChannelStockLocationStrategy } from './catalog/multi-channel-stock-location-strategy';
import { AutoIncrementIdStrategy } from './entity/auto-increment-id-strategy';
import { DefaultMoneyStrategy } from './entity/default-money-strategy';
import { DefaultSlugStrategy } from './entity/default-slug-strategy';
import { defaultEntityDuplicators } from './entity/entity-duplicators/index';
import { defaultFulfillmentProcess } from './fulfillment/default-fulfillment-process';
import { manualFulfillmentHandler } from './fulfillment/manual-fulfillment-handler';
import { DefaultLogger } from './logger/default-logger';
import { DefaultActiveOrderStrategy } from './order/default-active-order-strategy';
import { DefaultChangedPriceHandlingStrategy } from './order/default-changed-price-handling-strategy';
import { DefaultGuestCheckoutStrategy } from './order/default-guest-checkout-strategy';
import { DefaultOrderItemPriceCalculationStrategy } from './order/default-order-item-price-calculation-strategy';
import { DefaultOrderPlacedStrategy } from './order/default-order-placed-strategy';
import { defaultOrderProcess } from './order/default-order-process';
import { DefaultOrderSellerStrategy } from './order/default-order-seller-strategy';
import { DefaultStockAllocationStrategy } from './order/default-stock-allocation-strategy';
import { MergeOrdersStrategy } from './order/merge-orders-strategy';
import { DefaultOrderByCodeAccessStrategy } from './order/order-by-code-access-strategy';
import { DefaultOrderCodeStrategy } from './order/order-code-strategy';
import { UseGuestStrategy } from './order/use-guest-strategy';
import { defaultPaymentProcess } from './payment/default-payment-process';
import { defaultPromotionActions, defaultPromotionConditions } from './promotion';
import { defaultRefundProcess } from './refund/default-refund-process';
import { DefaultSessionCacheStrategy } from './session-cache/default-session-cache-strategy';
import { cleanOrphanedSettingsStoreTask } from './settings-store/clean-orphaned-settings-store-task';
import { defaultShippingCalculator } from './shipping-method/default-shipping-calculator';
import { defaultShippingEligibilityChecker } from './shipping-method/default-shipping-eligibility-checker';
import { DefaultShippingLineAssignmentStrategy } from './shipping-method/default-shipping-line-assignment-strategy';
import { InMemoryCacheStrategy } from './system/in-memory-cache-strategy';
import { NoopInstrumentationStrategy } from './system/noop-instrumentation-strategy';
import { DefaultTaxLineCalculationStrategy } from './tax/default-tax-line-calculation-strategy';
import { DefaultTaxZoneStrategy } from './tax/default-tax-zone-strategy';
import { RuntimeVendureConfig } from './vendure-config';

/**
 * @description
 * The default configuration settings which are used if not explicitly overridden in the bootstrap() call.
 *
 * @docsCategory configuration
 */
export const defaultConfig: RuntimeVendureConfig = {
    defaultChannelToken: null,
    defaultLanguageCode: LanguageCode.en,
    logger: new DefaultLogger(),
    apiOptions: {
        hostname: '',
        port: 3000,
        adminApiPath: 'admin-api',
        adminApiPlayground: false,
        adminApiDebug: false,
        adminListQueryLimit: 1000,
        adminApiValidationRules: [],
        shopApiPath: 'shop-api',
        shopApiPlayground: false,
        shopApiDebug: false,
        shopListQueryLimit: 100,
        shopApiValidationRules: [],
        channelTokenKey: DEFAULT_CHANNEL_TOKEN_KEY,
        cors: {
            origin: true,
            credentials: true,
        },
        trustProxy: false,
        middleware: [],
        introspection: true,
        apolloServerPlugins: [],
        cache: 'bounded',
    },
    entityIdStrategy: new AutoIncrementIdStrategy(),
    authOptions: {
        disableAuth: false,
        tokenMethod: 'cookie',
        cookieOptions: {
            secret: randomBytes(16).toString('base64url'),
            httpOnly: true,
            sameSite: 'lax',
        },
        authTokenHeaderKey: DEFAULT_AUTH_TOKEN_HEADER_KEY,
        apiKeyHeaderKey: DEFAULT_APIKEY_HEADER_KEY,
        sessionDuration: '1y',
        sessionCacheStrategy: new DefaultSessionCacheStrategy(),
        sessionCacheTTL: 300,
        requireVerification: true,
        verificationTokenDuration: '7d',
        superadminCredentials: {
            identifier: SUPER_ADMIN_USER_IDENTIFIER,
            password: SUPER_ADMIN_USER_PASSWORD,
        },
        shopAuthenticationStrategy: [new NativeAuthenticationStrategy()],
        adminAuthenticationStrategy: [new NativeAuthenticationStrategy()],
        adminApiKeyStrategy: new RandomBytesApiKeyStrategy(),
        shopApiKeyStrategy: new RandomBytesApiKeyStrategy(),
        customPermissions: [],
        passwordHashingStrategy: new BcryptPasswordHashingStrategy(),
        passwordValidationStrategy: new DefaultPasswordValidationStrategy({ minLength: 4, maxLength: 72 }),
        verificationTokenStrategy: new DefaultVerificationTokenStrategy(),
    },
    catalogOptions: {
        collectionFilters: defaultCollectionFilters,
        productVariantPriceSelectionStrategy: new DefaultProductVariantPriceSelectionStrategy(),
        productVariantPriceCalculationStrategy: new DefaultProductVariantPriceCalculationStrategy(),
        productVariantPriceUpdateStrategy: new DefaultProductVariantPriceUpdateStrategy({
            syncPricesAcrossChannels: false,
        }),
        stockDisplayStrategy: new DefaultStockDisplayStrategy(),
        stockLocationStrategy: new MultiChannelStockLocationStrategy(),
    },
    assetOptions: {
        assetNamingStrategy: new DefaultAssetNamingStrategy(),
        assetStorageStrategy: new NoAssetStorageStrategy(),
        assetPreviewStrategy: new NoAssetPreviewStrategy(),
        permittedFileTypes: ['image/*', 'video/*', 'audio/*', '.pdf'],
        uploadMaxFileSize: 20971520,
    },
    dbConnectionOptions: {
        timezone: 'Z',
        type: 'mysql',
    },
    entityOptions: {
        entityIdStrategy: new AutoIncrementIdStrategy(),
        moneyStrategy: new DefaultMoneyStrategy(),
        entityDuplicators: defaultEntityDuplicators,
        channelCacheTtl: 30000,
        zoneCacheTtl: 30000,
        taxRateCacheTtl: 30000,
        metadataModifiers: [],
        slugStrategy: new DefaultSlugStrategy(),
    },
    promotionOptions: {
        promotionConditions: defaultPromotionConditions,
        promotionActions: defaultPromotionActions,
    },
    shippingOptions: {
        shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
        shippingCalculators: [defaultShippingCalculator],
        shippingLineAssignmentStrategy: new DefaultShippingLineAssignmentStrategy(),
        customFulfillmentProcess: [],
        process: [defaultFulfillmentProcess],
        fulfillmentHandlers: [manualFulfillmentHandler],
    },
    orderOptions: {
        orderItemsLimit: 999,
        orderLineItemsLimit: 999,
        orderItemPriceCalculationStrategy: new DefaultOrderItemPriceCalculationStrategy(),
        mergeStrategy: new MergeOrdersStrategy(),
        checkoutMergeStrategy: new UseGuestStrategy(),
        process: [defaultOrderProcess],
        stockAllocationStrategy: new DefaultStockAllocationStrategy(),
        orderCodeStrategy: new DefaultOrderCodeStrategy(),
        orderByCodeAccessStrategy: new DefaultOrderByCodeAccessStrategy('2h'),
        changedPriceHandlingStrategy: new DefaultChangedPriceHandlingStrategy(),
        orderPlacedStrategy: new DefaultOrderPlacedStrategy(),
        activeOrderStrategy: new DefaultActiveOrderStrategy(),
        orderSellerStrategy: new DefaultOrderSellerStrategy(),
        guestCheckoutStrategy: new DefaultGuestCheckoutStrategy(),
        orderInterceptors: [],
    },
    paymentOptions: {
        paymentMethodEligibilityCheckers: [],
        paymentMethodHandlers: [],
        customPaymentProcess: [],
        process: [defaultPaymentProcess],
        refundProcess: [defaultRefundProcess],
    },
    taxOptions: {
        taxZoneStrategy: new DefaultTaxZoneStrategy(),
        taxLineCalculationStrategy: new DefaultTaxLineCalculationStrategy(),
    },
    importExportOptions: {
        importAssetsDir: __dirname,
        assetImportStrategy: new DefaultAssetImportStrategy(),
    },
    jobQueueOptions: {
        jobQueueStrategy: new InMemoryJobQueueStrategy(),
        jobBufferStorageStrategy: new InMemoryJobBufferStorageStrategy(),
        activeQueues: [],
        prefix: '',
    },
    schedulerOptions: {
        schedulerStrategy: new NoopSchedulerStrategy(),
        tasks: [cleanSessionsTask, cleanOrphanedSettingsStoreTask],
        runTasksInWorkerOnly: true,
    },
    customFields: {
        Address: [],
        Administrator: [],
        ApiKey: [],
        Asset: [],
        Channel: [],
        Collection: [],
        Customer: [],
        CustomerGroup: [],
        Facet: [],
        FacetValue: [],
        Fulfillment: [],
        GlobalSettings: [],
        HistoryEntry: [],
        Order: [],
        OrderLine: [],
        Payment: [],
        PaymentMethod: [],
        Product: [],
        ProductOption: [],
        ProductOptionGroup: [],
        ProductVariant: [],
        ProductVariantPrice: [],
        Promotion: [],
        Refund: [],
        Region: [],
        Seller: [],
        Session: [],
        ShippingLine: [],
        ShippingMethod: [],
        StockLevel: [],
        StockLocation: [],
        StockMovement: [],
        TaxCategory: [],
        TaxRate: [],
        User: [],
        Zone: [],
    },
    settingsStoreFields: {},
    plugins: [],
    systemOptions: {
        cacheStrategy: new InMemoryCacheStrategy({ cacheSize: 10_000 }),
        healthChecks: [new TypeORMHealthCheckStrategy()],
        errorHandlers: [],
        instrumentationStrategy: new NoopInstrumentationStrategy(),
    },
};
