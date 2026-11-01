import { Inject, Type } from '@nestjs/common';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { REVIEW_PLUGIN_OPTIONS } from './constants';
import { reviewChannelCustomFields } from './review-channel-custom-fields';
import { ReviewAlert, ReviewAlertRule } from './review-alert.entity';
import { ReviewAlertResolver } from './review-alert.resolver';
import { ReviewAlertService } from './review-alert.service';
import { Review } from './review.entity';
import { ReviewAdminResolver } from './review-admin.resolver';
import { reviewProductCustomFields } from './review-product-custom-fields';
import { ReviewService } from './review.service';
import { ReviewShopResolver } from './review-shop.resolver';
import { ReviewPluginOptions } from './types';

const { gql } = require('graphql-tag');

/** 幂等并入自定义字段，按 name 去重（preBootstrapConfig 可能多次执行插件配置）。 */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

const adminSchema = () => gql`
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

const shopSchema = () => gql`
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

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Review, ReviewAlertRule, ReviewAlert],
    providers: [
        { provide: REVIEW_PLUGIN_OPTIONS, useFactory: () => ReviewPlugin.options },
        ReviewService,
        ReviewAlertService,
    ],
    adminApiExtensions: {
        schema: adminSchema,
        resolvers: [ReviewAdminResolver, ReviewAlertResolver],
    },
    shopApiExtensions: {
        schema: shopSchema,
        resolvers: [ReviewShopResolver],
    },
    configuration: (config) => {
        // 评星驱动的商品评分聚合结果写入 Product 自定义字段
        config.customFields.Product = mergeCustomFields(
            config.customFields.Product,
            reviewProductCustomFields.Product,
        );
        // 评价有礼/追评窗口：渠道级配置（Channel customFields）
        config.customFields.Channel = mergeCustomFields(
            config.customFields.Channel,
            reviewChannelCustomFields.Channel,
        );
        return config;
    },
    dashboard: '../dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class ReviewPlugin {
    private static options: ReviewPluginOptions = {};

    constructor(@Inject(REVIEW_PLUGIN_OPTIONS) private options: ReviewPluginOptions) {}

    static init(options?: ReviewPluginOptions): Type<ReviewPlugin> {
        ReviewPlugin.options = options ?? {};
        return ReviewPlugin;
    }
}
