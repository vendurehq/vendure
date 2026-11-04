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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var GroupBuyPlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupBuyPlugin = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const constants_1 = require("./constants");
const group_buy_activity_entity_1 = require("./group-buy-activity.entity");
const group_buy_order_entity_1 = require("./group-buy-order.entity");
const group_buy_service_1 = require("./group-buy.service");
const group_buy_admin_resolver_1 = require("./group-buy-admin.resolver");
const group_buy_shop_resolver_1 = require("./group-buy-shop.resolver");
const group_buy_job_1 = require("./group-buy.job");
const order_custom_fields_1 = require("./order-custom-fields");
const group_buy_promotion_condition_1 = require("./group-buy-promotion-condition");
const group_buy_leader_promotion_1 = require("./group-buy-leader-promotion");
const group_buy_price_action_1 = require("./group-buy-price-action");
const group_buy_leader_reward_action_1 = require("./group-buy-leader-reward-action");
const group_buy_scheduled_task_1 = require("./group-buy-scheduled-task");
let GroupBuyPlugin = GroupBuyPlugin_1 = class GroupBuyPlugin {
    constructor(options, groupBuyService, groupBuyJob, eventBus, moduleRef) {
        this.options = options;
        this.groupBuyService = groupBuyService;
        this.groupBuyJob = groupBuyJob;
        this.eventBus = eventBus;
        this.moduleRef = moduleRef;
    }
    static init(options) {
        GroupBuyPlugin_1.options = options !== null && options !== void 0 ? options : {};
        return GroupBuyPlugin_1;
    }
    async onApplicationBootstrap() {
        this.injector = new core_2.Injector(this.moduleRef);
        this.groupBuyService.init(this.injector);
        this.groupBuyJob.initStock(this.injector);
        this.eventBus.ofType(core_2.OrderStateTransitionEvent).subscribe(async (event) => {
            var _a;
            if (event.toState !== 'Cancelled')
                return;
            const order = event.order;
            const activityId = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.groupBuyActivityId;
            if (!activityId)
                return;
            try {
                const { StockReserveService } = require('@vendure/redis-stock-plugin');
                const stockReserveService = this.injector.get(StockReserveService);
                if (stockReserveService === null || stockReserveService === void 0 ? void 0 : stockReserveService.isAvailable) {
                    await stockReserveService.releaseStock(`group-buy:${activityId}`, 1);
                }
            }
            catch (_b) {
                // RedisStockPlugin not installed
            }
        });
        core_2.Logger.info('GroupBuyPlugin initialized', constants_1.loggerCtx);
    }
};
exports.GroupBuyPlugin = GroupBuyPlugin;
GroupBuyPlugin.options = {};
exports.GroupBuyPlugin = GroupBuyPlugin = GroupBuyPlugin_1 = __decorate([
    (0, core_2.VendurePlugin)({
        imports: [core_2.PluginCommonModule],
        entities: [group_buy_activity_entity_1.GroupBuyActivity, group_buy_order_entity_1.GroupBuyOrder],
        providers: [
            { provide: constants_1.GROUP_BUY_PLUGIN_OPTIONS, useFactory: () => GroupBuyPlugin.options },
            group_buy_service_1.GroupBuyService,
            group_buy_job_1.GroupBuyJob,
        ],
        exports: [group_buy_service_1.GroupBuyService],
        adminApiExtensions: {
            schema: () => (0, graphql_tag_1.default) `
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
            resolvers: [group_buy_admin_resolver_1.GroupBuyAdminResolver],
        },
        shopApiExtensions: {
            schema: () => (0, graphql_tag_1.default) `
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
            resolvers: [group_buy_shop_resolver_1.GroupBuyShopResolver],
        },
        configuration: (config) => {
            var _a, _b, _c, _d, _e;
            config.customFields = Object.assign(Object.assign({}, config.customFields), { Order: [
                    ...((_b = (_a = config.customFields) === null || _a === void 0 ? void 0 : _a.Order) !== null && _b !== void 0 ? _b : []),
                    ...order_custom_fields_1.groupBuyOrderCustomFields.Order,
                ] });
            config.promotionOptions = config.promotionOptions || {};
            config.promotionOptions.promotionConditions = [
                ...((_c = config.promotionOptions.promotionConditions) !== null && _c !== void 0 ? _c : []),
                group_buy_promotion_condition_1.groupBuyDiscountCondition,
                group_buy_leader_promotion_1.groupBuyLeaderRewardCondition,
            ];
            config.promotionOptions.promotionActions = [
                ...((_d = config.promotionOptions.promotionActions) !== null && _d !== void 0 ? _d : []),
                group_buy_price_action_1.groupBuyPriceAction,
                group_buy_leader_reward_action_1.groupBuyLeaderRewardAction,
            ];
            config.schedulerOptions = config.schedulerOptions || {};
            config.schedulerOptions.tasks = [...((_e = config.schedulerOptions.tasks) !== null && _e !== void 0 ? _e : []), group_buy_scheduled_task_1.groupBuyCheckTask];
            return config;
        },
        dashboard: '../dashboard/index.tsx',
        compatibility: '^3.0.0',
    }),
    __param(0, (0, common_1.Inject)(constants_1.GROUP_BUY_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, group_buy_service_1.GroupBuyService,
        group_buy_job_1.GroupBuyJob,
        core_2.EventBus,
        core_1.ModuleRef])
], GroupBuyPlugin);
//# sourceMappingURL=plugin.js.map