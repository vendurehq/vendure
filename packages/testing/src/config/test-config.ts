import { ADMIN_API_PATH, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    DefaultAssetNamingStrategy,
    defaultConfig,
    DefaultLogger,
    mergeConfig,
    NoopLogger,
    VendureConfig,
} from '@vendure/core';

import { TestingAssetPreviewStrategy } from './testing-asset-preview-strategy';
import { TestingAssetStorageStrategy } from './testing-asset-storage-strategy';
import { TestingEntityIdStrategy } from './testing-entity-id-strategy';

export const E2E_DEFAULT_CHANNEL_TOKEN = 'e2e-default-channel';

const logger = process.env.LOG ? new DefaultLogger() : new NoopLogger();

/**
 * @description
 * A {@link VendureConfig} object used for e2e tests. This configuration uses sqljs as the database
 * and configures some special settings which are optimized for e2e tests:
 *
 * * `entityIdStrategy: new TestingEntityIdStrategy()` This ID strategy uses auto-increment IDs but encodes all IDs
 * to be prepended with the string `'T_'`, so ID `1` becomes `'T_1'`.
 * * `logger: new NoopLogger()` Do no output logs by default
 * * `assetStorageStrategy: new TestingAssetStorageStrategy()` This strategy does not actually persist any binary data to disk.
 * * `assetPreviewStrategy: new TestingAssetPreviewStrategy()` This strategy is a no-op.
 *
 * ## Logging
 * By default, the testConfig does not output any log messages. This is most desirable to keep a clean CI output.
 * However, for debugging purposes, it can make it hard to figure out why tests fail.
 *
 * You can enable default logging behaviour with the environment variable `LOG`:
 *
 * ```
 * LOG=true yarn e2e
 * ```
 *
 * @docsCategory testing
 */
export const testConfig: Required<VendureConfig> = mergeConfig(defaultConfig, {
    apiOptions: {
        port: 3050,
        adminApiPath: ADMIN_API_PATH,
        shopApiPath: SHOP_API_PATH,
        cors: true,
    },
    defaultChannelToken: E2E_DEFAULT_CHANNEL_TOKEN,
    authOptions: {
        tokenMethod: 'bearer',
        requireVerification: true,
        cookieOptions: {
            secret: 'some-secret',
        },
    },
    dbConnectionOptions: {
        type: 'sqljs',
        database: new Uint8Array([]),
        location: '',
        autoSave: false,
        logging: false,
    },
    promotionOptions: {},
    customFields: {},
    entityOptions: { entityIdStrategy: new TestingEntityIdStrategy() },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    logger,
    importExportOptions: {},
    assetOptions: {
        assetNamingStrategy: new DefaultAssetNamingStrategy(),
        assetStorageStrategy: new TestingAssetStorageStrategy(),
        assetPreviewStrategy: new TestingAssetPreviewStrategy(),
    },
});
