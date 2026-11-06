import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import { posSessionPermission, posTerminalPermission } from './constants';
import { orderCustomFields } from './custom-fields/order-custom-fields';
import { orderLineCustomFields } from './custom-fields/order-line-custom-fields';
import { paymentCustomFields } from './custom-fields/payment-custom-fields';
import { MemberPriceRule } from './entities/member-price-rule.entity';
import { PosSession } from './entities/pos-session.entity';
import { PosTerminal } from './entities/pos-terminal.entity';
import { PromotionRule } from './entities/promotion-rule.entity';
import { AdminMemberResolver } from './resolvers/admin-member.resolver';
import { AdminPosResolver } from './resolvers/admin-pos.resolver';
import { AdminPromotionResolver } from './resolvers/admin-promotion.resolver';
import { AdminRefundResolver } from './resolvers/admin-refund.resolver';
import { AdminReportResolver } from './resolvers/admin-report.resolver';
import { AdminTerminalResolver } from './resolvers/admin-terminal.resolver';
import { ShopMemberPriceResolver } from './resolvers/shop-member-price.resolver';
import { AggregatePayService } from './services/aggregate-pay.service';
import { MemberPriceCalculator } from './services/member-price-calculator';
import { MemberPriceRuleService } from './services/member-price-rule.service';
import { PosOrderService } from './services/pos-order.service';
import { PosSessionService } from './services/pos-session.service';
import { PosTerminalService } from './services/pos-terminal.service';
import { PromotionEngineService } from './services/promotion-engine.service';
import { PromotionRuleService } from './services/promotion-rule.service';
import { RefundService } from './services/refund.service';
import { ReportService } from './services/report.service';
import { ShiftReportService } from './services/shift-report.service';

const adminSchema = gql`
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
const shopSchema = gql`
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

@VendurePlugin({
  imports: [
    PluginCommonModule,
    TypeOrmModule.forFeature([PosTerminal, PosSession, MemberPriceRule, PromotionRule]),
  ],
  entities: [PosTerminal, PosSession, MemberPriceRule, PromotionRule],
  providers: [
    PosTerminalService,
    PosSessionService,
    PosOrderService,
    ShiftReportService,
    AggregatePayService,
    RefundService,
    MemberPriceRuleService,
    MemberPriceCalculator,
    PromotionRuleService,
    PromotionEngineService,
    ReportService,
  ],
  exports: [
    PosOrderService,
    PosSessionService,
    MemberPriceRuleService,
    MemberPriceCalculator,
    PromotionRuleService,
    PromotionEngineService,
    ReportService,
  ],
  adminApiExtensions: {
    resolvers: [
      AdminTerminalResolver,
      AdminPosResolver,
      AdminRefundResolver,
      AdminMemberResolver,
      AdminPromotionResolver,
      AdminReportResolver,
    ],
    schema: adminSchema,
  },
  shopApiExtensions: {
    resolvers: [ShopMemberPriceResolver],
    schema: shopSchema,
  },
  configuration: (config) => {
    // 注册 PosTerminal + PosSession CRUD 自定义权限定义（superadmin 自动放行，其他角色需显式授予）
    config.authOptions.customPermissions = [
      ...(config.authOptions.customPermissions ?? []),
      posTerminalPermission,
      posSessionPermission,
    ];
    // 注册 Order/OrderLine/Payment custom fields
    config.customFields = {
      ...config.customFields,
      Order: [...(config.customFields?.Order ?? []), ...orderCustomFields],
      OrderLine: [
        ...(config.customFields?.OrderLine ?? []),
        ...orderLineCustomFields,
      ],
      Payment: [...(config.customFields?.Payment ?? []), ...paymentCustomFields],
    };
    return config;
  },
})
export class VcashPosPlugin {}
