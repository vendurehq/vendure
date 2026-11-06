import { Inject, OnApplicationBootstrap, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    EventBus,
    Injector,
    Logger,
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    RefundStateTransitionEvent,
    PluginCommonModule,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

import { COUPON_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { CouponExpireReminderService } from './coupon-expire-reminder.service';
import { CouponAdminResolver } from './coupon-admin.resolver';
import { CouponBindingAdminResolver } from './coupon-binding-admin.resolver';
import { CouponBindingService } from './coupon-binding.service';
import { CouponBundleResolver } from './coupon-bundle.resolver';
import { setCouponBalancePort } from './coupon-balance-port';
import { CouponFissionService } from './coupon-fission.service';
import { CouponFissionShopResolver } from './coupon-fission-shop.resolver';
import { CouponFissionRecord } from './coupon-fission-record.entity';
import { CouponDailyClaimRecord } from './coupon-daily-claim-record.entity';
import { CouponFrFService } from './coupon-frf.service';
import { CouponFrFShopResolver } from './coupon-frf-shop.resolver';
import { CouponGrantBatch } from './coupon-grant-batch.entity';
import { CouponSaleAdminResolver } from './coupon-sale-admin.resolver';
import { CouponSaleShopResolver } from './coupon-sale-shop.resolver';
import { CouponSaleService, setCouponSaleGateway } from './coupon-sale.service';
import { CouponStoreAdminResolver } from './coupon-store-admin.resolver';
import { CouponStoreShopResolver } from './coupon-store-shop.resolver';
import { CouponStoreService } from './coupon-store.service';
import { CouponStoreBinding } from './coupon-store-binding.entity';
import { CouponRedemption } from './coupon-redemption.entity';
import { CouponSettlementAdminResolver } from './coupon-settlement-admin.resolver';
import { CouponSettlementService } from './coupon-settlement.service';
import { CouponSettlementReconcileService } from './coupon-settlement-reconcile.service';
import { CustomerCouponResolver } from './coupon-customer-coupon.resolver';
import { CouponTemplateResolver } from './coupon-template.resolver';
import { couponDiscountAction } from './coupon-promotion-action';
import { couponAppliedCondition } from './coupon-promotion-condition';
import { setCouponConnection } from './coupon-runtime';
import { setBindingService } from './coupon-settlement';
import { CouponService } from './coupon.service';
import { CouponShopResolver } from './coupon-shop.resolver';
import { CouponTemplate } from './coupon-template.entity';
import { CouponBundle, CouponBundleItem } from './coupon-bundle.entity';
import { CouponSaleOrder } from './coupon-sale-order.entity';
import { CouponSettlementOrder } from './coupon-settlement-order.entity';
import { CouponSettlementReconcileDiff } from './coupon-settlement-reconcile-diff.entity';
import { CustomerCoupon } from './customer-coupon.entity';
import {
    AddCouponFieldsMigration,
    AddCouponIndexes20260919,
    AddCouponMarketingFieldsMigration,
    AddCouponUsageSceneMigration,
    CreateCouponSaleMigration,
    CreateInStoreBillMigration,
    CreateProductCouponBindingMigration,
    AddCouponPromoFieldsMigration,
    AddCouponCategoryFieldMigration,
    AddCouponActivityImageMigration,
    CreateCouponSettlementMigration,
    AddInStoreBillShopFieldsMigration,
    CreateCouponFissionMigration,
    CreateCouponReconcileMigration,
    CreateCouponFrFMigration,
    CreateCouponStoreMigration,
    AddCouponCostBearerMigration,
} from './migrations';
import { AddCouponDistributionChannelsMigration } from './migrations/add-coupon-distribution-channels';
import { InStoreBill } from './in-store-bill.entity';
import { InStoreBillAdminResolver } from './in-store-bill-admin.resolver';
import { InStoreBillService } from './in-store-bill.service';
import { couponOrderCustomFields } from './order-custom-fields';
import { couponPromoCustomFields } from './promo-custom-fields';
import { StudentVerificationService } from './student.service';
import { StudentAdminResolver, StudentShopResolver } from './student.resolvers';
import { ProductCouponBinding } from './product-coupon-binding.entity';
import { CouponPluginOptions } from './types';

/** Idempotently merge custom fields, deduplicating by field name (preBootstrapConfig may run plugin configurations several times). */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

const couponTemplateType = `
type CouponTemplate implements Node {
    id: ID!
    name: String!
    nameZh: String
    nameEn: String
    description: String
    descZh: String
    descEn: String
    type: CouponType!
    discountValue: Int!
    minSpend: Int!
    startsAt: DateTime
    endsAt: DateTime
    totalCount: Int!
    claimedCount: Int!
    pointsPrice: Int!
    perUserLimit: Int!
    scope: String!
    categoryId: ID
    variantId: ID
    enabled: Boolean!
    claimable: Boolean!
    claimCode: String
    validDays: Int
    newCustomerOnly: Boolean!
    memberLevel: String
    shopId: ID
    usageScene: CouponUsageScene!
    distributionChannels: String
    salePrice: Int!
    anchorPrice: Int
    label: String
    studentPrice: Int
    category: String
    activityImage: String
    storeCoverage: String!
    costBearer: String!
    merchantCostRate: Int!
    soldCount: Int
    createdAt: DateTime!
    updatedAt: DateTime!
}`;

const customerCouponType = `
type CustomerCoupon implements Node {
    id: ID!
    customerId: ID!
    templateId: ID!
    code: String!
    status: CouponStatus!
    issuedBy: CouponIssuedBy!
    reservedOrderId: ID
    usedOrderId: ID
    issuedAt: DateTime
    usedAt: DateTime
    expiredAt: DateTime
    template: CouponTemplate
    customer: Customer
    createdAt: DateTime!
    updatedAt: DateTime!
}`;

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [CouponTemplate, CustomerCoupon, ProductCouponBinding, InStoreBill, CouponSaleOrder, CouponBundle, CouponBundleItem, CouponSettlementOrder, CouponSettlementReconcileDiff, CouponFissionRecord, CouponGrantBatch, CouponDailyClaimRecord, CouponStoreBinding, CouponRedemption],
    providers: [
        { provide: COUPON_PLUGIN_OPTIONS, useFactory: () => CouponPlugin.options },
        CouponService,
        CouponBindingService,
        CouponSaleService,
        CouponStoreService,
        CouponSettlementService,
        CouponSettlementReconcileService,
        CouponExpireReminderService,
        CouponFissionService,
        InStoreBillService,
        CouponFrFService,
        AddCouponFieldsMigration,
        CreateProductCouponBindingMigration,
        AddCouponIndexes20260919,
        AddCouponMarketingFieldsMigration,
        AddCouponPromoFieldsMigration,
        AddCouponCategoryFieldMigration,
        AddCouponActivityImageMigration,
        StudentVerificationService,
        AddCouponUsageSceneMigration,
        AddCouponDistributionChannelsMigration,
        CreateInStoreBillMigration,
        CreateCouponSaleMigration,
        CreateCouponSettlementMigration,
        AddInStoreBillShopFieldsMigration,
        CreateCouponFissionMigration,
        CreateCouponReconcileMigration,
        CreateCouponFrFMigration,
        CreateCouponStoreMigration,
        AddCouponCostBearerMigration,
    ],
    exports: [CouponService, CouponBindingService, CouponSaleService],
    adminApiExtensions: {
        schema: () => gql`
            enum CouponType { FIXED PERCENT FULL FREE_SHIPPING }
            enum CouponStatus { UNUSED USED RETURNED EXPIRED INVALID }
            enum CouponIssuedBy { CENTRE ADMIN EXCHANGE SALE FISSION RECALL DAILY FLASH PAYGIFT }
            enum CouponUsageScene { ONLINE IN_STORE ALL }

            ${couponTemplateType}
            ${customerCouponType}

            type CouponFissionRecord implements Node {
                id: ID!
                channelId: ID!
                inviterCustomerId: ID!
                inviteeCustomerId: ID!
                inviteeCouponId: ID
                inviterCouponId: ID
                status: String!
                sharedAt: DateTime
                createdAt: DateTime!
            }

            type CouponGrantBatch implements Node {
                id: ID!
                channelId: ID!
                templateId: ID!
                days: Int!
                totalSelected: Int!
                issuedCount: Int!
                skippedCount: Int!
                resultsJson: String
                operator: String
                notified: Boolean!
                createdAt: DateTime!
            }

            type ProductCouponBinding implements Node {
                id: ID!
                productId: ID!
                variantIds: [ID!]
                couponTemplateId: ID!
                enabled: Boolean!
                displayOrder: Int!
                badgeText: String
                promoTitle: String
                remark: String
                template: CouponTemplate
            }

            input CreateProductCouponBindingInput {
                productId: ID!
                variantIds: [ID!]
                couponTemplateId: ID!
                enabled: Boolean
                displayOrder: Int
                badgeText: String
                promoTitle: String
                remark: String
            }

            input UpdateProductCouponBindingInput {
                id: ID!
                variantIds: [ID!]
                enabled: Boolean
                displayOrder: Int
                badgeText: String
                promoTitle: String
                remark: String
            }

            type CouponTemplateList implements PaginatedList {
                items: [CouponTemplate!]!
                totalItems: Int!
            }

            type CustomerCouponList implements PaginatedList {
                items: [CustomerCoupon!]!
                totalItems: Int!
            }

            type CouponRedemptionStat {
                templateId: ID!
                name: String
                claimed: Int!
                used: Int!
                expired: Int!
                unused: Int!
                returned: Int!
                invalid: Int!
                redemptionRate: Float!
                expiredRate: Float!
            }

            type InStoreBillQuote {
                ok: Boolean!
                reason: String
                couponCode: String
                couponName: String
                discountType: String
                discountValue: Int
                minSpend: Int
                originalAmount: Int
                discountAmount: Int
                finalAmount: Int
                customerName: String
                customerPhone: String
                expiresAt: DateTime
            }

            type InStoreBill implements Node {
                id: ID!
                channelId: ID!
                couponCode: String!
                couponTemplateId: ID!
                couponName: String
                customerId: ID!
                customerName: String
                customerPhone: String
                discountType: String!
                discountValue: Int!
                originalAmount: Int!
                discountAmount: Int!
                finalAmount: Int!
                operatorId: ID!
                operatorName: String
                shopId: ID
                shopName: String
                remark: String
                billedAt: DateTime!
                createdAt: DateTime!
            }

            type InStoreBillList implements PaginatedList {
                items: [InStoreBill!]!
                totalItems: Int!
            }

            type InStoreBillSummary {
                count: Int!
                originalTotal: Int!
                discountTotal: Int!
                finalTotal: Int!
            }

            input InStoreBillListOptions {
                skip: Int
                take: Int
                couponCode: String
                from: DateTime
                to: DateTime
            }

            input InStoreBillSummaryOptions {
                from: DateTime
                to: DateTime
            }

            type InStorePendingCoupon implements Node {
                id: ID!
                couponCode: String!
                couponName: String
                discountType: String!
                discountValue: Int!
                minSpend: Int
                customerId: ID!
                customerName: String
                customerPhone: String
                issuedAt: DateTime
                expiredAt: DateTime
            }

            type InStorePendingCouponList implements PaginatedList {
                items: [InStorePendingCoupon!]!
                totalItems: Int!
            }

            input InStorePendingCouponListOptions {
                skip: Int
                take: Int
            }

            type CouponIssueCustomer implements Node {
                id: ID!
                emailAddress: String!
                firstName: String
                lastName: String
                phoneNumber: String
            }

            type CouponIssueCustomerList implements PaginatedList {
                items: [CouponIssueCustomer!]!
                totalItems: Int!
            }

            type CouponIssueResult {
                customerId: ID!
                ok: Boolean!
                code: String
                reason: String
            }

            input CreateCouponTemplateInput {
                name: String
                description: String
                nameZh: String
                nameEn: String
                descZh: String
                descEn: String
                type: CouponType!
                discountValue: Int!
                minSpend: Int
                startsAt: DateTime
                endsAt: DateTime
                totalCount: Int
                pointsPrice: Int
                perUserLimit: Int
                scope: String
                categoryId: ID
                variantId: ID
                enabled: Boolean
                claimable: Boolean
                claimCode: String
                validDays: Int
                newCustomerOnly: Boolean
                memberLevel: String
                shopId: ID
                usageScene: CouponUsageScene
                distributionChannels: String
                salePrice: Int
                anchorPrice: Int
                label: String
                studentPrice: Int
                category: String
                activityImage: String
                storeCoverage: String
                costBearer: String
                merchantCostRate: Int
            }

            input UpdateCouponTemplateInput {
                id: ID!
                name: String
                description: String
                nameZh: String
                nameEn: String
                descZh: String
                descEn: String
                type: CouponType
                discountValue: Int
                minSpend: Int
                startsAt: DateTime
                endsAt: DateTime
                totalCount: Int
                pointsPrice: Int
                perUserLimit: Int
                scope: String
                categoryId: ID
                variantId: ID
                enabled: Boolean
                claimable: Boolean
                claimCode: String
                validDays: Int
                newCustomerOnly: Boolean
                memberLevel: String
                usageScene: CouponUsageScene
                distributionChannels: String
                salePrice: Int
                anchorPrice: Int
                label: String
                studentPrice: Int
                category: String
                activityImage: String
                storeCoverage: String
                costBearer: String
                merchantCostRate: Int
            }

            input CouponTemplateListOptions {
                skip: Int
                take: Int
                sort: JSON
                filter: JSON
            }

            input CustomerCouponListOptions {
                skip: Int
                take: Int
                sort: JSON
                filter: JSON
            }

            type CouponBundleItem {
                id: ID!
                bundleId: ID!
                templateId: ID!
                quantity: Int!
            }

            type CouponBundle implements Node {
                id: ID!
                name: String!
                description: String
                salePrice: Int!
                enabled: Boolean!
                shopId: ID
                channelId: ID!
                items: [CouponBundleItem!]!
            }

            type CouponBundleList implements PaginatedList {
                items: [CouponBundle!]!
                totalItems: Int!
            }

            input CouponBundleItemInput {
                templateId: ID!
                quantity: Int
            }

            input CouponBundleInput {
                name: String
                description: String
                salePrice: Int!
                enabled: Boolean
                shopId: ID
                items: [CouponBundleItemInput!]
            }

            input CouponBundleListOptions {
                skip: Int
                take: Int
            }

            type CouponSaleOrder implements Node {
                id: ID!
                customerId: ID!
                payMode: String!
                templateId: ID
                bundleId: ID
                orderId: ID
                amount: Int!
                status: String!
                paymentMethod: String
                externalRef: String
                paidAt: DateTime
                refundedAt: DateTime
                storeId: ID
                createdAt: DateTime!
            }

            type CouponSaleOrderList implements PaginatedList {
                items: [CouponSaleOrder!]!
                totalItems: Int!
            }

            input CouponSaleOrderListOptions {
                skip: Int
                take: Int
                status: String
            }

            type CouponStoreBinding implements Node {
                id: ID!
                templateId: ID
                bundleId: ID
                merchantId: ID
                storeId: ID!
                type: String!
                priority: Int!
                isDefault: Boolean!
                channelId: ID!
            }

            type CouponRedemption implements Node {
                id: ID!
                customerCouponId: ID!
                couponCode: String!
                templateId: ID!
                saleOrderId: ID
                merchantId: ID
                storeId: ID!
                channelId: ID!
                redeemMode: String!
                operatorId: ID
                operatorName: String
                redeemedAt: DateTime!
                revokedAt: DateTime
                revokeReason: String
                amount: Int
                deviceInfo: String
            }

            enum CouponSettlementStatus { PENDING SETTLED PAID_OUT REVERSED CANCELLED }

            type CouponSettlementOrder implements Node {
                id: ID!
                channelId: ID!
                saleOrderId: ID
                customerCouponId: ID!
                templateId: ID
                redeemRef: String!
                inStoreBillId: ID
                faceAmount: Int!
                commissionRateBp: Int!
                commissionAmount: Int!
                netAmount: Int!
                status: CouponSettlementStatus!
                settlementNo: String!
                splitMode: String
                splitReceiptNo: String
                attempts: Int!
                lastError: String
                settledAt: DateTime
                paidOutAt: DateTime
                reversedAt: DateTime
                voucherType: String
                remark: String
                createdAt: DateTime!
                updatedAt: DateTime!
            }

            type CouponSettlementOrderList implements PaginatedList {
                items: [CouponSettlementOrder!]!
                totalItems: Int!
            }

            input CouponSettlementOrderListOptions {
                skip: Int
                take: Int
                status: String
            }

            """结算汇总（T11 看板口径 = 结算单聚合；金额单位分）"""
            type CouponSettlementSummary {
                total: Int!
                pending: Int!
                settled: Int!
                paidOut: Int!
                reversed: Int!
                cancelled: Int!
                totalFace: Int!
                totalCommission: Int!
                totalNet: Int!
            }

            """分账配置态（T9 进件状态预留）：splitMode = stub|wechat|unknown；onboardingStatus = NONE|APPLYING|APPROVED|REJECTED"""
            type CouponSplitConfig {
                splitMode: String!
                onboardingStatus: String!
            }

            type CouponSettlementCycleResult {
                submitted: Int!
                promoted: Int!
                failed: Int!
            }

            type CouponSettlementReconcileDiff implements Node {
                id: ID!
                runId: String!
                channelId: ID!
                settlementOrderId: ID
                settlementNo: String
                diffType: String!
                severity: String!
                detail: String
                resolvedAt: DateTime
                remark: String
                createdAt: DateTime!
            }

            type CouponReconcileDiffList implements PaginatedList {
                items: [CouponSettlementReconcileDiff!]!
                totalItems: Int!
            }

            input CouponReconcileDiffListOptions {
                skip: Int
                take: Int
                severity: String
                diffType: String
                includeResolved: Boolean
            }

            type CouponReconcileRunResult {
                runId: String!
                checked: Int!
                diffs: Int!
                high: Int!
                medium: Int!
                low: Int!
            }

            extend type Query {
                couponTemplates(options: CouponTemplateListOptions): CouponTemplateList!
                couponTemplate(id: ID!): CouponTemplate
                customerCoupons(options: CustomerCouponListOptions): CustomerCouponList!
                couponChannelCustomers(query: String, take: Int, skip: Int): CouponIssueCustomerList!
                productCouponBindings(productId: ID!): [ProductCouponBinding!]!
                couponBoundProducts(templateId: ID!): [ProductCouponBinding!]!
                inStoreBillQuote(code: String!, originalAmount: Int): InStoreBillQuote!
                inStoreBills(options: InStoreBillListOptions): InStoreBillList!
                inStoreBillSummary(options: InStoreBillSummaryOptions): InStoreBillSummary!
                inStorePendingCoupons(options: InStorePendingCouponListOptions): InStorePendingCouponList!
                inStoreCustomerCoupons(customerId: ID!): [CustomerCoupon!]!
                couponBundles(options: CouponBundleListOptions): CouponBundleList!
                couponBundle(id: ID!): CouponBundle
                couponSaleOrders(options: CouponSaleOrderListOptions): CouponSaleOrderList!
                couponSaleOrder(id: ID!): CouponSaleOrder
                couponStoreBindings(templateId: ID!): [CouponStoreBinding!]!
                couponRedemptions(templateId: ID, storeId: ID, limit: Int): [CouponRedemption!]!
                couponRedemptionStats(templateId: ID, from: String, to: String): [CouponRedemptionStat!]!
                couponSettlementOrders(options: CouponSettlementOrderListOptions): CouponSettlementOrderList!
                couponSettlementOrder(id: ID!): CouponSettlementOrder
                couponReconcileDiffs(options: CouponReconcileDiffListOptions): CouponReconcileDiffList!
                couponSettlementSummary: CouponSettlementSummary!
                couponSplitConfig: CouponSplitConfig!
                studentVerifications(status: String): [StudentVerificationItem!]!
                couponGrantBatches(take: Int): [CouponGrantBatch!]!
                couponFissionRecords(take: Int): [CouponFissionRecord!]!
                couponWinBackPreviewCount(days: Int!): Int!
            }

            # StudentVerificationItem 原先只声明在 shopApiExtensions，admin schema 引用未知类型
            # 会导致 dev server 启动即 GraphQL schema 编译失败（Unknown type），此处需同步声明
            type StudentVerificationItem {
                customerId: ID!
                customerName: String!
                customerEmail: String
                status: String!
                school: String
                studentNo: String
                idImg: String
                reviewedAt: DateTime
            }

            extend type Mutation {
                inStoreBillRedeem(code: String!, originalAmount: Int!, remark: String): InStoreBill!
                createCouponTemplate(input: CreateCouponTemplateInput!): CouponTemplate!
                updateCouponTemplate(input: UpdateCouponTemplateInput!): CouponTemplate!
                deleteCouponTemplate(id: ID!): Boolean!
                grantCoupon(templateId: ID!, customerIds: [ID!]!): [String!]!
                revokeCustomerCoupon(id: ID!): CustomerCoupon!
                grantCouponIssue(templateId: ID!, customerIds: [ID!]!, notify: Boolean!): [CouponIssueResult!]!
                createProductCouponBinding(input: CreateProductCouponBindingInput!): ProductCouponBinding!
                updateProductCouponBinding(input: UpdateProductCouponBindingInput!): ProductCouponBinding!
                deleteProductCouponBinding(id: ID!): Boolean!
                bindProductsToCoupon(templateId: ID!, productIds: [ID!]!, variantIds: [ID!]): Int!
                unbindProductFromCoupon(templateId: ID!, productId: ID!): Boolean!
                createCouponBundle(input: CouponBundleInput!): CouponBundle!
                updateCouponBundle(id: ID!, input: CouponBundleInput!): CouponBundle!
                deleteCouponBundle(id: ID!): Boolean!
                setCouponStoreBindings(templateId: ID!, storeIds: [ID!]!, coverage: String): [CouponStoreBinding!]!
                refundCouponSaleOrder(id: ID!, reason: String): CouponSaleOrder!
                runCouponSettlementCycle: CouponSettlementCycleResult!
                runCouponReconcile: CouponReconcileRunResult!
                resolveCouponReconcileDiff(id: ID!, remark: String): Boolean!
                reviewStudentVerification(customerId: ID!, approve: Boolean!): StudentVerificationItem!
                couponWinBackGrant(templateId: ID!, days: Int!, notify: Boolean): CouponGrantBatch!
            }
        `,
        resolvers: [CouponAdminResolver, CouponTemplateResolver, CustomerCouponResolver, CouponBindingAdminResolver, InStoreBillAdminResolver, CouponSaleAdminResolver, CouponSettlementAdminResolver, CouponBundleResolver, StudentAdminResolver, CouponStoreAdminResolver],
    },
    shopApiExtensions: {
        schema: () => gql`
            enum CouponType { FIXED PERCENT FULL FREE_SHIPPING }
            enum CouponStatus { UNUSED USED RETURNED EXPIRED INVALID }
            enum CouponIssuedBy { CENTRE ADMIN EXCHANGE SALE FISSION RECALL DAILY FLASH PAYGIFT }
            enum CouponUsageScene { ONLINE IN_STORE ALL }

            ${couponTemplateType}
            ${customerCouponType}

            type CouponFissionActivity {
                name: String!
                subtitle: String
                rules: String
                startsAt: DateTime
                endsAt: DateTime!
                inviteeTemplate: CouponTemplate
                inviterTemplate: CouponTemplate
            }

            type CouponFissionClaimResult {
                status: String!
                inviteeCoupon: CustomerCoupon
                inviterCoupon: CustomerCoupon
            }

            type CouponDailyClaimItem {
                template: CouponTemplate!
                claimedToday: Boolean!
                soldOut: Boolean!
            }

            type CouponDailyClaimActivity {
                name: String!
                subtitle: String
                rules: String
                startsAt: DateTime
                endsAt: DateTime
                items: [CouponDailyClaimItem!]!
            }

            type CouponFlashSaleItem {
                template: CouponTemplate!
                soldOut: Boolean!
                myClaimed: Int!
            }

            type CouponFlashSaleActivity {
                name: String!
                subtitle: String
                rules: String
                startsAt: DateTime!
                endsAt: DateTime!
                perUserLimit: Int!
                items: [CouponFlashSaleItem!]!
            }

            type CouponFrFClaimResult {
                status: String!
                coupon: CustomerCoupon
            }

            type ProductCouponBinding implements Node {
                id: ID!
                productId: ID!
                variantIds: [ID!]
                couponTemplateId: ID!
                enabled: Boolean!
                displayOrder: Int!
                badgeText: String
                promoTitle: String
                template: CouponTemplate
            }

            type ExchangeCouponResult {
                coupon: CustomerCoupon!
                spentPoints: Int!
            }

            type CouponCampaign {
                name: String!
                subtitle: String
                rules: String
                startsAt: DateTime
                endsAt: DateTime!
                templates: [CouponTemplate!]!
                newCustomerOnly: Boolean
            }

            type CouponSaleCatalogue {
                templates: [CouponTemplate!]!
                bundles: [CouponBundle!]!
                firstBuyDiscount: Int
                firstBuyEligible: Boolean
                studentApproved: Boolean
                campaign: CouponCampaign
            }

            type StudentVerificationItem {
                customerId: ID!
                customerName: String!
                customerEmail: String
                status: String!
                school: String
                studentNo: String
                idImg: String
                reviewedAt: DateTime
            }

            type CouponBundleItem {
                id: ID!
                bundleId: ID!
                templateId: ID!
                quantity: Int!
            }

            type CouponBundle implements Node {
                id: ID!
                name: String!
                description: String
                salePrice: Int!
                enabled: Boolean!
                channelId: ID!
                soldCount: Int
                items: [CouponBundleItem!]!
            }

            type CouponSaleOrder implements Node {
                id: ID!
                customerId: ID!
                payMode: String!
                templateId: ID
                bundleId: ID
                orderId: ID
                amount: Int!
                discountType: String
                discountAmount: Int
                status: String!
                paidAt: DateTime
                refundedAt: DateTime
                storeId: ID
                createdAt: DateTime!
            }

            type CouponStoreOption {
                id: ID!
                name: String!
                address: String!
                phoneNumber: String
                businessHoursText: String
                isOpenNow: Boolean!
                distanceKm: Float
                lat: Float
                lng: Float
                photos: [String!]!
            }

            type CouponRedemptionResult {
                couponId: ID!
                couponCode: String!
                status: String!
                storeId: ID!
                storeName: String!
                redeemedAt: DateTime!
            }

            type CouponWechatPayParams {
                payType: String!
                prepayId: String
                appId: String
                timeStamp: String
                nonceStr: String
                package: String
                signType: String
                paySign: String
                payUrl: String
            }

            type CouponWechatPayResult {
                saleOrderId: ID!
                outTradeNo: String!
                pay: CouponWechatPayParams!
            }

            extend type Query {
                couponCentre(scene: CouponUsageScene): [CouponTemplate!]!
                couponCentreUpcoming(scene: CouponUsageScene): [CouponTemplate!]!
                myCoupons(status: CouponStatus): [CustomerCoupon!]!
                customerCouponByCode(code: String!): CustomerCoupon
                couponTemplateStores(templateId: ID!, lat: Float, lng: Float): [CouponStoreOption!]!
                couponStoresForCoupon(code: String!, lat: Float, lng: Float): [CouponStoreOption!]!
                pointsMallTemplates: [CouponTemplate!]!
                productCoupons(productId: ID!): [ProductCouponBinding!]!
                couponSaleCatalogue(scene: CouponUsageScene): CouponSaleCatalogue!
                myCouponSaleOrders: [CouponSaleOrder!]!
                myStudentVerification: StudentVerificationItem!
                couponFissionActivity: CouponFissionActivity
                couponDailyClaimActivity: CouponDailyClaimActivity
                couponFlashSaleActivity: CouponFlashSaleActivity
            }

            extend type Mutation {
                claimCoupon(templateId: ID!): CustomerCoupon!
                claimProductCoupon(bindingId: ID!): CustomerCoupon!
                redeemCouponByCode(claimCode: String!): CustomerCoupon!
                redeemCouponAtStore(couponCode: String!, storeId: ID!): CouponRedemptionResult!
                applyCouponToOrder(code: String!): Order!
                clearCouponFromOrder: Order!
                exchangeCouponWithPoints(templateId: ID!): ExchangeCouponResult!
                createCouponSaleOrder(templateId: ID, bundleId: ID, storeId: ID): CouponSaleOrder!
                payCouponSaleWithBalance(id: ID!): CouponSaleOrder!
                createWechatCouponPayment(saleOrderId: ID!, tradeType: String, openid: String): CouponWechatPayResult!
                cancelCouponSaleOrder(id: ID!): CouponSaleOrder!
                refundCouponSaleOrder(id: ID!, reason: String): CouponSaleOrder!
                attachCouponToOrder(orderId: ID!, templateId: ID!): CouponSaleOrder!
                detachCouponFromOrder(orderId: ID!, templateId: ID!): Boolean!
                applyStudentVerification(school: String!, studentNo: String!, idImg: String): StudentVerificationItem!
                claimFissionReward(inviteCode: String!): CouponFissionClaimResult!
                claimDailyCoupon(templateId: ID!): CouponFrFClaimResult!
                claimFlashCoupon(templateId: ID!): CouponFrFClaimResult!
            }
        `,
        resolvers: [CouponShopResolver, CouponTemplateResolver, CustomerCouponResolver, CouponSaleShopResolver, CouponBundleResolver, StudentShopResolver, CouponFissionShopResolver, CouponFrFShopResolver, CouponStoreShopResolver],
    },
    configuration: (config) => {
        config.customFields.Order = mergeCustomFields(config.customFields.Order, couponOrderCustomFields.Order);
        config.customFields.Channel = mergeCustomFields(config.customFields.Channel, couponPromoCustomFields.Channel);
        config.customFields.Customer = mergeCustomFields(config.customFields.Customer, couponPromoCustomFields.Customer);

        config.promotionOptions = config.promotionOptions || {};
        config.promotionOptions.promotionConditions = [
            ...(config.promotionOptions.promotionConditions ?? []),
            couponAppliedCondition,
        ];
        config.promotionOptions.promotionActions = [
            ...(config.promotionOptions.promotionActions ?? []),
            couponDiscountAction,
        ];

        return config;
    },
    compatibility: '^3.0.0',
})
export class CouponPlugin implements OnApplicationBootstrap {
    private static options: CouponPluginOptions = {};
    private injector: Injector;

