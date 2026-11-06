import { Inject, OnApplicationBootstrap, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Injector,
    Logger,
    OrderStateTransitionEvent,
    PluginCommonModule,
    VendurePlugin,
    EventBus,
} from '@vendure/core';
import gql from 'graphql-tag';

import { FLASH_SALE_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { FlashSaleActivity } from './flash-sale-activity.entity';
import { FlashSaleAdminResolver } from './flash-sale-admin.resolver';
import { flashSaleStatusTask } from './flash-sale.job';
import { flashSaleDiscountCondition } from './flash-sale-promotion-condition';
import { flashSalePriceAction } from './flash-sale-price-action';
import { FlashSaleService } from './flash-sale.service';
import { FlashSaleShopResolver } from './flash-sale-shop.resolver';
import { FlashSalePluginOptions } from './types';
import { flashSaleOrderCustomFields } from './order-custom-fields';

/** Idempotently merge custom fields, deduplicating by field name (preBootstrapConfig may run plugin configurations multiple times). */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [FlashSaleActivity],
    providers: [
        { provide: FLASH_SALE_PLUGIN_OPTIONS, useFactory: () => FlashSalePlugin.options },
        FlashSaleService,
    ],
    exports: [FlashSaleService],
    adminApiExtensions: {
        schema: () => gql`
            enum FlashSaleStatus { upcoming active ended }

            type FlashSaleActivity implements Node {
                id: ID!
                name: String!
                startAt: DateTime!
                endAt: DateTime!
                flashPrice: Int!
                totalStock: Int!
                soldCount: Int!
                limitPerUser: Int!
                productId: ID!
                variantId: ID!
                status: FlashSaleStatus!
                createdAt: DateTime!
                updatedAt: DateTime!
            }

            type FlashSaleActivityList implements PaginatedList {
                items: [FlashSaleActivity!]!
                totalItems: Int!
            }

            input CreateFlashSaleActivityInput {
                name: String!
                startAt: DateTime!
                endAt: DateTime!
                flashPrice: Int!
                totalStock: Int!
                limitPerUser: Int
                productId: ID!
                variantId: ID!
            }

            input UpdateFlashSaleActivityInput {
                id: ID!
                name: String
                startAt: DateTime
                endAt: DateTime
                flashPrice: Int
                totalStock: Int
                limitPerUser: Int
                productId: ID
                variantId: ID
            }

            input FlashSaleActivityListOptions

            extend type Query {
                flashSaleActivities(options: FlashSaleActivityListOptions): FlashSaleActivityList!
                flashSaleActivity(id: ID!): FlashSaleActivity
            }

            extend type Mutation {
                createFlashSaleActivity(input: CreateFlashSaleActivityInput!): FlashSaleActivity!
                updateFlashSaleActivity(input: UpdateFlashSaleActivityInput!): FlashSaleActivity!
                """显式改状态：upcoming→仅开始前；active→必须在活动窗口内；ended→随时可人工下线"""
                setFlashSaleActivityStatus(id: ID!, status: FlashSaleStatus!): FlashSaleActivity!
                deleteFlashSaleActivity(id: ID!): Boolean!
            }
        `,
        resolvers: [FlashSaleAdminResolver],
    },
    shopApiExtensions: {
        schema: () => gql`
            enum FlashSaleStatus { upcoming active ended }

            type FlashSaleActivity implements Node {
                id: ID!
                name: String!
                startAt: DateTime!
                endAt: DateTime!
                flashPrice: Int!
                totalStock: Int!
                soldCount: Int!
                limitPerUser: Int!
                productId: ID!
                variantId: ID!
                status: FlashSaleStatus!
                createdAt: DateTime!
                updatedAt: DateTime!
            }

            extend type Query {
                activeFlashSaleActivities: [FlashSaleActivity!]!
            }

            extend type Mutation {
                applyFlashSale(activityId: ID!): Order!
            }
        `,
        resolvers: [FlashSaleShopResolver],
    },
    configuration: (config) => {
        config.customFields.Order = mergeCustomFields(config.customFields.Order, flashSaleOrderCustomFields.Order);

        config.promotionOptions = config.promotionOptions || {};
        config.promotionOptions.promotionConditions = [
            ...(config.promotionOptions.promotionConditions ?? []),
            flashSaleDiscountCondition,
        ];
        config.promotionOptions.promotionActions = [
            ...(config.promotionOptions.promotionActions ?? []),
            flashSalePriceAction,
        ];

        // 注册秒杀状态转换 ScheduledTask（由 DefaultSchedulerPlugin 在 worker 上周期执行）
        if (!config.schedulerOptions) {
            config.schedulerOptions = { tasks: [] } as any;
        }
        if (!config.schedulerOptions.tasks) {
            config.schedulerOptions.tasks = [];
        }
        config.schedulerOptions.tasks.push(flashSaleStatusTask);

        return config;
    },
    dashboard: '../dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class FlashSalePlugin implements OnApplicationBootstrap {
    private static options: FlashSalePluginOptions = {};
    private injector: Injector;

    constructor(
        @Inject(FLASH_SALE_PLUGIN_OPTIONS) private options: FlashSalePluginOptions,
        private flashSaleService: FlashSaleService,
        private eventBus: EventBus,
        private moduleRef: ModuleRef,
    ) {}

    static init(options?: FlashSalePluginOptions): Type<FlashSalePlugin> {
        FlashSalePlugin.options = options ?? {};
        return FlashSalePlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        this.injector = new Injector(this.moduleRef);
        this.flashSaleService.init(this.injector);

        // 订单取消时按订单内秒杀行实际件数回滚预占库存（修正固定 1 件）
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'Cancelled') return;
            const activityId = (event.order as any)?.customFields?.flashSaleActivityId;
            if (!activityId) return;
            try {
                await this.flashSaleService.releaseStockForOrder(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(
                    `Failed to release stock for activity ${activityId} on cancel: ${e.message}`,
                    loggerCtx,
                );
            }
        });

        Logger.info('FlashSalePlugin initialized', loggerCtx);
    }
}
