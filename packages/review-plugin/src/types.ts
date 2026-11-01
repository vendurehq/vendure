import { ID, ListQueryOptions } from '@vendure/core';

import { Review } from './review.entity';

export interface ReviewPluginOptions {
    /** 评价内容去除首尾空白后的最小长度，用于屏蔽刷评/空白灌水。默认 0。 */
    minContentLength?: number;
    /** 开启后用户创建的评价直接 approved 并立即计入商品评分聚合（默认 false，走 pending→approve 审核流）。 */
    autoApprove?: boolean;
}

export interface CreateReviewInput {
    productId: ID;
    orderLineId?: ID;
    variantId?: ID;
    rating: number;
    content: string;
    images?: string[];
    videos?: string[];
    tags?: string[];
    isAnonymous?: boolean;
    /** 好评有礼所选礼包：quality / service / time；仅 ≥4 星主评有效，其它忽略。 */
    giftChoice?: string | null;
}

export interface UpdateReviewInput {
    content?: string;
    rating?: number;
    images?: string[];
    videos?: string[];
    tags?: string[];
    isAnonymous?: boolean;
}

/** 追评：挂在主评下，可仅文字/图片，聚合不计入。 */
export interface FollowUpReviewInput {
    content?: string;
    rating?: number;
    images?: string[];
    videos?: string[];
    tags?: string[];
    isAnonymous?: boolean;
}

export interface ReviewListOptions extends ListQueryOptions<Review> {
    productId?: ID;
    status?: string;
    /** C 端星级档筛选下界（含）。与 ratingMax 可单用/组合；越界（<1 或 >5）与 min>max 由服务层忽略。 */
    ratingMin?: number;
    /** C 端星级档筛选上界（含）。 */
    ratingMax?: number;
    /** C 端「有图」筛选：images 非空数组。 */
    hasImages?: boolean;
}

/** 差评申诉列表筛选（后台）：status 为申诉状态，缺省列出全部有申诉记录的评价。 */
export interface ReviewAppealListOptions extends ListQueryOptions<Review> {
    /** pending / approved / rejected */
    status?: string;
}

export interface RatingCount {
    rating: number;
    count: number;
}

export interface TagCount {
    tag: string;
    count: number;
}

export interface ReviewStats {
    totalCount: number;
    goodRate: number;
    averageRating: number;
    ratingDistribution: RatingCount[];
    topTags: TagCount[];
}

/** 聚合到 Product.customFields 的评分快照，供列表卡片直接展示。 */
export interface ProductRating {
    rating: number;
    reviewCount: number;
}