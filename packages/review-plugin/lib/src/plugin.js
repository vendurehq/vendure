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
var ReviewPlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewPlugin = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const review_channel_custom_fields_1 = require("./review-channel-custom-fields");
const review_alert_entity_1 = require("./review-alert.entity");
const review_alert_resolver_1 = require("./review-alert.resolver");
const review_alert_service_1 = require("./review-alert.service");
const review_entity_1 = require("./review.entity");
const review_admin_resolver_1 = require("./review-admin.resolver");
const review_product_custom_fields_1 = require("./review-product-custom-fields");
const review_service_1 = require("./review.service");
const review_shop_resolver_1 = require("./review-shop.resolver");
const { gql } = require('graphql-tag');
/** 幂等并入自定义字段，按 name 去重（preBootstrapConfig 可能多次执行插件配置）。 */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
const adminSchema = () => gql `
    type Review implements Node {
        id: ID!
        customerId: ID!
        customerName: String
        productId: ID!
        variantId: ID
        orderLineId: ID
        parentId: ID
        followUps: [Review!]!
        rating: Int!
        content: String!
        images: [String!]
        videos: [String!]
        tags: [String!]
        isAnonymous: Boolean!
        status: String!
        giftGranted: Boolean!
        """好评有礼所选礼包：quality / service / time；null 表示未选"""
        giftChoice: String
        reply: String
        repliedAt: DateTime
        reviewedAt: DateTime
        helpfulCount: Int!
        createdAt: DateTime!
        updatedAt: DateTime!
        """差评申诉状态：pending / approved（评价已隐藏）/ rejected；null 表示未申诉"""
        appealStatus: String
        appealReason: String
        appealImages: [String!]
        appealAt: DateTime
        appealResult: String
        appealReviewedAt: DateTime
    }

    type ReviewList implements PaginatedList {
        items: [Review!]!
        totalItems: Int!
    }

    input ReviewListOptions {
        skip: Int
        take: Int
        productId: ID
        status: String
    }

    input ReviewAppealListOptions {
        skip: Int
        take: Int
        status: String
    }

    type RatingCount {
        rating: Int!
        count: Int!
    }

    type TagCount {
        tag: String!
        count: Int!
    }

    type ReviewStats {
        totalCount: Int!
        goodRate: Float!
        averageRating: Float!
        ratingDistribution: [RatingCount!]!
        topTags: [TagCount!]!
    }

    type ProductRating {
        rating: Float!
        reviewCount: Int!
    }

    """P4-2 评价品质闭环：渠道预警规则（每渠道一条）"""
    type ReviewAlertRule {
        channelId: ID!
        enabled: Boolean!
        maxRating: Int!
        couponTemplateId: ID
    }

    """P4-2 差评预警（reviewId 唯一）"""
    type ReviewAlert implements Node {
        id: ID!
        reviewId: ID!
        channelId: ID!
        productId: ID!
        customerId: ID!
        productName: String
        rating: Int!
        content: String!
        tags: [String!]!
        """none 未发 / issued 已发 / failed 发放失败（可重试）"""
        couponStatus: String!
        couponCode: String
        """new 待处理 / replied 已回评 / closed 已关闭"""
        status: String!
        note: String
        handledAt: DateTime
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type ReviewAlertList implements PaginatedList {
        items: [ReviewAlert!]!
        totalItems: Int!
    }

    input ReviewAlertListOptions {
        skip: Int
        take: Int
        status: String
        "创建时间下界（ISO 字符串）"
        from: String
        "创建时间上界（ISO 字符串）"
        to: String
    }

    input UpdateReviewAlertRuleInput {
        enabled: Boolean
        maxRating: Int
        couponTemplateId: ID
    }

    type ReviewAlertStats {
        newCount: Int!
        totalCount: Int!
        compensatedCount: Int!
        last7dCount: Int!
    }

    extend type Query {
        reviews(options: ReviewListOptions): ReviewList!
        reviewAppeals(options: ReviewAppealListOptions): ReviewList!
        review(id: ID!): Review
        reviewStats(productId: ID!): ReviewStats!
        productRating(productId: ID!): ProductRating!
        reviewAlertRule: ReviewAlertRule!
        reviewAlerts(options: ReviewAlertListOptions): ReviewAlertList!
        reviewAlert(id: ID!): ReviewAlert
        reviewAlertStats: ReviewAlertStats!
    }

    extend type Mutation {
        replyReview(id: ID!, reply: String!): Review!
        approveReview(id: ID!): Review!
        rejectReview(id: ID!): Review!
        """差评申诉审核通过：评价隐藏并退出评分聚合"""
        approveReviewAppeal(id: ID!, note: String): Review!
        """差评申诉驳回：评价维持原状，仅留痕"""
        rejectReviewAppeal(id: ID!, note: String): Review!
        """撤销申诉通过：评价恢复展示并重新计入评分聚合（需填撤销原因）"""
        revokeReviewAppeal(id: ID!, note: String): Review!
        """P4-2 预警规则保存（每渠道一条）"""
        updateReviewAlertRule(input: UpdateReviewAlertRuleInput!): ReviewAlertRule!
        """P4-2 一键回评（写回评价回复）"""
        replyReviewAlert(id: ID!, reply: String!): ReviewAlert!
        """P4-2 补发致歉券"""
        resendReviewAlertCoupon(id: ID!): ReviewAlert!
        """P4-2 关闭预警"""
        closeReviewAlert(id: ID!, note: String): ReviewAlert!
    }
`;
const shopSchema = () => gql `
    type Review implements Node {
        id: ID!
        customerId: ID!
        customerName: String
        productId: ID!
        variantId: ID
        orderLineId: ID
        parentId: ID
        followUps: [Review!]!
        rating: Int!
        content: String!
        images: [String!]
        videos: [String!]
        tags: [String!]
        isAnonymous: Boolean!
        status: String!
        """好评有礼是否已发放（主评审核通过后置 true）"""
        giftGranted: Boolean!
        """好评有礼所选礼包：quality / service / time；null 表示未选"""
        giftChoice: String
        reply: String
        repliedAt: DateTime
        reviewedAt: DateTime
        helpfulCount: Int!
        createdAt: DateTime!
        updatedAt: DateTime!
        """差评申诉状态：pending / approved（评价已隐藏）/ rejected；null 表示未申诉"""
        appealStatus: String
        appealReason: String
        appealImages: [String!]
        appealAt: DateTime
        appealResult: String
        appealReviewedAt: DateTime
    }

    type ReviewList implements PaginatedList {
        items: [Review!]!
        totalItems: Int!
    }

    input ReviewListOptions {
        skip: Int
        take: Int
        ratingMin: Int
        ratingMax: Int
        hasImages: Boolean
    }

    input CreateReviewInput {
        productId: ID!
        orderLineId: ID
        variantId: ID
        rating: Int!
        content: String!
        images: [String!]
        videos: [String!]
        tags: [String!]
        isAnonymous: Boolean
        """好评有礼所选礼包：quality / service / time（仅 ≥4 星主评有效）"""
        giftChoice: String
    }

    input UpdateReviewInput {
        content: String
        rating: Int
        images: [String!]
        videos: [String!]
        tags: [String!]
        isAnonymous: Boolean
    }

    input FollowUpReviewInput {
        content: String
        rating: Int
        images: [String!]
        videos: [String!]
        tags: [String!]
        isAnonymous: Boolean
    }

    type ReviewStats {
        totalCount: Int!
        goodRate: Float!
        averageRating: Float!
        ratingDistribution: [RatingCount!]!
        topTags: [TagCount!]!
    }

    type ProductRating {
        rating: Float!
        reviewCount: Int!
    }

    type RatingCount {
        rating: Int!
        count: Int!
    }

    type TagCount {
        tag: String!
        count: Int!
    }

    extend type Query {
        productReviews(productId: ID!, options: ReviewListOptions): ReviewList!
        myReviews: [Review!]!
        reviewStats(productId: ID!): ReviewStats!
        productRating(productId: ID!): ProductRating!
        channelReviews(options: ReviewListOptions): ReviewList!
        channelReviewStats: ReviewStats!
    }

    extend type Mutation {
        createReview(input: CreateReviewInput!): Review!
        updateReview(id: ID!, input: UpdateReviewInput!): Review!
        deleteReview(id: ID!): Boolean!
        createFollowUpReview(reviewId: ID!, input: FollowUpReviewInput!): Review!
        markReviewHelpful(id: ID!): Review!
        """差评申诉：仅本人 1-3 星主评，审核通过后评价隐藏"""
        appealReview(reviewId: ID!, reason: String!, images: [String!]): Review!
    }
`;
let ReviewPlugin = ReviewPlugin_1 = class ReviewPlugin {
    constructor(options) {
        this.options = options;
    }
    static init(options) {
        ReviewPlugin_1.options = options !== null && options !== void 0 ? options : {};
        return ReviewPlugin_1;
    }
};
exports.ReviewPlugin = ReviewPlugin;
ReviewPlugin.options = {};
exports.ReviewPlugin = ReviewPlugin = ReviewPlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        entities: [review_entity_1.Review, review_alert_entity_1.ReviewAlertRule, review_alert_entity_1.ReviewAlert],
        providers: [
            { provide: constants_1.REVIEW_PLUGIN_OPTIONS, useFactory: () => ReviewPlugin.options },
            review_service_1.ReviewService,
            review_alert_service_1.ReviewAlertService,
        ],
        adminApiExtensions: {
            schema: adminSchema,
            resolvers: [review_admin_resolver_1.ReviewAdminResolver, review_alert_resolver_1.ReviewAlertResolver],
        },
        shopApiExtensions: {
            schema: shopSchema,
            resolvers: [review_shop_resolver_1.ReviewShopResolver],
        },
        configuration: (config) => {
            // 评星驱动的商品评分聚合结果写入 Product 自定义字段
            config.customFields.Product = mergeCustomFields(config.customFields.Product, review_product_custom_fields_1.reviewProductCustomFields.Product);
            // 评价有礼/追评窗口：渠道级配置（Channel customFields）
            config.customFields.Channel = mergeCustomFields(config.customFields.Channel, review_channel_custom_fields_1.reviewChannelCustomFields.Channel);
            return config;
        },
        dashboard: '../dashboard/index.tsx',
        compatibility: '^3.0.0',
    }),
    __param(0, (0, common_1.Inject)(constants_1.REVIEW_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object])
], ReviewPlugin);
//# sourceMappingURL=plugin.js.map