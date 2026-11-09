import { Type } from '@nestjs/common';
import { PermissionDefinition, PluginCommonModule, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import {
    CustomsRecordFieldResolver,
    OnebridgeAdminResolver,
    OnebridgeContentFieldResolver,
    OnebridgeShopResolver,
    onebridgeAdminTypeDefs,
    onebridgeShopTypeDefs,
    RfqFieldResolver,
    ServiceChannelFieldResolver,
    StageEventFieldResolver,
} from './api';
import { applyOnebridgeCustomFields } from './custom-fields';
import { ContentEntry, CustomsRecord, ExchangeRate, InspectionReport, Rfq, RfqQuote, RfqSample, StageEvent } from './entities';
import { CreateOnebridgeTablesMigration } from './migrations';
import { koreaPgPaymentHandler, OnebridgePaymentCallbackService, OnebridgePaymentController } from './payments';
import { onebridgePermissionDefinitions } from './permissions';
import {
    OnebridgeContentService,
    OnebridgeCustomsService,
    OnebridgeInspectionService,
    OnebridgeOrderSummaryService,
    OnebridgeRfqService,
    setOnebridgeChannelToken,
} from './services';
import { OnebridgePluginOptions } from './types';

function mergePermissions(
    existing: PermissionDefinition[] | undefined,
    additions: PermissionDefinition[],
): PermissionDefinition[] {
    const names = new Set((existing ?? []).map(p => p.getMetadata()[0].name));
    return [
        ...(existing ?? []),
        ...additions.filter(p => !names.has(p.getMetadata()[0].name)),
    ];
}

/**
 * ONE BRIDGE 跨境插件（计划书 §7.1）。
 * M1：实体 + 幂等建表迁移 + customFields + 权限 + 领域纯函数。
 * M2：Shop/Admin resolver、内容/验货/清关、订单聚合、Dashboard、种子、e2e。
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Rfq, RfqQuote, RfqSample, StageEvent, InspectionReport, CustomsRecord, ExchangeRate, ContentEntry],
    providers: [
        CreateOnebridgeTablesMigration,
        OnebridgeRfqService,
        OnebridgeContentService,
        OnebridgeInspectionService,
        OnebridgeCustomsService,
        OnebridgeOrderSummaryService,
        OnebridgePaymentCallbackService,
    ],
    controllers: [OnebridgePaymentController],
    shopApiExtensions: {
        schema: () => gql(onebridgeShopTypeDefs),
        resolvers: [
            OnebridgeShopResolver,
            RfqFieldResolver,
            StageEventFieldResolver,
            OnebridgeContentFieldResolver,
            ServiceChannelFieldResolver,
            CustomsRecordFieldResolver,
        ],
    },
    adminApiExtensions: {
        schema: () => gql(onebridgeAdminTypeDefs),
        resolvers: [OnebridgeAdminResolver, RfqFieldResolver, StageEventFieldResolver, CustomsRecordFieldResolver],
    },
    configuration: config => {
        config.customFields = applyOnebridgeCustomFields(config.customFields);
        config.authOptions = config.authOptions ?? {};
        config.authOptions.customPermissions = mergePermissions(
            config.authOptions.customPermissions,
            onebridgePermissionDefinitions,
        );
        // 韩国 PG 桩（CT-05）：按 code 幂等注册，避免重复 init 时出现两个同 code handler
        config.paymentOptions = config.paymentOptions ?? { paymentMethodHandlers: [] };
        const handlers = config.paymentOptions.paymentMethodHandlers ?? [];
        if (!handlers.some(h => h.code === koreaPgPaymentHandler.code)) {
            handlers.push(koreaPgPaymentHandler);
        }
        config.paymentOptions.paymentMethodHandlers = handlers;
        return config;
    },
    dashboard: '../dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class OnebridgePlugin {
    private static pluginOptions: OnebridgePluginOptions = {};

    static init(options?: OnebridgePluginOptions): Type<OnebridgePlugin> {
        OnebridgePlugin.pluginOptions = options ?? {};
        setOnebridgeChannelToken(OnebridgePlugin.pluginOptions.channelToken);
        return OnebridgePlugin;
    }

    static get options(): OnebridgePluginOptions {
        return OnebridgePlugin.pluginOptions;
    }
}
