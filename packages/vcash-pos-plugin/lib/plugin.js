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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VcashPosPlugin = void 0;
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const constants_1 = require("./constants");
const order_custom_fields_1 = require("./custom-fields/order-custom-fields");
const order_line_custom_fields_1 = require("./custom-fields/order-line-custom-fields");
const payment_custom_fields_1 = require("./custom-fields/payment-custom-fields");
const member_price_rule_entity_1 = require("./entities/member-price-rule.entity");
const pos_session_entity_1 = require("./entities/pos-session.entity");
const pos_terminal_entity_1 = require("./entities/pos-terminal.entity");
const promotion_rule_entity_1 = require("./entities/promotion-rule.entity");
const admin_member_resolver_1 = require("./resolvers/admin-member.resolver");
const admin_pos_resolver_1 = require("./resolvers/admin-pos.resolver");
const admin_promotion_resolver_1 = require("./resolvers/admin-promotion.resolver");
const admin_refund_resolver_1 = require("./resolvers/admin-refund.resolver");
const admin_report_resolver_1 = require("./resolvers/admin-report.resolver");
const admin_terminal_resolver_1 = require("./resolvers/admin-terminal.resolver");
const shop_member_price_resolver_1 = require("./resolvers/shop-member-price.resolver");
const aggregate_pay_service_1 = require("./services/aggregate-pay.service");
const member_price_calculator_1 = require("./services/member-price-calculator");
const member_price_rule_service_1 = require("./services/member-price-rule.service");
const pos_order_service_1 = require("./services/pos-order.service");
const pos_session_service_1 = require("./services/pos-session.service");
const pos_terminal_service_1 = require("./services/pos-terminal.service");
const promotion_engine_service_1 = require("./services/promotion-engine.service");
const promotion_rule_service_1 = require("./services/promotion-rule.service");
const refund_service_1 = require("./services/refund.service");
const report_service_1 = require("./services/report.service");
const shift_report_service_1 = require("./services/shift-report.service");
const adminSchema = (0, graphql_tag_1.default) `
  type PosTerminal {
    id: ID!
    code: String!
    name: String!
    channel: Channel!
    stockLocation: StockLocation!
    active: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    deviceConfig: JSON
  }

  input CreatePosTerminalInput {
    code: String!
    name: String!
    stockLocationId: ID!
    deviceConfig: JSON
  }

  input UpdatePosTerminalInput {
    id: ID!
    name: String
    stockLocationId: ID
    active: Boolean
    deviceConfig: JSON
  }

  extend type Query {
    posTerminals(channelId: ID): [PosTerminal!]!
    posTerminal(id: ID!): PosTerminal
  }

  extend type Mutation {
    createPosTerminal(input: CreatePosTerminalInput!): PosTerminal!
    updatePosTerminal(input: UpdatePosTerminalInput!): PosTerminal!
    deletePosTerminal(id: ID!): Boolean!
  }

  type PosSession {
    id: ID!
    code: String!
    terminal: PosTerminal!
    stockLocation: StockLocation!
    operator: Administrator!
    approver: Administrator
    state: String!
    openedAt: DateTime!
    closedAt: DateTime
    closeSummary: JSON
    openingFloat: Int!
    closingCash: Int!
    activeOrderId: Int
    customerId: Int
    customer: Customer
    updatedAt: DateTime!
  }

  input OpenSessionInput {
    terminalCode: String!
    openingFloat: Int
  }

  input CloseSessionInput {
    sessionId: ID!
    closingCash: Int
    approverId: ID
  }

  type CloseSessionResult {
    session: PosSession!
    summary: JSON
  }

  extend type Query {
    myPosSession: PosSession
    posSession(id: ID!): PosSession
  }

  extend type Mutation {
    openSession(input: OpenSessionInput!): PosSession!
    closeSession(input: CloseSessionInput!): CloseSessionResult!
  }

  # ===== 会员识别 + 会员价规则 =====

  type PosMemberInfo {
    customerId: ID!
    firstName: String
    lastName: String
    emailAddress: String
    phoneNumber: String
    memberLevel: Int!
    growthValue: Int!
    points: Int!
  }

  type MemberPriceRule {
    id: ID!
    channelId: ID!
    scope: String!
    categoryId: Int
    memberLevel: Int!
    discountPercent: Int!
    active: Boolean!
    priority: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreateMemberPriceRuleInput {
    scope: String!
    categoryId: Int
    memberLevel: Int!
    discountPercent: Int!
    active: Boolean
    priority: Int
  }

  input UpdateMemberPriceRuleInput {
    id: ID!
    scope: String
    categoryId: Int
    memberLevel: Int
    discountPercent: Int
    active: Boolean
    priority: Int
  }

  extend type Query {
    findMemberByPhone(phoneNumber: String!): PosMemberInfo
    findMemberByCode(code: String!): PosMemberInfo
    memberPriceRules(channelId: ID): [MemberPriceRule!]!
    memberPriceRule(id: ID!): MemberPriceRule
  }

  extend type Mutation {
    bindSessionMember(customerId: ID!): PosSession!
    unbindSessionMember: PosSession!
    createMemberPriceRule(input: CreateMemberPriceRuleInput!): MemberPriceRule!
    updateMemberPriceRule(input: UpdateMemberPriceRuleInput!): MemberPriceRule!
    deleteMemberPriceRule(id: ID!): Boolean!
  }

  input AddPosItemInput {
    productVariantId: ID!
    quantity: Int!
    discount: Int
    isGift: Boolean
    note: String
    originalPrice: Int
  }

  input UpdatePosItemInput {
    orderLineId: ID!
    quantity: Int!
  }

  input CheckoutPaymentInput {
    method: String!
    transactionId: String
    metadata: JSON
  }

  input CheckoutInput {
    payments: [CheckoutPaymentInput!]!
  }

  type PosCheckoutResult {
    order: Order!
    payments: [Payment!]!
  }

  extend type Query {
    posActiveOrder: Order
    shiftReportPreview(sessionId: ID!, closingCash: Int): JSON!
    aggregatePayByCode(aggregatePayCode: String!): Payment
    posRefunds(sessionId: ID!): [Refund!]!
    heldOrders: [Order!]!
    posOrderByCode(code: String!): Order
  }

  extend type Mutation {
    addPosItem(input: AddPosItemInput!): Order!
    updatePosItem(input: UpdatePosItemInput!): Order!
    checkoutPosOrder(input: CheckoutInput!): PosCheckoutResult!
    createAggregatePay(input: CreateAggregatePayInput!): Payment!
    confirmAggregatePay(paymentId: ID!): Payment!
    settleAggregatePay(paymentId: ID!): Payment!
    failAggregatePay(paymentId: ID!): Payment!
    settleSessionAggregatePays(sessionId: ID!): SettleSessionAggregatePaysResult!
    createPosRefund(input: CreatePosRefundInput!): Refund!
    settleManualRefund(input: SettleManualRefundInput!): Refund!
    holdOrder: Order!
    resumeOrder(orderId: ID!): Order!
    createRefundOrder(input: CreateRefundOrderInput!): CreateRefundOrderResult!
  }

  input CreateAggregatePayInput {
    aggregatePayCode: String!
  }

  # 批量结算结果：失败逐笔返回原因，避免关班时静默漏结
  type AggregatePayFailure {
    paymentId: ID!
    reason: String!
  }

  type SettleSessionAggregatePaysResult {
    settled: Int!
    failed: [AggregatePayFailure!]!
  }

  input CreatePosRefundInput {
    originalOrderId: ID!
    paymentId: ID!
    amount: Int!
    reason: String
  }

  input SettleManualRefundInput {
    refundId: ID!
    transactionId: String!
  }

  # 退货单（独立 refund Order，spec 3.10）
  input RefundLineInput {
    orderLineId: ID!
    quantity: Int!
    reason: String
  }

  input CreateRefundOrderInput {
    originalOrderId: ID!
    refundLines: [RefundLineInput!]!
  }

  type CreateRefundOrderResult {
    refundOrder: Order!
    originalOrder: Order!
  }

  # 扩展核心类型：暴露 Payment.order 和 Refund.payment 便于 POS 场景查询
  extend type Payment {
    order: Order!
  }

  # ===== 促销规则（Phase 6.2） =====

  type PromotionRule {
    id: ID!
    channelId: ID!
    type: String!
    name: String!
    description: String
    scope: String!
    collectionId: Int
    priority: Int!
    active: Boolean!
    startTime: DateTime
    endTime: DateTime
    conditions: JSON
    actions: JSON
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreatePromotionRuleInput {
    type: String!
    name: String!
    description: String
    scope: String
    collectionId: Int
    priority: Int
    active: Boolean
    startTime: DateTime
    endTime: DateTime
    conditions: JSON
    actions: JSON
  }

  input UpdatePromotionRuleInput {
    id: ID!
    type: String
    name: String
    description: String
    scope: String
    collectionId: Int
    priority: Int
    active: Boolean
    startTime: DateTime
    endTime: DateTime
    conditions: JSON
    actions: JSON
  }

  extend type Query {
    promotionRules(channelId: ID): [PromotionRule!]!
    promotionRule(id: ID!): PromotionRule
  }

  extend type Mutation {
    createPromotionRule(input: CreatePromotionRuleInput!): PromotionRule!
    updatePromotionRule(input: UpdatePromotionRuleInput!): PromotionRule!
    deletePromotionRule(id: ID!): Boolean!
    reapplyPromotion(orderId: ID!): Order!
  }

  extend type Refund {
    payment: Payment!
  }

  # ===== 报表系统（Phase 8） =====

  type PaymentMethodSummary {
    method: String!
    count: Int!
    amount: Int!
  }

  type TodayOverview {
    date: String!
    totalAmount: Int!
    orderCount: Int!
    avgOrderValue: Int!
    refundAmount: Int!
    refundCount: Int!
    paymentsByMethod: [PaymentMethodSummary!]!
  }

  type DailySales {
    date: String!
    totalAmount: Int!
    orderCount: Int!
    avgOrderValue: Int!
  }

  type SalesReport {
    startDate: String!
    endDate: String!
    totalAmount: Int!
    totalOrders: Int!
    avgOrderValue: Int!
    daily: [DailySales!]!
  }

  type MonthlyReportPrev {
    totalAmount: Int!
    orderCount: Int!
  }

  type MonthlyReport {
    year: Int!
    month: Int!
    totalAmount: Int!
    orderCount: Int!
    avgOrderValue: Int!
    prevMonth: MonthlyReportPrev!
    amountChangeRate: Float!
    countChangeRate: Float!
  }

  type TopProductItem {
    variantId: ID!
    variantName: String!
    productName: String!
    sku: String!
    totalQuantity: Int!
    totalAmount: Int!
  }

  type TopProductReport {
    startDate: String!
    endDate: String!
    items: [TopProductItem!]!
  }

  extend type Query {
    todayOverview: TodayOverview!
    posSalesReport(startDate: String!, endDate: String!): SalesReport!
    monthlyReport(year: Int!, month: Int!): MonthlyReport!
    topProducts(
      startDate: String!
      endDate: String!
      limit: Int
      sortBy: String
    ): TopProductReport!
  }
`;
// Shop API 与 admin API 两套 SDL 独立（参照 cjk-plugin 模式），仅暴露 C 端所需最小字段
const shopSchema = (0, graphql_tag_1.default) `
  # ===== C 端会员价展示（只读，不参与下单计价） =====
  type ProductMemberPrice {
    productId: ID!
    applied: Boolean!
    discountPercent: Int
  }

  extend type Query {
    myMemberPrice(productIds: [ID!]!): [ProductMemberPrice!]!
  }
`;
let VcashPosPlugin = class VcashPosPlugin {
};
exports.VcashPosPlugin = VcashPosPlugin;
exports.VcashPosPlugin = VcashPosPlugin = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [
            core_1.PluginCommonModule,
            typeorm_1.TypeOrmModule.forFeature([pos_terminal_entity_1.PosTerminal, pos_session_entity_1.PosSession, member_price_rule_entity_1.MemberPriceRule, promotion_rule_entity_1.PromotionRule]),
        ],
        entities: [pos_terminal_entity_1.PosTerminal, pos_session_entity_1.PosSession, member_price_rule_entity_1.MemberPriceRule, promotion_rule_entity_1.PromotionRule],
        providers: [
            pos_terminal_service_1.PosTerminalService,
            pos_session_service_1.PosSessionService,
            pos_order_service_1.PosOrderService,
            shift_report_service_1.ShiftReportService,
            aggregate_pay_service_1.AggregatePayService,
            refund_service_1.RefundService,
            member_price_rule_service_1.MemberPriceRuleService,
            member_price_calculator_1.MemberPriceCalculator,
            promotion_rule_service_1.PromotionRuleService,
            promotion_engine_service_1.PromotionEngineService,
            report_service_1.ReportService,
        ],
        exports: [
            pos_order_service_1.PosOrderService,
            pos_session_service_1.PosSessionService,
            member_price_rule_service_1.MemberPriceRuleService,
            member_price_calculator_1.MemberPriceCalculator,
            promotion_rule_service_1.PromotionRuleService,
            promotion_engine_service_1.PromotionEngineService,
            report_service_1.ReportService,
        ],
        adminApiExtensions: {
            resolvers: [
                admin_terminal_resolver_1.AdminTerminalResolver,
                admin_pos_resolver_1.AdminPosResolver,
                admin_refund_resolver_1.AdminRefundResolver,
                admin_member_resolver_1.AdminMemberResolver,
                admin_promotion_resolver_1.AdminPromotionResolver,
                admin_report_resolver_1.AdminReportResolver,
            ],
            schema: adminSchema,
        },
        shopApiExtensions: {
            resolvers: [shop_member_price_resolver_1.ShopMemberPriceResolver],
            schema: shopSchema,
        },
        configuration: (config) => {
            var _a, _b, _c, _d, _e, _f, _g;
            // 注册 PosTerminal + PosSession CRUD 自定义权限定义（superadmin 自动放行，其他角色需显式授予）
            config.authOptions.customPermissions = [
                ...((_a = config.authOptions.customPermissions) !== null && _a !== void 0 ? _a : []),
                constants_1.posTerminalPermission,
                constants_1.posSessionPermission,
            ];
            // 注册 Order/OrderLine/Payment custom fields
            config.customFields = Object.assign(Object.assign({}, config.customFields), { Order: [...((_c = (_b = config.customFields) === null || _b === void 0 ? void 0 : _b.Order) !== null && _c !== void 0 ? _c : []), ...order_custom_fields_1.orderCustomFields], OrderLine: [
                    ...((_e = (_d = config.customFields) === null || _d === void 0 ? void 0 : _d.OrderLine) !== null && _e !== void 0 ? _e : []),
                    ...order_line_custom_fields_1.orderLineCustomFields,
                ], Payment: [...((_g = (_f = config.customFields) === null || _f === void 0 ? void 0 : _f.Payment) !== null && _g !== void 0 ? _g : []), ...payment_custom_fields_1.paymentCustomFields] });
            return config;
        },
    })
], VcashPosPlugin);
//# sourceMappingURL=plugin.js.map