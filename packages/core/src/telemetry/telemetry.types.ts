import { DataSourceOptions } from 'typeorm';

/**
 * Range buckets for anonymizing entity counts
 */
export type RangeBucket = '0' | '1-100' | '101-1k' | '1k-10k' | '10k-100k' | '100k+';

/**
 * Reason a telemetry event was sent. `startup` is the single send shortly after
 * bootstrap; `heartbeat` is the repeating daily send.
 */
export type SendReason = 'startup' | 'heartbeat';

/**
 * Runtime environment information (engine, package manager, hardware shape).
 * All fields are best-effort — any that cannot be resolved are omitted.
 */
export interface TelemetryRuntime {
    /** JavaScript runtime executing the process */
    runtimeType?: 'node' | 'bun' | 'deno';
    /** Package manager that launched the process, parsed from npm_config_user_agent */
    packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
    /** Whether the process is running under ts-node */
    tsNode?: boolean;
    /** Number of logical CPUs */
    cpuCount?: number;
    /** Total system memory rounded to whole gigabytes */
    totalMemoryGb?: number;
}

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
    /** Order lifecycle breakdown (range-bucketed counts) */
    orders?: TelemetryOrderMetrics;
    /** Internationalization breadth derived from the Channel table */
    i18n?: TelemetryI18nMetrics;
}

/**
 * Internationalization breadth derived from the Channel table.
 */
export interface TelemetryI18nMetrics {
    /** Distinct language codes across all channels */
    languages?: number;
    /** Distinct currency codes across all channels */
    currencies?: number;
}

/**
 * Order lifecycle metrics using range buckets for privacy. Every field is
 * independent — a single failed query leaves that field undefined.
 */
export interface TelemetryOrderMetrics {
    /** Orders where orderPlacedAt is not null */
    placed?: RangeBucket;
    /** Orders where active = true */
    active?: RangeBucket;
    /** Orders in the Draft state */
    draft?: RangeBucket;
    /** Orders placed within the last 30 days */
    placedLast30d?: RangeBucket;
    /** Order counts keyed by OrderType (only types with count > 0) */
    byType?: Record<string, RangeBucket>;
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

    // API / security posture — booleans and short enums only, never raw values
    apiIntrospectionEnabled?: boolean;
    apiPlaygroundEnabled?: boolean;
    apiDebugEnabled?: boolean;
    trustProxyEnabled?: boolean;
    corsWildcardOrigin?: boolean;
    tokenMethods?: string[];
    requireVerification?: boolean;
    authDisabled?: boolean;
    /** True when superadmin identifier and password are both left at the 'superadmin' default */
    defaultSuperadminCredentials?: boolean;
    cookieSecure?: boolean;
    cookieSameSite?: string;
    settingsStoreFieldCount?: number;
    /**
     * Dotted VendureConfig paths of single-strategy fields whose live strategy
     * class differs from the default config. Paths only — never class names.
     */
    customizedStrategies?: string[];
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
    /** More than one distinct currency configured across channels */
    multiCurrency?: boolean;
}

/**
 * Full telemetry payload sent to the collection endpoint
 */
export interface TelemetryPayload {
    // Required fields
    schemaVersion: number;
    installationId: string;
    timestamp: string;
    vendureVersion: string;
    nodeVersion: string;
    databaseType: SupportedDatabaseType;

    // Optional fields
    sendReason?: SendReason;
    uptimeSeconds?: number;
    environment?: string;
    platform?: string;
    runtime?: TelemetryRuntime;
    plugins?: TelemetryPluginInfo;
    metrics?: TelemetryEntityMetrics;
    deployment?: TelemetryDeployment;
    config?: TelemetryConfig;
    features?: TelemetryFeatures;
}
