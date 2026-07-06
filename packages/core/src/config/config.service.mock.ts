/* eslint-disable @typescript-eslint/ban-types */
import { Mock, vi } from 'vitest';

import { MockClass } from '../testing/testing-types';

import { ConfigService } from './config.service';
import { EntityIdStrategy } from './entity/entity-id-strategy';
import { DefaultOrderLineDiscountDistributionStrategy } from './order/default-order-line-discount-distribution-strategy';
import { OrderOptions } from './vendure-config';

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
    orderOptions: Partial<OrderOptions> = {
        orderLineDiscountDistributionStrategy: new DefaultOrderLineDiscountDistributionStrategy(),
    };
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
