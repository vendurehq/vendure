"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SubscriptionPlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionPlugin = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const subscription_occurrence_entity_1 = require("./subscription-occurrence.entity");
const subscription_plan_entity_1 = require("./subscription-plan.entity");
const subscription_entity_1 = require("./subscription.entity");
const subscription_admin_resolver_1 = require("./subscription-admin.resolver");
const subscription_customer_resolver_1 = require("./subscription-customer.resolver");
const subscription_owner_resolver_1 = require("./subscription-owner.resolver");
const subscription_service_1 = require("./subscription.service");
const migrate_subscription_tables_1 = require("./migrations/migrate-subscription-tables");
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
const customerSchema = () => gql `
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
const adminSchema = () => gql `
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
let SubscriptionPlugin = SubscriptionPlugin_1 = class SubscriptionPlugin {
    constructor(options, jobQueueService, subscriptionService, connection, channelService) {
        this.options = options;
        this.jobQueueService = jobQueueService;
        this.subscriptionService = subscriptionService;
        this.connection = connection;
        this.channelService = channelService;
    }
    static init(options) {
        SubscriptionPlugin_1.options = options !== null && options !== void 0 ? options : {};
        return SubscriptionPlugin_1;
    }
    async onApplicationBootstrap() {
        var _a;
        const queue = await this.jobQueueService.createQueue({
            name: constants_1.SUBSCRIPTION_JOB_QUEUE,
            process: async (job) => {
                var _a;
                const ctx = await this.buildCtx((_a = job.data) === null || _a === void 0 ? void 0 : _a.channelToken);
                if (ctx) {
                    await this.subscriptionService.runDaily(ctx);
                }
            },
        });
        this.scheduleNextRun(queue.add.bind(queue), (_a = this.options.scheduleCron) !== null && _a !== void 0 ? _a : '0 4 * * *', 'default');
    }
    /**
     * 每日调度：JobQueue 无内建 cron，故用「定时到下一次触发点 → 入队 → 重排」实现。
     * 解析 cron 的小时/分字段（形如 'M H * * *'），每天触发一次。
     */
    scheduleNextRun(add, cron, channelToken) {
        const { hour, minute } = this.parseDailyCron(cron);
        const now = new Date();
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        const delay = next.getTime() - now.getTime();
        this.dailyTimer = setTimeout(() => {
            void add({ channelToken: channelToken || 'default' }).catch(err => { var _a; return core_1.Logger.error(`Failed to enqueue ${constants_1.SUBSCRIPTION_JOB_QUEUE}: ${String((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err)}`, constants_1.loggerCtx); });
            this.scheduleNextRun(add, cron, channelToken);
        }, Math.max(delay, 1000));
    }
    parseDailyCron(cron) {
        var _a, _b;
        const parts = String(cron).trim().split(/\s+/);
        const minute = Number((_a = parts[0]) !== null && _a !== void 0 ? _a : 0);
        const hour = Number((_b = parts[1]) !== null && _b !== void 0 ? _b : 4);
        return { hour, minute };
    }
    async buildCtx(channelToken) {
        var _a;
        try {
            const channel = channelToken && channelToken !== 'default'
                ? await this.channelService.getChannelFromToken(channelToken)
                : await this.channelService.getDefaultChannel();
            return new core_1.RequestContext({
                apiType: 'admin',
                channel,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
        }
        catch (e) {
            core_1.Logger.error(`Failed to build ctx for ${constants_1.SUBSCRIPTION_JOB_QUEUE}: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, constants_1.loggerCtx);
            return undefined;
        }
    }
};
exports.SubscriptionPlugin = SubscriptionPlugin;
SubscriptionPlugin.options = {};
exports.SubscriptionPlugin = SubscriptionPlugin = SubscriptionPlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        entities: [subscription_plan_entity_1.SubscriptionPlan, subscription_entity_1.Subscription, subscription_occurrence_entity_1.SubscriptionOccurrence],
        providers: [
            { provide: constants_1.SUBSCRIPTION_PLUGIN_OPTIONS, useFactory: () => SubscriptionPlugin.options },
            subscription_service_1.SubscriptionService,
            // 首次上线：随启动幂等补建表（IF NOT EXISTS），synchronize 关闭时同样可用
            migrate_subscription_tables_1.SubscriptionTablesMigration,
        ],
        shopApiExtensions: {
            schema: customerSchema,
            resolvers: [subscription_customer_resolver_1.SubscriptionCustomerResolver],
        },
        adminApiExtensions: {
            schema: adminSchema,
            resolvers: [subscription_owner_resolver_1.SubscriptionOwnerResolver, subscription_admin_resolver_1.SubscriptionAdminResolver],
        },
        compatibility: '^3.0.0',
    }),
    __param(0, (0, common_1.Inject)(constants_1.SUBSCRIPTION_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, core_1.JobQueueService,
        subscription_service_1.SubscriptionService,
        core_1.TransactionalConnection,
        core_1.ChannelService])
], SubscriptionPlugin);
//# sourceMappingURL=plugin.js.map