    constructor(
        @Inject(COUPON_PLUGIN_OPTIONS) private options: CouponPluginOptions,
        private couponService: CouponService,
        private eventBus: EventBus,
        private moduleRef: ModuleRef,
    ) {}

    static init(options?: CouponPluginOptions): Type<CouponPlugin> {
        CouponPlugin.options = options ?? {};
        return CouponPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        this.injector = new Injector(this.moduleRef as any);
        this.couponService.init(this.injector);
        setCouponConnection(this.injector.get(TransactionalConnection));
        setBindingService(this.injector.get(CouponBindingService));

        // 门店能力端口（可选依赖 merchant-plugin）：扫码核销/门店快照/绑定门店都依赖 MerchantStoreService。
        // coupon 模块只 import PluginCommonModule，构造注入不可达，故经 Injector 全局查找后 set 进服务。
        try {
            const { MerchantStoreService } = await import('@vendure/merchant-plugin');
            const storeService = this.injector.get(MerchantStoreService);
            this.injector.get(CouponStoreService).setStoreService(storeService);
            Logger.info('Coupon store service registered (merchant-plugin)', loggerCtx);
        } catch (e: any) {
            Logger.warn(
                `Merchant store service unavailable, in-store coupon redemption disabled: ${String(e?.message ?? '')}`,
                loggerCtx,
            );
        }

        // 余额能力端口（可选依赖 recharge-card-plugin）：未装载时余额支付入口一律不可用
        try {
            const { RechargeCardService } = await import('@vendure/recharge-card-plugin');
            const svc = this.injector.get(RechargeCardService);
            setCouponBalancePort({
                getBalance: (ctx, cid) => svc.getBalance(ctx, cid),
                deductBalance: (ctx, cid, amt, ref) => svc.deductBalance(ctx, cid, amt, null, null, ref),
                addBalance: (ctx, cid, amt) => svc.addBalance(ctx, cid, amt, null, null),
            });
            Logger.info('Coupon balance port registered (recharge-card)', loggerCtx);
        } catch (e: any) {
            setCouponBalancePort(null);
            Logger.info('Coupon balance port unavailable (recharge-card not registered)', loggerCtx);
        }

        // 微信回调结算注册（前缀 CS-）+ 网关引用注入（可选依赖 wechatpay-plugin）
        try {
            const { WechatpaySettlementRegistry, WechatpayService } = await import('@vendure/wechatpay-plugin');
            const registry = this.injector.get(WechatpaySettlementRegistry);
            const gateway = this.injector.get(WechatpayService);
            setCouponSaleGateway(gateway);
            const saleService = this.injector.get(CouponSaleService);
            registry.register({
                prefix: 'CS-',
                settle: (ctx, outTradeNo) => saleService.settleCouponSaleOrderByOutTradeNo(ctx, outTradeNo),
            });
            Logger.info('CouponSaleOrder ~CS- settlement registered (wechatpay gateway)', loggerCtx);
        } catch (e: any) {
            setCouponSaleGateway(null);
            Logger.warn('Wechatpay settlement registry unavailable for coupon sale', loggerCtx);
        }

        // 可选定时清扫：收敛无人访问的存量过期券（惰性 on-read 已覆盖用户路径，此为长线兜底）。
        // 显式 set COUPON_EXPIRE_SWEEP_MS 才启动；默认关闭避免生产意外全量 UPDATE。
        const sweepMs = Number(process.env.COUPON_EXPIRE_SWEEP_MS ?? 0);
        if (sweepMs > 0) {
            const sweep = () => {
                this.couponService
                    .expireDueCouponsAll()
                    .then((n) => {
                        if (n > 0) Logger.info(`Expired ${n} coupon(s) via sweep`, loggerCtx);
                    })
                    .catch((e) => Logger.error(`Coupon expire sweep failed: ${e.message}`, loggerCtx));
            };
            sweep();
            setInterval(sweep, sweepMs);
            Logger.info(`Coupon expire sweep enabled (every ${sweepMs}ms)`, loggerCtx);
        }

        // T+1 结算汇总 job（买单券资金流 T2）：补登 → 提交分账（stub，风险铁律①）→ 回执推进。
        // 显式 set COUPON_SETTLE_JOB_MS 才启动（默认关闭，与过期清扫同先例）；
        // 生产建议 600000（10 分钟）——job 内部有 T+1 界线与幂等，高频空转无副作用。
        const settleMs = Number(process.env.COUPON_SETTLE_JOB_MS ?? 0);
        if (settleMs > 0) {
            const settle = () => {
                this.injector
                    .get(CouponSettlementService)
                    .runSettlementCycle()
                    .catch((e) => Logger.error(`Coupon settlement cycle failed: ${e.message}`, loggerCtx));
            };
            settle();
            setInterval(settle, settleMs);
            Logger.info(`Coupon settlement cycle enabled (every ${settleMs}ms)`, loggerCtx);
        }

        // FR-A2 券过期提醒（t1 营销补齐 PRD）：周期扫描 UNUSED/RETURNED 且临期（3 天/1 天窗口）
        // 的领券记录 → CouponExpireRemindEvent → notification-plugin 触达（站内信全量 +
        // 公众号增强，R4 同用户同券同阶段 7 天去重在订阅侧统一做，重复扫描幂等）。
        // 默认开启（间隔 6h，扫描只读+事件发布无全量 UPDATE 风险）；COUPON_EXPIRE_REMIND_MS=0 显式关闭。
        // 延迟 30s 首跑：避开 pm2 restart 启动窗口，保证 notification-plugin 事件订阅已就绪。
        const remindMs = Number(process.env.COUPON_EXPIRE_REMIND_MS ?? 21600000);
        if (remindMs > 0) {
            const remind = () => {
                this.injector
                    .get(CouponExpireReminderService)
                    .remindAllChannels()
                    .catch((e) => Logger.error(`Coupon expire reminder failed: ${e.message}`, loggerCtx));
            };
            const firstRun = setTimeout(remind, 30000);
            firstRun.unref?.();
            setInterval(remind, remindMs);
            Logger.info(`Coupon expire reminder enabled (every ${remindMs}ms)`, loggerCtx);
        }

        // 支付成功（订单下单成功）核销券
        this.eventBus.ofType(OrderPlacedEvent).subscribe(async (event) => {
            try {
                await this.couponService.bindAsUsed(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(`Failed to bind coupon as used on order ${event.order.id}: ${e.message}`, loggerCtx);
            }
        });

        // 订单取消回退券（幂等）
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'Cancelled') return;
            try {
                await this.couponService.returnCoupon(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(`Failed to return coupon on order ${event.order.id} cancel: ${e.message}`, loggerCtx);
            }
        });

