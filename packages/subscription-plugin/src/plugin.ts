import { Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
    ChannelService,
    JobQueueService,
    Logger,
    PluginCommonModule,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';

import { SUBSCRIPTION_JOB_QUEUE, SUBSCRIPTION_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { SubscriptionOccurrence } from './subscription-occurrence.entity';
import { SubscriptionPlan } from './subscription-plan.entity';
import { Subscription } from './subscription.entity';
import { SubscriptionAdminResolver } from './subscription-admin.resolver';
import { SubscriptionCustomerResolver } from './subscription-customer.resolver';
import { SubscriptionOwnerResolver } from './subscription-owner.resolver';
import { SubscriptionService } from './subscription.service';
import { SubscriptionPluginOptions } from './types';
import { SubscriptionTablesMigration } from './migrations/migrate-subscription-tables';

const { gql } = require('graphql-tag');

/** shop/admin 共用类型（各 API schema 各自内联声明，避免跨 schema 冲突）。 */
const subscriptionTypeDefs = `
    type SubscriptionPlan implements Node {
        id: ID!
        shopId: ID!
        title: String!
        description: String
        periods: Int!
        periodPrice: Int!
        enabled: Boolean!
    }
    type Subscription implements Node {
        id: ID!
        code: String!
        planId: ID!
        shopId: ID!
        customerId: ID!
        scheduleJson: [String!]!
        startDate: DateTime
        endDate: DateTime
        prepaidBalance: Int!
        purchasedTotal: Int!
        status: String!
    }
    type SubscriptionOccurrence implements Node {
        id: ID!
        subscriptionId: ID!
        periodNo: Int!
        scheduledDate: DateTime!
        orderCode: String
        generatedOrderId: ID
        status: String!
        skipReason: String
    }
    input SubscriptionItemInput {
        variantId: ID!
        quantity: Int!
    }
    input CreateSubscriptionInput {
        startDate: DateTime!
    }
    input SubscriptionPlanInput {
        title: String!
        description: String
        frequency: String!
        periods: Int!
        periodPrice: Int!
    }
    type SubscriptionPlanList { items: [SubscriptionPlan!]! totalItems: Int! }
    type SubscriptionList { items: [Subscription!]! totalItems: Int! }
    type SubscriptionOccurrenceList { items: [SubscriptionOccurrence!]! totalItems: Int! }
    input SubscriptionListOptions { skip: Int take: Int }
    type SubscriptionProcessingResult { created: Int! skipped: Int! }
`;

/** 买家 SHOP API。 */
const customerSchema = () => gql`
    ${subscriptionTypeDefs}
    extend type Query {
        availablePlans(shopId: ID, options: SubscriptionListOptions): SubscriptionPlanList!
        mySubscriptions(options: SubscriptionListOptions): SubscriptionList!
        mySubscriptionOccurrences(subscriptionId: ID!, options: SubscriptionListOptions): SubscriptionOccurrenceList!
    }
    extend type Mutation {
        createSubscription(planId: ID!, input: CreateSubscriptionInput!): Subscription!
        confirmRenewal(id: ID!): Subscription!
    }
`;

/** 店主（manageOwnShop）+ 平台（UpdateSettings）两个 resolver 共用一套 ADMIN API schema。 */
const adminSchema = () => gql`
    ${subscriptionTypeDefs}
    extend type Query {
        myShopSubscriptionPlans(options: SubscriptionListOptions): SubscriptionPlanList!
        subscriptionPlans(options: SubscriptionListOptions): SubscriptionPlanList!
        subscriptions(options: SubscriptionListOptions): SubscriptionList!
        subscriptionOccurrences(options: SubscriptionListOptions): SubscriptionOccurrenceList!
    }
    extend type Mutation {
        createSubscriptionPlan(input: SubscriptionPlanInput!): SubscriptionPlan!
        setSubscriptionOccurrenceItems(id: ID!, items: [SubscriptionItemInput!]!): SubscriptionOccurrence!
        cancelSubscriptionOwner(id: ID!): Subscription!
        setSubscriptionPlanEnabled(id: ID!, enabled: Boolean!): SubscriptionPlan!
        processDueSubscriptions: SubscriptionProcessingResult!
    }
`;

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [SubscriptionPlan, Subscription, SubscriptionOccurrence],
    providers: [
        { provide: SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
        SubscriptionService,
        // 首次上线：随启动幂等补建表（IF NOT EXISTS），synchronize 关闭时同样可用
        SubscriptionTablesMigration,
    ],
    shopApiExtensions: {
        schema: customerSchema,
        resolvers: [SubscriptionCustomerResolver],
    },
    adminApiExtensions: {
        schema: adminSchema,
        resolvers: [SubscriptionOwnerResolver, SubscriptionAdminResolver],
    },
    compatibility: '^3.0.0',
})
export class SubscriptionPlugin implements OnApplicationBootstrap {
    private static options: SubscriptionPluginOptions = {};
    /** 每日调度定时器句柄，便于关闭。 */
    private dailyTimer?: NodeJS.Timeout;

    constructor(
        @Inject(SUBSCRIPTION_PLUGIN_OPTIONS) private options: SubscriptionPluginOptions,
        private jobQueueService: JobQueueService,
        private subscriptionService: SubscriptionService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    static init(options?: SubscriptionPluginOptions): typeof SubscriptionPlugin {
        SubscriptionPlugin.options = options ?? {};
        return SubscriptionPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        const queue = await this.jobQueueService.createQueue<{ channelToken?: string }>({
            name: SUBSCRIPTION_JOB_QUEUE,
            process: async (job) => {
                const ctx = await this.buildCtx(job.data?.channelToken);
                if (ctx) {
                    await this.subscriptionService.runDaily(ctx);
                }
            },
        });
        this.scheduleNextRun(
            queue.add.bind(queue),
            this.options.scheduleCron ?? '0 4 * * *',
            'default',
        );
    }

    /**
     * 每日调度：JobQueue 无内建 cron，故用「定时到下一次触发点 → 入队 → 重排」实现。
     * 解析 cron 的小时/分字段（形如 'M H * * *'），每天触发一次。
     */
    private scheduleNextRun(
        add: (data: { channelToken?: string }) => Promise<any>,
        cron: string,
        channelToken: string,
    ): void {
        const { hour, minute } = this.parseDailyCron(cron);
        const now = new Date();
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        const delay = next.getTime() - now.getTime();
        this.dailyTimer = setTimeout(() => {
            void add({ channelToken: channelToken || 'default' }).catch(err =>
                Logger.error(`Failed to enqueue ${SUBSCRIPTION_JOB_QUEUE}: ${String(err?.message ?? err)}`, loggerCtx),
            );
            this.scheduleNextRun(add, cron, channelToken);
        }, Math.max(delay, 1000));
    }

    private parseDailyCron(cron: string): { hour: number; minute: number } {
        const parts = String(cron).trim().split(/\s+/);
        const minute = Number(parts[0] ?? 0);
        const hour = Number(parts[1] ?? 4);
        return { hour, minute };
    }

    private async buildCtx(channelToken?: string): Promise<RequestContext | undefined> {
        try {
            const channel =
                channelToken && channelToken !== 'default'
                    ? await this.channelService.getChannelFromToken(channelToken)
                    : await this.channelService.getDefaultChannel();
            return new RequestContext({
                apiType: 'admin',
                channel,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
        } catch (e: any) {
            Logger.error(`Failed to build ctx for ${SUBSCRIPTION_JOB_QUEUE}: ${String(e?.message ?? e)}`, loggerCtx);
            return undefined;
        }
    }
}