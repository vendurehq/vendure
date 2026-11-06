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
var FlashSalePlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlashSalePlugin = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const constants_1 = require("./constants");
const flash_sale_activity_entity_1 = require("./flash-sale-activity.entity");
const flash_sale_admin_resolver_1 = require("./flash-sale-admin.resolver");
const flash_sale_job_1 = require("./flash-sale.job");
const flash_sale_promotion_condition_1 = require("./flash-sale-promotion-condition");
const flash_sale_price_action_1 = require("./flash-sale-price-action");
const flash_sale_service_1 = require("./flash-sale.service");
const flash_sale_shop_resolver_1 = require("./flash-sale-shop.resolver");
const order_custom_fields_1 = require("./order-custom-fields");
/** Idempotently merge custom fields, deduplicating by field name (preBootstrapConfig may run plugin configurations multiple times). */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
let FlashSalePlugin = FlashSalePlugin_1 = class FlashSalePlugin {
    constructor(options, flashSaleService, eventBus, moduleRef) {
        this.options = options;
        this.flashSaleService = flashSaleService;
        this.eventBus = eventBus;
        this.moduleRef = moduleRef;
    }
    static init(options) {
        FlashSalePlugin_1.options = options !== null && options !== void 0 ? options : {};
        return FlashSalePlugin_1;
    }
    async onApplicationBootstrap() {
        this.injector = new core_2.Injector(this.moduleRef);
        this.flashSaleService.init(this.injector);
        // 订单取消时按订单内秒杀行实际件数回滚预占库存（修正固定 1 件）
        this.eventBus.ofType(core_2.OrderStateTransitionEvent).subscribe(async (event) => {
            var _a, _b;
            if (event.toState !== 'Cancelled')
                return;
            const activityId = (_b = (_a = event.order) === null || _a === void 0 ? void 0 : _a.customFields) === null || _b === void 0 ? void 0 : _b.flashSaleActivityId;
            if (!activityId)
                return;
            try {
                await this.flashSaleService.releaseStockForOrder(event.ctx, event.order.id);
            }
            catch (e) {
                core_2.Logger.error(`Failed to release stock for activity ${activityId} on cancel: ${e.message}`, constants_1.loggerCtx);
            }
        });
        core_2.Logger.info('FlashSalePlugin initialized', constants_1.loggerCtx);
    }
};
exports.FlashSalePlugin = FlashSalePlugin;
FlashSalePlugin.options = {};
exports.FlashSalePlugin = FlashSalePlugin = FlashSalePlugin_1 = __decorate([
    (0, core_2.VendurePlugin)({
        imports: [core_2.PluginCommonModule],
        entities: [flash_sale_activity_entity_1.FlashSaleActivity],
        providers: [
            { provide: constants_1.FLASH_SALE_PLUGIN_OPTIONS, useFactory: () => FlashSalePlugin.options },
            flash_sale_service_1.FlashSaleService,
        ],
        exports: [flash_sale_service_1.FlashSaleService],
        adminApiExtensions: {
            schema: () => (0, graphql_tag_1.default) `
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
            resolvers: [flash_sale_admin_resolver_1.FlashSaleAdminResolver],
        },
        shopApiExtensions: {
            schema: () => (0, graphql_tag_1.default) `
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
            resolvers: [flash_sale_shop_resolver_1.FlashSaleShopResolver],
        },
        configuration: (config) => {
            var _a, _b;
            config.customFields.Order = mergeCustomFields(config.customFields.Order, order_custom_fields_1.flashSaleOrderCustomFields.Order);
            config.promotionOptions = config.promotionOptions || {};
            config.promotionOptions.promotionConditions = [
                ...((_a = config.promotionOptions.promotionConditions) !== null && _a !== void 0 ? _a : []),
                flash_sale_promotion_condition_1.flashSaleDiscountCondition,
            ];
            config.promotionOptions.promotionActions = [
                ...((_b = config.promotionOptions.promotionActions) !== null && _b !== void 0 ? _b : []),
                flash_sale_price_action_1.flashSalePriceAction,
            ];
            // 注册秒杀状态转换 ScheduledTask（由 DefaultSchedulerPlugin 在 worker 上周期执行）
            if (!config.schedulerOptions) {
                config.schedulerOptions = { tasks: [] };
            }
            if (!config.schedulerOptions.tasks) {
                config.schedulerOptions.tasks = [];
            }
            config.schedulerOptions.tasks.push(flash_sale_job_1.flashSaleStatusTask);
            return config;
        },
        dashboard: '../dashboard/index.tsx',
        compatibility: '^3.0.0',
    }),
    __param(0, (0, common_1.Inject)(constants_1.FLASH_SALE_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, flash_sale_service_1.FlashSaleService,
        core_2.EventBus,
        core_1.ModuleRef])
], FlashSalePlugin);
//# sourceMappingURL=plugin.js.map