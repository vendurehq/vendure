"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var OnebridgePlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnebridgePlugin = void 0;
const core_1 = require("@vendure/core");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const api_1 = require("./api");
const custom_fields_1 = require("./custom-fields");
const entities_1 = require("./entities");
const migrations_1 = require("./migrations");
const payments_1 = require("./payments");
const permissions_1 = require("./permissions");
const services_1 = require("./services");
const order_lifecycle_subscriber_1 = require("./subscribers/order-lifecycle.subscriber");
function mergePermissions(existing, additions) {
    const names = new Set((existing !== null && existing !== void 0 ? existing : []).map(p => p.getMetadata()[0].name));
    return [
        ...(existing !== null && existing !== void 0 ? existing : []),
        ...additions.filter(p => !names.has(p.getMetadata()[0].name)),
    ];
}
/**
 * ONE BRIDGE 跨境插件（计划书 §7.1）。
 * M1：实体 + 幂等建表迁移 + customFields + 权限 + 领域纯函数。
 * M2：Shop/Admin resolver、内容/验货/清关、订单聚合、Dashboard、种子、e2e。
 */
let OnebridgePlugin = OnebridgePlugin_1 = class OnebridgePlugin {
    static init(options) {
        OnebridgePlugin_1.pluginOptions = options !== null && options !== void 0 ? options : {};
        (0, services_1.setOnebridgeChannelToken)(OnebridgePlugin_1.pluginOptions.channelToken);
        return OnebridgePlugin_1;
    }
    static get options() {
        return OnebridgePlugin_1.pluginOptions;
    }
};
exports.OnebridgePlugin = OnebridgePlugin;
OnebridgePlugin.pluginOptions = {};
exports.OnebridgePlugin = OnebridgePlugin = OnebridgePlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        entities: [entities_1.Rfq, entities_1.RfqQuote, entities_1.RfqSample, entities_1.StageEvent, entities_1.InspectionReport, entities_1.CustomsRecord, entities_1.ExchangeRate, entities_1.ContentEntry],
        providers: [
            migrations_1.CreateOnebridgeTablesMigration,
            services_1.OnebridgeRfqService,
            services_1.OnebridgeContentService,
            services_1.OnebridgeInspectionService,
            services_1.OnebridgeCustomsService,
            services_1.OnebridgeOrderSummaryService,
            services_1.OnebridgeSpecSheetService,
            payments_1.OnebridgePaymentCallbackService,
            order_lifecycle_subscriber_1.OnebridgeOrderLifecycleSubscriber,
        ],
        controllers: [payments_1.OnebridgePaymentController],
        shopApiExtensions: {
            schema: () => (0, graphql_tag_1.default)(api_1.onebridgeShopTypeDefs),
            resolvers: [
                api_1.OnebridgeShopResolver,
                api_1.RfqFieldResolver,
                api_1.StageEventFieldResolver,
                api_1.OnebridgeContentFieldResolver,
                api_1.ServiceChannelFieldResolver,
                api_1.CustomsRecordFieldResolver,
            ],
        },
        adminApiExtensions: {
            schema: () => (0, graphql_tag_1.default)(api_1.onebridgeAdminTypeDefs),
            resolvers: [api_1.OnebridgeAdminResolver, api_1.RfqFieldResolver, api_1.StageEventFieldResolver, api_1.CustomsRecordFieldResolver],
        },
        configuration: config => {
            var _a, _b, _c;
            config.customFields = (0, custom_fields_1.applyOnebridgeCustomFields)(config.customFields);
            config.authOptions = (_a = config.authOptions) !== null && _a !== void 0 ? _a : {};
            config.authOptions.customPermissions = mergePermissions(config.authOptions.customPermissions, permissions_1.onebridgePermissionDefinitions);
            // 韩国 PG 桩（CT-05）：按 code 幂等注册，避免重复 init 时出现两个同 code handler
            config.paymentOptions = (_b = config.paymentOptions) !== null && _b !== void 0 ? _b : { paymentMethodHandlers: [] };
            const handlers = (_c = config.paymentOptions.paymentMethodHandlers) !== null && _c !== void 0 ? _c : [];
            if (!handlers.some(h => h.code === payments_1.koreaPgPaymentHandler.code)) {
                handlers.push(payments_1.koreaPgPaymentHandler);
            }
            config.paymentOptions.paymentMethodHandlers = handlers;
            return config;
        },
        dashboard: '../dashboard/index.tsx',
        compatibility: '^3.0.0',
    })
], OnebridgePlugin);
//# sourceMappingURL=plugin.js.map