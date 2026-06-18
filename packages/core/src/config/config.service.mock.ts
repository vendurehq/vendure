/* eslint-disable @typescript-eslint/ban-types */
import { vi, Mock } from 'vitest';

import { VendureEntity } from '../entity/base/base.entity';
import { MockClass } from '../testing/testing-types';

import { ConfigService } from './config.service';
import { EntityIdStrategy, PrimaryKeyType } from './entity/entity-id-strategy';

export class MockConfigService implements MockClass<ConfigService> {
    apiOptions = {
        channelTokenKey: 'vendure-token',
        adminApiPath: 'admin-api',
        adminApiPlayground: false,
        adminApiDebug: true,
        shopApiPath: 'shop-api',
        shopApiPlayground: false,
        shopApiDebug: true,
        port: 3000,
        cors: false,
        middleware: [],
        apolloServerPlugins: [],
    };
    authOptions: {};
    defaultChannelToken: 'channel-token';
    defaultLanguageCode: Mock<any>;
    roundingStrategy: {};
    entityIdStrategy = new MockIdStrategy();
    entityOptions = {};
    assetOptions = {
        assetNamingStrategy: {} as any,
        assetStorageStrategy: {} as any,
        assetPreviewStrategy: {} as any,
    };
    catalogOptions: {};
    uploadMaxFileSize = 1024;
    dbConnectionOptions = {};
    shippingOptions = {};
    promotionOptions = {
        promotionConditions: [],
        promotionActions: [],
    };
    paymentOptions: {};
    taxOptions: {};
    emailOptions: {};
    importExportOptions: {};
    orderOptions = {};
    customFields = {};

    plugins = [];
    logger = {} as any;
    jobQueueOptions = {};
    systemOptions = {};
}

export const ENCODED = 'encoded';
export const DECODED = 'decoded';

export class MockIdStrategy implements EntityIdStrategy<'increment'> {
    readonly primaryKeyType = 'increment';
    encodeId = vi.fn().mockReturnValue(ENCODED);
    decodeId = vi.fn().mockReturnValue(DECODED);
}
