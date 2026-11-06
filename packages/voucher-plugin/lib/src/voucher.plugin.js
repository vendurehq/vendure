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
var VoucherPlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoucherPlugin = void 0;
const core_1 = require("@vendure/core");
const operators_1 = require("rxjs/operators");
const service_voucher_entity_1 = require("./service-voucher.entity");
const voucher_booking_entity_1 = require("./voucher-booking.entity");
const voucher_options_1 = require("./voucher.options");
const voucher_service_1 = require("./voucher.service");
const voucher_admin_resolver_1 = require("./voucher.admin.resolver");
const voucher_shop_resolver_1 = require("./voucher.shop.resolver");
const migrate_voucher_tables_1 = require("./migrations/migrate-voucher-tables");
const { gql } = require('graphql-tag');
const loggerCtx = 'voucher-plugin';
/** 服务型商品标记：Product.serviceType 非空即视为到店服务券商品（下单免配送/免库存）。 */
const SERVICE_TYPE_CUSTOM_FIELD = {
    name: 'serviceType',
    type: 'string',
    nullable: true,
    public: true,
};
/**
 * 幂等并入自定义字段，按 name 去重（preBootstrapConfig 可能多次执行插件配置）。
 */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
/**
 * 共享类型。admin 与 shop 两个 API 各自对独立基底 schema 做扩展，无法互相引用对方声明的类型，
 * 因此所有 plugin 类型必须在两类 schema 中各自声明一遍（阶段27 铁律）。
 */
const voucherTypeDefs = `
    type ServiceVoucher {
        id: ID!
        orderId: ID!
        customerId: ID!
        shopId: ID!
        code: String!
        productVoucherName: String!
        status: String!
        effectiveDays: Int!
        expiresAt: DateTime
        usedAt: DateTime
        refundedAt: DateTime
    }
    type VoucherBooking {
        id: ID!
        voucherId: ID!
        slotAt: DateTime!
        customerCount: Int!
        status: String!
    }
`;
const adminSchema = gql `
    ${voucherTypeDefs}
    extend type Query {
        scanVoucher(code: String!): ServiceVoucher
        myVouchersAdmin: [ServiceVoucher!]!
        voucherBookings(voucherId: ID!): [VoucherBooking!]!
    }
    extend type Mutation {
        redeemVoucher(code: String!): ServiceVoucher!
        extendVoucher(voucherId: ID!, days: Int!): ServiceVoucher!
        exchangeVoucher(voucherId: ID!): ServiceVoucher!
        runExpireScan: Int!
        createBooking(voucherId: ID!, slotAt: DateTime!, customerCount: Int!): VoucherBooking!
    }
`;
const shopSchema = gql `
    ${voucherTypeDefs}
    extend type Query {
        myVouchers: [ServiceVoucher!]!
    }
`;
let VoucherPlugin = VoucherPlugin_1 = class VoucherPlugin {
    constructor(service, eventBus) {
        this.service = service;
        this.eventBus = eventBus;
    }
    static init(options) {
        VoucherPlugin_1.options = options !== null && options !== void 0 ? options : {};
        return VoucherPlugin_1;
    }
    onApplicationBootstrap() {
        // 订单支付成功 → 为服务型商品行生成到店券（幂等）。
        this.eventBus
            .ofType(core_1.OrderStateTransitionEvent)
            .pipe((0, operators_1.filter)(e => e.toState === 'PaymentSettled'))
            .subscribe(e => {
            var _a;
            const orderId = (_a = e.order) === null || _a === void 0 ? void 0 : _a.id;
            if (orderId == null)
                return;
            this.service.getOrCreateVouchersForOrder(e.ctx, e.order).catch(err => core_1.Logger.error(err === null || err === void 0 ? void 0 : err.message, loggerCtx));
        });
        // 退款结算成功 → 该单 usable 券联动置 refunded。
        this.eventBus
            .ofType(core_1.RefundStateTransitionEvent)
            .pipe((0, operators_1.filter)(e => e.toState === 'Settled'))
            .subscribe(e => {
            var _a;
            const orderId = (_a = e.order) === null || _a === void 0 ? void 0 : _a.id;
            if (orderId == null)
                return;
            this.service.markRefundedOnOrder(e.ctx, orderId).catch(err => core_1.Logger.error(err === null || err === void 0 ? void 0 : err.message, loggerCtx));
        });
    }
};
exports.VoucherPlugin = VoucherPlugin;
VoucherPlugin.options = {};
exports.VoucherPlugin = VoucherPlugin = VoucherPlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        providers: [
            { provide: voucher_options_1.VOUCHER_PLUGIN_OPTIONS, useFactory: () => VoucherPlugin.options },
            voucher_service_1.VoucherService,
            // 首次上线：随启动幂等补建表（IF NOT EXISTS），synchronize 关闭时同样可用
            migrate_voucher_tables_1.VoucherTablesMigration,
        ],
        entities: [service_voucher_entity_1.ServiceVoucher, voucher_booking_entity_1.VoucherBooking],
        adminApiExtensions: {
            schema: adminSchema,
            resolvers: [voucher_admin_resolver_1.VoucherAdminResolver],
        },
        shopApiExtensions: {
            schema: shopSchema,
            resolvers: [voucher_shop_resolver_1.VoucherShopResolver],
        },
        configuration: (config) => {
            config.customFields.Product = mergeCustomFields(config.customFields.Product, [
                SERVICE_TYPE_CUSTOM_FIELD,
            ]);
            return config;
        },
        compatibility: '^3.0.0',
    }),
    __metadata("design:paramtypes", [voucher_service_1.VoucherService, core_1.EventBus])
], VoucherPlugin);
//# sourceMappingURL=voucher.plugin.js.map