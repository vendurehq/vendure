import { DataSourceOptions } from 'typeorm';

/**
 * Range buckets for anonymizing entity counts
 */
export type RangeBucket = '0' | '1-100' | '101-1k' | '1k-10k' | '10k-100k' | '100k+';

/**
 * Supported database types for Vendure telemetry.
 * Derived from TypeORM's DataSourceOptions for type safety.
 * Note: 'better-sqlite3' is normalized to 'sqlite' in the collector.
 */
export type SupportedDatabaseType =
    | Extract<DataSourceOptions['type'], 'postgres' | 'mysql' | 'mariadb' | 'sqlite'>
    | 'other';

/**
 * Information about plugins used in the Vendure installation
 */
export interface TelemetryPluginInfo {
    /**
     * Names of detected Vendure plugin npm packages. Detected either from loaded
     * modules (official plugins by class name; third-party plugins via
     * require.cache under CommonJS) or from the public ecosystem packages
     * (`@vendure/*`, `@vendure-community/*`) declared in the host package.json.
     * Private/custom plugin names are never collected.
     */
    npm: string[];
    /** Count of custom plugins (names are NOT collected for privacy) */
    customCount: number;
}

/**
 * Entity count metrics using range buckets for privacy
 */
export interface TelemetryEntityMetrics {
    entities: Partial<Record<string, RangeBucket>>;
    custom: {
        entityCount: number;
        totalRecords?: RangeBucket;
    };
}

/**
 * Deployment environment information
 */
export interface TelemetryDeployment {
    containerized?: boolean;
    cloudProvider?: string;
    workerMode?: 'integrated' | 'separate';
    serverless?: boolean;
}

/**
 * Configuration snapshot (strategy class names only, no sensitive data)
 */
export interface TelemetryConfig {
    assetStorageType?: string;
    jobQueueType?: string;
    entityIdStrategy?: string;
    defaultLanguage?: string;
    customFieldsCount?: number;
    authenticationMethods?: string[];

    // Scale indicators (range-bucketed entity counts)
    channelCount?: RangeBucket;
    paymentMethodCount?: RangeBucket;
    shippingMethodCount?: RangeBucket;

    // Additional strategy names
    moneyStrategy?: string;
    cacheStrategy?: string;
    taxLineCalculationStrategy?: string;
    orderSellerStrategy?: string;

    // Integration codes (from ConfigurableOperationDef.code)
    paymentHandlerCodes?: string[];
    shippingCalculatorCodes?: string[];
    fulfillmentHandlerCodes?: string[];

    // Customization counts
    promotionConditionCount?: number;
    promotionActionCount?: number;
    scheduledTaskCount?: number;

    // Custom fields breakdown (entity name -> count, only entries > 0)
    customFieldsPerEntity?: Record<string, number>;

    // Process customization flags
    hasCustomOrderProcess?: boolean;
    hasCustomPaymentProcess?: boolean;
    hasCustomFulfillmentProcess?: boolean;
}

/**
 * Feature adoption flags derived from entity counts and configuration.
 * These booleans give a quick overview of which major Vendure features
 * an installation is actively using.
 */
export interface TelemetryFeatures {
    /** More than one Channel configured */
    multiChannel?: boolean;
    /** Using multi-vendor/marketplace features (Sellers > 1 or custom OrderSellerStrategy) */
    multiVendor?: boolean;
    /** More than one StockLocation configured */
    multiStockLocation?: boolean;
    /** API keys in use */
    apiKeysEnabled?: boolean;
    /** Any custom fields defined */
    customFieldsInUse?: boolean;
    /** Scheduled tasks configured beyond defaults */
    scheduledTasks?: boolean;
}

/**
 * Full telemetry payload sent to the collection endpoint
 */
export interface TelemetryPayload {
    // Required fields
    installationId: string;
    timestamp: string;
    vendureVersion: string;
    nodeVersion: string;
    databaseType: SupportedDatabaseType;

    // Optional fields
    environment?: string;
    platform?: string;
    plugins?: TelemetryPluginInfo;
    metrics?: TelemetryEntityMetrics;
    deployment?: TelemetryDeployment;
    config?: TelemetryConfig;
    features?: TelemetryFeatures;
}
