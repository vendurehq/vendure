import { Inject, OnApplicationBootstrap, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventBus, Injector, Logger, OrderStateTransitionEvent, PluginCommonModule, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import { GROUP_BUY_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { GroupBuyPluginOptions } from './types';
import { GroupBuyActivity } from './group-buy-activity.entity';
import { GroupBuyOrder } from './group-buy-order.entity';
import { GroupBuyService } from './group-buy.service';
import { GroupBuyAdminResolver } from './group-buy-admin.resolver';
import { GroupBuyShopResolver } from './group-buy-shop.resolver';
import { GroupBuyJob } from './group-buy.job';
import { groupBuyOrderCustomFields } from './order-custom-fields';
import { groupBuyDiscountCondition } from './group-buy-promotion-condition';
import { groupBuyLeaderRewardCondition } from './group-buy-leader-promotion';
import { groupBuyPriceAction } from './group-buy-price-action';
import { groupBuyLeaderRewardAction } from './group-buy-leader-reward-action';
import { groupBuyCheckTask } from './group-buy-scheduled-task';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [GroupBuyActivity, GroupBuyOrder],
    providers: [
        { provide: GROUP_BUY_PLUGIN_OPTIONS, useFactory: () => GroupBuyPlugin.options },
        GroupBuyService,
        GroupBuyJob,
    ],
    exports: [GroupBuyService],
    adminApiExtensions: {
        schema: () => gql`
            enum GroupBuyStatus { active completed expired }

            type GroupBuyActivity implements Node {
                id: ID!
                name: String!
                description: String!
                targetCount: Int!
                currentCount: Int!
                maxCount: Int!
                status: GroupBuyStatus!
                startAt: DateTime!
                endAt: DateTime!
                groupPrice: Int!
                leaderDiscount: Int!
                leaderRewardType: String!
                autoConfirm: Boolean!
                allowJoinAfterComplete: Boolean!
                productId: ID!
                variantId: ID!
                createdAt: DateTime!
                updatedAt: DateTime!
            }

            type GroupBuyActivityList implements PaginatedList {
                items: [GroupBuyActivity!]!
                totalItems: Int!
            }

            input CreateGroupBuyActivityInput {
                name: String!
                description: String!
                targetCount: Int!
                maxCount: Int
                startAt: DateTime!
                endAt: DateTime!
                groupPrice: Int!
                leaderDiscount: Int
                leaderRewardType: String
                autoConfirm: Boolean
                allowJoinAfterComplete: Boolean
                productId: ID!
                variantId: ID!
            }

            input UpdateGroupBuyActivityInput {
                id: ID!
                name: String
                description: String
                targetCount: Int
                maxCount: Int
                startAt: DateTime
                endAt: DateTime
                groupPrice: Int
                leaderDiscount: Int
                status: GroupBuyStatus
            }

            input GroupBuyActivityListOptions

            extend type Query {
                groupBuyActivities(options: GroupBuyActivityListOptions): GroupBuyActivityList!
                groupBuyActivity(id: ID!): GroupBuyActivity
            }

            extend type Mutation {
                createGroupBuyActivity(input: CreateGroupBuyActivityInput!): GroupBuyActivity!
                updateGroupBuyActivity(input: UpdateGroupBuyActivityInput!): GroupBuyActivity!
                deleteGroupBuyActivity(id: ID!): Boolean!
                runGroupBuyExpiryCheck: Boolean!
            }
        `,
        resolvers: [GroupBuyAdminResolver],
    },
    shopApiExtensions: {
        schema: () => gql`
            enum GroupBuyStatus { active completed expired }

            type GroupBuyActivity implements Node {
                id: ID!
                name: String!
                description: String!
                targetCount: Int!
                currentCount: Int!
                maxCount: Int!
                status: GroupBuyStatus!
                startAt: DateTime!
                endAt: DateTime!
                groupPrice: Int!
                leaderDiscount: Int!
                leaderRewardType: String!
                autoConfirm: Boolean!
                allowJoinAfterComplete: Boolean!
                createdAt: DateTime!
                updatedAt: DateTime!
                productId: ID!
                variantId: ID!
            }

            type GroupBuyOrderResult {
                id: ID!
                groupBuyActivityId: ID!
                isLeader: Boolean!
                status: String!
            }

            type MyGroupBuyOrder {
                id: ID!
                orderId: ID!
                orderCode: String
                groupBuyActivityId: ID!
                isLeader: Boolean!
                status: String!
                activity: GroupBuyActivity
            }

            extend type Query {
                activeGroupBuyActivities: [GroupBuyActivity!]!
                groupBuyActivity(id: ID!): GroupBuyActivity
                myGroupBuyOrders(isLeader: Boolean!): [MyGroupBuyOrder!]!
            }

            extend type Mutation {
                joinGroupBuy(activityId: ID!, orderId: ID!, isLeader: Boolean!): GroupBuyOrderResult!
            }
        `,
        resolvers: [GroupBuyShopResolver],
    },
    configuration: (config) => {
        config.customFields = {
            ...config.customFields,
            Order: [
                ...(config.customFields?.Order ?? []),
                ...groupBuyOrderCustomFields.Order!,
            ],
        };

        config.promotionOptions = config.promotionOptions || {};
        config.promotionOptions.promotionConditions = [
            ...(config.promotionOptions.promotionConditions ?? []),
            groupBuyDiscountCondition,
            groupBuyLeaderRewardCondition,
        ];
        config.promotionOptions.promotionActions = [
            ...(config.promotionOptions.promotionActions ?? []),
            groupBuyPriceAction,
            groupBuyLeaderRewardAction,
        ];

        config.schedulerOptions = config.schedulerOptions || {};
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), groupBuyCheckTask];

        return config;
    },
    dashboard: '../dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class GroupBuyPlugin implements OnApplicationBootstrap {
    private static options: GroupBuyPluginOptions = {};
    private injector: Injector;

    constructor(
        @Inject(GROUP_BUY_PLUGIN_OPTIONS) private options: GroupBuyPluginOptions,
        private groupBuyService: GroupBuyService,
        private groupBuyJob: GroupBuyJob,
        private eventBus: EventBus,
        private moduleRef: ModuleRef,
    ) {}

    static init(options?: GroupBuyPluginOptions): Type<GroupBuyPlugin> {
        GroupBuyPlugin.options = options ?? {};
        return GroupBuyPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        this.injector = new Injector(this.moduleRef);
        this.groupBuyService.init(this.injector);
        this.groupBuyJob.initStock(this.injector);

        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'Cancelled') return;
            const order = event.order as any;
            const activityId = order?.customFields?.groupBuyActivityId;
            if (!activityId) return;
            try {
                const { StockReserveService } = require('@vendure/redis-stock-plugin') as any;
                const stockReserveService = this.injector.get(StockReserveService) as any;
                if (stockReserveService?.isAvailable) {
                    await stockReserveService.releaseStock(`group-buy:${activityId}`, 1);
                }
            } catch {
                // RedisStockPlugin not installed
            }
        });
        Logger.info('GroupBuyPlugin initialized', loggerCtx);
    }
}