        // 整单全额退款回退券（A3）：累计已退金额达应付 → 回退；部分退不触发（返回由 returnCoupon 保证幂等）
        this.eventBus.ofType(RefundStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'Settled') return;
            try {
                await this.couponService.returnCouponOnFullRefund(event.ctx, event.refund.id as any);
            } catch (e: any) {
                Logger.error(`Failed to return coupon on refund ${event.refund.id}: ${e.message}`, loggerCtx);
            }
            // 加价购：整单退款 Settled → 回收加价购券（与订单取消同语义）
            try {
                await this.injector
                    .get(CouponSaleService)
                    .refundSurchargeOrdersForOrder(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(
                    `Failed to recycle coupon surcharge on refund of order ${event.order.id}: ${e.message}`,
                    loggerCtx,
                );
            }
        });

        // 加价购：主订单支付成功 → 结算 PENDING 加价购单并发券
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'PaymentSettled') return;
            try {
                await this.injector
                    .get(CouponSaleService)
                    .settleSurchargeOrdersForOrder(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(`Failed to settle coupon surcharge on order ${event.order.id}: ${e.message}`, loggerCtx);
            }
        });

        // 支付有礼（FR-F3）：主订单支付成功 → 按渠道配置自动发奖励券（静默，失败不阻塞支付）
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'PaymentSettled') return;
            try {
                await this.injector
                    .get(CouponFrFService)
                    .payGiftOnOrderSettled(event.ctx, event.order);
            } catch (e: any) {
                Logger.error(`Failed to process pay gift on order ${event.order.id}: ${e.message}`, loggerCtx);
            }
        });

        // 加价购：主订单取消 / 整单退款 → 回收加价购券（钱随主订单退回）
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
            if (event.toState !== 'Cancelled') return;
            try {
                await this.injector
                    .get(CouponSaleService)
                    .refundSurchargeOrdersForOrder(event.ctx, event.order.id);
            } catch (e: any) {
                Logger.error(`Failed to recycle coupon surcharge on order ${event.order.id}: ${e.message}`, loggerCtx);
            }
        });

        Logger.info('CouponPlugin initialized', loggerCtx);
    }
}