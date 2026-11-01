import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Channel,
    CustomerService,
    EntityNotFoundError,
    ForbiddenError,
    ID,
    Injector,
    ListQueryBuilder,
    Logger,
    OrderLine,
    PaginatedList,
    ProductService,
    RequestContext,
    TransactionalConnection,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';
import { CouponService } from '@vendure/coupon-plugin';
import { MemberLevelService } from '@vendure/member-level-plugin';

import { loggerCtx, REVIEW_PLUGIN_OPTIONS } from './constants';
import { Review } from './review.entity';
import { ReviewAlertService } from './review-alert.service';
import { ReviewPluginOptions } from './types';
import { Between, FindOperator, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, SelectQueryBuilder } from 'typeorm';
import {
    CreateReviewInput,
    FollowUpReviewInput,
    ProductRating,
    RatingCount,
    ReviewAppealListOptions,
    ReviewListOptions,
    ReviewStats,
    TagCount,
    UpdateReviewInput,
} from './types';

const ALLOWED_ORDER_STATES = ['Delivered', 'Completed'];
/** 对外可见且计入评分聚合的状态。 */
const VISIBLE_STATUS = 'approved';
const DELETED_STATUS = 'deleted';
/** 差评申诉成立后的隐藏态：不展示、不计入评分聚合（保留记录便于追溯）。 */
const HIDDEN_STATUS = 'hidden';
/** 可申诉的差评档位（1-3 星）。 */
const APPEALABLE_MAX_RATING = 3;
const APPEAL_STATUSES = ['pending', 'approved', 'rejected'];
const MAX_APPEAL_REASON = 300;
const MAX_APPEAL_IMAGES = 6;
/** 好评有礼可选礼包（与 C 端枚举一致）；≤3 星与追评不记录。 */
const GIFT_CHOICES = ['quality', 'service', 'time'];
/** 礼包 → 渠道 customFields 券模板字段名（缺省回落 reviewGiftCouponTemplateId）。 */
const GIFT_COUPON_FIELD: Record<string, string> = {
    quality: 'reviewGiftQualityCouponTemplateId',
    service: 'reviewGiftServiceCouponTemplateId',
    time: 'reviewGiftTimeCouponTemplateId',
};

/**
 * 星级档筛选条件：TypeORM 的同一列不能挂两个 FindOperator，故按入参合并为单个。
 * 入参越界（非 1-5 整数）或 min > max 时返回 undefined，即忽略该筛选（不抛错，避免拖垮 C 端列表）。
 */
function buildRatingFilter(min?: number, max?: number): FindOperator<number> | undefined {
    const inRange = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;
    const hasMin = inRange(min);
    const hasMax = inRange(max);
    if (hasMin && hasMax) return min! > max! ? undefined : Between(min!, max!);
    if (hasMin) return MoreThanOrEqual(min!);
    if (hasMax) return LessThanOrEqual(max!);
    return undefined;
}

/** simple-json 列「有图」过滤：images 为非空 JSON 数组（PG text 存储口径）。 */
function applyHasImagesFilter(qb: SelectQueryBuilder<Review>, options?: ReviewListOptions): void {
    if (options?.hasImages === true) {
        qb.andWhere(`("images" IS NOT NULL AND "images" <> '[]')`);
    }
}

/** approved 主评集合 → 统计摘要（商品级与店铺级共用）。 */
function computeStats(reviews: Review[]): ReviewStats {
    const totalCount = reviews.length;
    if (totalCount === 0) {
        return {
            totalCount: 0,
            goodRate: 0,
            averageRating: 0,
            ratingDistribution: [1, 2, 3, 4, 5].map(rating => ({ rating, count: 0 })),
            topTags: [],
        };
    }
    const goodCount = reviews.filter(r => r.rating >= 4).length;
    const goodRate = Math.round((goodCount / totalCount) * 1000) / 10;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    const averageRating = Math.round((sum / totalCount) * 10) / 10;

    const distMap = new Map<number, number>();
    for (const r of reviews) {
        distMap.set(r.rating, (distMap.get(r.rating) ?? 0) + 1);
    }
    const ratingDistribution: RatingCount[] = [1, 2, 3, 4, 5].map(rating => ({
        rating,
        count: distMap.get(rating) ?? 0,
    }));

    const tagMap = new Map<string, number>();
    for (const r of reviews) {
        for (const tag of r.tags ?? []) {
            tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
        }
    }
    const topTags: TagCount[] = [...tagMap.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return { totalCount, goodRate, averageRating, ratingDistribution, topTags };
}

@Injectable()
export class ReviewService {
    constructor(
        @Optional() @Inject(REVIEW_PLUGIN_OPTIONS) private options: ReviewPluginOptions = {},
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private customerService: CustomerService,
        private productService: ProductService,
        @Optional() private moduleRef?: ModuleRef,
        @Optional() private alertService?: ReviewAlertService,
    ) {}

    /** vendure Injector 由 ModuleRef 惰性构造（跨模块解析 Coupon/MemberLevel 服务，避免循环依赖） */
    private get injector(): Injector {
        return new Injector(this.moduleRef!);
    }

    async createReview(ctx: RequestContext, input: CreateReviewInput): Promise<Review> {
        const customer = await this.requireCustomer(ctx);
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
            throw new UserInputError('rating must be an integer between 1 and 5');
        }
        this.assertContent(input.content);
        if (!input.orderLineId) {
            throw new UserInputError('orderLineId is required to create a review');
        }
        const giftChoice = this.normalizeGiftChoice(input.giftChoice, input.rating);

        const orderLineRepo = this.connection.getRepository(ctx, OrderLine);
        const orderLine = await orderLineRepo.findOne({
            where: { id: Number(input.orderLineId) } as any,
            relations: ['order', 'order.customer'],
        });
        if (!orderLine || !orderLine.order) {
            throw new EntityNotFoundError('OrderLine', input.orderLineId);
        }
        const order = orderLine.order;
        if (!order.customer || order.customer.id !== customer.id) {
            throw new ForbiddenError();
        }
        if (!ALLOWED_ORDER_STATES.includes(order.state)) {
            throw new UserInputError('Order must be delivered before reviewing');
        }

        const reviewRepo = this.connection.getRepository(ctx, Review);
        const existing = await reviewRepo.findOne({
            where: {
                orderLineId: Number(input.orderLineId),
                customerId: customer.id,
            } as any,
        });
        if (existing) {
            throw new UserInputError('You have already reviewed this order line');
        }

        const status = this.options.autoApprove ? VISIBLE_STATUS : 'pending';
        const review = new Review({
            customerId: customer.id,
            productId: Number(input.productId),
            orderLineId: Number(input.orderLineId),
            variantId: input.variantId ? Number(input.variantId) : null,
            rating: input.rating,
            content: input.content.trim(),
            images: input.images ?? null,
            videos: input.videos ?? null,
            tags: input.tags ?? null,
            isAnonymous: input.isAnonymous ?? false,
            status,
            channelId: ctx.channelId as number,
            giftChoice,
        } as any);
        review.channels = [ctx.channel];
        const saved = await reviewRepo.save(review);
        // P4-2 品质闭环：差评落库即预警（不等审核），失败不影响评价主流程
        try {
            await this.alertService?.recordFromReview(ctx, saved);
        } catch (e: any) {
            Logger.warn(`review alert failed for review ${saved.id}: ${e?.message ?? e}`, loggerCtx);
        }
        if (status === VISIBLE_STATUS) {
            await this.recomputeProductRating(ctx, Number(input.productId));
        }
        Logger.info(
            `Review created by customer ${customer.id} for product ${input.productId}`,
            loggerCtx,
        );
        return saved;
    }

    /** 追评：挂在本人主评（parentId）下，聚合不计入；仅 approved 主评且在追评窗口内。 */
    async createFollowUpReview(
        ctx: RequestContext,
        reviewId: ID,
        input: FollowUpReviewInput,
    ): Promise<Review> {
        const customer = await this.requireCustomer(ctx);
        const reviewRepo = this.connection.getRepository(ctx, Review);
        const parent = await reviewRepo.findOne({ where: { id: Number(reviewId) } as any });
        if (!parent) {
            throw new EntityNotFoundError('Review', reviewId);
        }
        if (parent.customerId !== customer.id) {
            throw new ForbiddenError();
        }
        if (parent.status === DELETED_STATUS) {
            throw new UserInputError('Cannot add a follow-up to a deleted review');
        }
        if (parent.parentId != null) {
            throw new UserInputError('Cannot add a follow-up to a follow-up');
        }
        if (parent.status !== VISIBLE_STATUS) {
            throw new UserInputError('主评价通过审核后才能追评');
        }
        const windowDays = await this.getFollowUpWindowDays(ctx);
        if (windowDays <= 0) {
            throw new UserInputError('当前店铺未开放追评');
        }
        const base = parent.reviewedAt ?? parent.createdAt;
        if (base && Date.now() - new Date(base).getTime() > windowDays * 86400000) {
            throw new UserInputError(`已超过追评窗口（审核通过后 ${windowDays} 天内可追评）`);
        }
        if (input.content != null) {
            this.assertContent(input.content);
        }
        if (input.rating != null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
            throw new UserInputError('rating must be an integer between 1 and 5');
        }

        const followUp = new Review({
            customerId: customer.id,
            productId: parent.productId,
            orderLineId: parent.orderLineId,
            variantId: parent.variantId,
            rating: input.rating ?? parent.rating,
            content: (input.content ?? '').trim(),
            images: input.images ?? null,
            videos: input.videos ?? null,
            tags: input.tags ?? null,
            isAnonymous: input.isAnonymous ?? parent.isAnonymous,
            status: this.options.autoApprove ? VISIBLE_STATUS : 'pending',
            parentId: parent.id as number,
            channelId: ctx.channelId as number,
        } as any);
        followUp.channels = [ctx.channel];
        return reviewRepo.save(followUp);
    }

    /** 修改本人评价：仅 pending/approved 可改；变更涉及已审核主评时重算评分聚合。 */
    async updateReview(ctx: RequestContext, id: ID, input: UpdateReviewInput): Promise<Review> {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        if (review.customerId !== customer.id) {
            throw new ForbiddenError();
        }
        if (review.status !== 'pending' && review.status !== VISIBLE_STATUS) {
            throw new UserInputError('Only pending or approved reviews can be updated');
        }
        if (input.content != null) {
            this.assertContent(input.content);
            review.content = input.content.trim();
        }
        if (input.rating != null) {
            if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
                throw new UserInputError('rating must be an integer between 1 and 5');
            }
            // 追评无独立评分聚合，改评风仅主评生效
            if (!review.parentId) {
                review.rating = input.rating;
            }
        }
        if (input.images !== undefined) review.images = input.images;
        if (input.videos !== undefined) review.videos = input.videos;
        if (input.tags !== undefined) review.tags = input.tags;
        if (input.isAnonymous !== undefined) review.isAnonymous = input.isAnonymous;

        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return saved;
    }

    /** 删除本人评价（软删）。已审核主评删除后剔除聚合。 */
    async deleteReview(ctx: RequestContext, id: ID): Promise<boolean> {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        if (review.customerId !== customer.id) {
            throw new ForbiddenError();
        }
        if (review.status === DELETED_STATUS) {
            return true;
        }
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.status = DELETED_STATUS;
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return true;
    }

    async replyReview(ctx: RequestContext, id: ID, reply: string): Promise<Review> {
        if (!reply || !reply.trim()) {
            throw new UserInputError('reply must not be empty');
        }
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        review.reply = reply;
        review.repliedAt = new Date();
        return this.connection.getRepository(ctx, Review).save(review);
    }

    async approveReview(ctx: RequestContext, id: ID): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        const wasVisible = review.status === VISIBLE_STATUS;
        review.status = VISIBLE_STATUS;
        review.reviewedAt = new Date();
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        if (!review.parentId) {
            await this.recomputeProductRating(ctx, saved.productId);
            if (!wasVisible && !review.giftGranted) {
                // 评价有礼：发奖成功则回写 giftGranted（幂等闸），失败不阻塞审核流转
                const granted = await this.grantReviewGift(ctx, review);
                if (granted) {
                    review.giftGranted = true;
                    return this.connection.getRepository(ctx, Review).save(review);
                }
            }
        }
        return saved;
    }

    async rejectReview(ctx: RequestContext, id: ID): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.status = 'rejected';
        review.reviewedAt = new Date();
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return saved;
    }

    async getReview(ctx: RequestContext, id: ID): Promise<Review> {
        return this.connection.getEntityOrThrow(ctx, Review, id);
    }

    // ---------------- 差评申诉（P0-4） ----------------

    /**
     * 顾客对本人差评（1-3 星）发起申诉，诉求为隐藏该评价（内容有误 / 与商家已协商一致等）。
     * 同一评价同时只允许一条待审核申诉；追评与已删除评价不可申诉。
     */
    async appealReview(
        ctx: RequestContext,
        reviewId: ID,
        reason: string,
        images?: string[] | null,
    ): Promise<Review> {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, Review, reviewId);
        if (review.customerId !== customer.id) {
            throw new ForbiddenError();
        }
        if (review.parentId) {
            throw new UserInputError('追评不支持申诉');
        }
        if (review.rating > APPEALABLE_MAX_RATING) {
            throw new UserInputError(`仅 ${APPEALABLE_MAX_RATING} 星及以下差评可申诉`);
        }
        if (review.status === DELETED_STATUS) {
            throw new UserInputError('已删除的评价不可申诉');
        }
        if (review.appealStatus === 'pending') {
            throw new UserInputError('申诉已提交，请等待审核');
        }
        if (review.appealStatus === 'approved') {
            throw new UserInputError('该评价已申诉通过并隐藏');
        }
        const text = String(reason ?? '').trim();
        if (!text) {
            throw new UserInputError('请填写申诉理由');
        }
        if (text.length > MAX_APPEAL_REASON) {
            throw new UserInputError(`申诉理由不能超过 ${MAX_APPEAL_REASON} 个字符`);
        }
        const imgs = (images ?? []).map(v => String(v ?? '').trim()).filter(Boolean);
        if (imgs.length > MAX_APPEAL_IMAGES) {
            throw new UserInputError(`最多上传 ${MAX_APPEAL_IMAGES} 张图片`);
        }
        review.appealStatus = 'pending';
        review.appealReason = text;
        review.appealImages = imgs.length ? imgs : null;
        review.appealAt = new Date();
        review.appealResult = null;
        review.appealReviewedBy = null;
        review.appealReviewedAt = null;
        return this.connection.getRepository(ctx, Review).save(review);
    }

    /** 后台申诉列表：status 为申诉状态（pending/approved/rejected），缺省列出全部有申诉记录的评价。 */
    async getReviewAppeals(
        ctx: RequestContext,
        options?: ReviewAppealListOptions,
    ): Promise<PaginatedList<Review>> {
        if (options?.status && !APPEAL_STATUSES.includes(options.status)) {
            throw new UserInputError('申诉状态不合法');
        }
        return this.listQueryBuilder
            .build(Review, options, {
                ctx,
                relations: ['channels'],
                channelId: ctx.channelId,
                where: {
                    appealStatus: options?.status ?? Not(IsNull()),
                } as any,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /** 申诉审核通过：评价被隐藏（退出展示与评分聚合），结果与审核人留痕。 */
    async approveReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        if (review.appealStatus !== 'pending') {
            throw new UserInputError('该申诉已处理');
        }
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.appealStatus = 'approved';
        review.appealResult = String(note ?? '').trim() || null;
        review.appealReviewedBy = String(ctx.activeUserId ?? '');
        review.appealReviewedAt = new Date();
        review.status = HIDDEN_STATUS;
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        Logger.info(`Review appeal approved for review ${review.id}`, loggerCtx);
        return saved;
    }

    /** 申诉驳回：评价维持原状，仅记录审核说明留痕。 */
    async rejectReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        if (review.appealStatus !== 'pending') {
            throw new UserInputError('该申诉已处理');
        }
        review.appealStatus = 'rejected';
        review.appealResult = String(note ?? '').trim() || null;
        review.appealReviewedBy = String(ctx.activeUserId ?? '');
        review.appealReviewedAt = new Date();
        return this.connection.getRepository(ctx, Review).save(review);
    }

    /**
     * 撤销申诉通过（人工纠错）：把已隐藏的评价恢复展示并重新计入评分聚合，
     * 申诉状态回退为 rejected，撤销原因与操作人追加到留痕字段。
     */
    async revokeReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        if (review.appealStatus !== 'approved') {
            throw new UserInputError('仅已通过的申诉可撤销');
        }
        if (review.status !== HIDDEN_STATUS) {
            throw new UserInputError('评价当前不是隐藏态，无需撤销');
        }
        const reason = String(note ?? '').trim();
        if (!reason) {
            throw new UserInputError('请填写撤销原因');
        }
        if (reason.length > MAX_APPEAL_REASON) {
            throw new UserInputError(`撤销原因不能超过 ${MAX_APPEAL_REASON} 个字符`);
        }
        // 去掉末尾标点，避免与拼接分隔符「；」重复（如「…评价隐藏。；撤销通过：…」）
        const prev = String(review.appealResult ?? '').trim().replace(/[；;。，,]+$/u, '');
        review.appealStatus = 'rejected';
        review.appealResult = `${prev ? `${prev}；` : ''}撤销通过：${reason}`;
        review.appealReviewedBy = String(ctx.activeUserId ?? '');
        review.appealReviewedAt = new Date();
        review.status = VISIBLE_STATUS;
        const saved = await this.connection.getRepository(ctx, Review).save(review);
        // 追评不进评分聚合，仅主评恢复展示时重算
        if (!saved.parentId) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        Logger.info(`Review appeal revoked for review ${review.id}`, loggerCtx);
        return saved;
    }

    async getReviews(ctx: RequestContext, options?: ReviewListOptions): Promise<PaginatedList<Review>> {
        const where: any = {};
        if (options?.productId != null) {
            where.productId = Number(options.productId);
        }
        if (options?.status != null) {
            where.status = options.status;
        }
        return this.listQueryBuilder
            .build(Review, options, {
                ctx,
                relations: ['channels'],
                channelId: ctx.channelId,
                where,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /** C 端商品列表：仅对外可见（approved）的主评 + 追评（followUps 由 ResolveField 加载）。 */
    async getProductReviews(
        ctx: RequestContext,
        productId: ID,
        options?: ReviewListOptions,
    ): Promise<PaginatedList<Review>> {
        const ratingFilter = buildRatingFilter(options?.ratingMin, options?.ratingMax);
        const qb = this.listQueryBuilder
            .build(
                Review,
                { ...options },
                {
                    ctx,
                    relations: ['channels'],
                    channelId: ctx.channelId,
                    where: {
                        productId: Number(productId),
                        status: VISIBLE_STATUS,
                        parentId: IsNull(),
                        ...(ratingFilter ? { rating: ratingFilter } : {}),
                    } as any,
                },
            );
        applyHasImagesFilter(qb, options);
        return qb
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /** C 端店铺级评论流：当前渠道全部 approved 主评（menu 评论 tab 数据源）。 */
    async getChannelReviews(ctx: RequestContext, options?: ReviewListOptions): Promise<PaginatedList<Review>> {
        const ratingFilter = buildRatingFilter(options?.ratingMin, options?.ratingMax);
        const qb = this.listQueryBuilder
            .build(
                Review,
                { ...options },
                {
                    ctx,
                    relations: ['channels'],
                    channelId: ctx.channelId,
                    where: {
                        status: VISIBLE_STATUS,
                        parentId: IsNull(),
                        ...(ratingFilter ? { rating: ratingFilter } : {}),
                    } as any,
                },
            );
        applyHasImagesFilter(qb, options);
        return qb
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /** C 端店铺级统计：当前渠道全店 approved 主评（摘要卡：均分/好评率/分布/标签）。 */
    async getChannelReviewStats(ctx: RequestContext): Promise<ReviewStats> {
        const reviews = await this.connection
            .getRepository(ctx, Review)
            .find({
                where: {
                    channelId: ctx.channelId as number,
                    status: VISIBLE_STATUS,
                    parentId: IsNull(),
                } as any,
            });
        return computeStats(reviews);
    }

    async getMyReviews(ctx: RequestContext): Promise<Review[]> {
        const customer = await this.requireCustomer(ctx);
        return this.connection
            .getRepository(ctx, Review)
            .find({
                where: { customerId: customer.id } as any,
                order: { createdAt: 'DESC' },
            });
    }

    async getReviewFollowUps(ctx: RequestContext, review: Review): Promise<Review[]> {
        return this.connection
            .getRepository(ctx, Review)
            .find({
                where: { parentId: review.id, status: VISIBLE_STATUS } as any,
                order: { createdAt: 'ASC' },
            });
    }

    async getReviewStats(ctx: RequestContext, productId: ID): Promise<ReviewStats> {
        const reviews = await this.connection.getRepository(ctx, Review).find({
            where: { productId: Number(productId), status: VISIBLE_STATUS, parentId: IsNull() } as any,
        });
        return computeStats(reviews);
    }

    async markHelpful(ctx: RequestContext, id: ID): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        review.helpfulCount += 1;
        return this.connection.getRepository(ctx, Review).save(review);
    }

    /** 读取聚合到 Product 自定义字段的评分快照（供列表卡片直接展示，避免全表扫描）。 */
    async getProductRating(ctx: RequestContext, productId: ID): Promise<ProductRating> {
        const product = await this.productService.findOne(ctx, productId);
        if (!product) {
            throw new EntityNotFoundError('Product', productId);
        }
        const cf = (product.customFields ?? {}) as any;
        return {
            rating: cf.reviewRating ?? 0,
            reviewCount: cf.reviewCount ?? 0,
        };
    }

    /** 重算商品评风聚合（approved 主评）并写回 Product.customFields。 */
    async recomputeProductRating(ctx: RequestContext, productId: number): Promise<void> {
        const reviews = await this.connection.getRepository(ctx, Review).find({
            where: { productId, status: VISIBLE_STATUS, parentId: IsNull() } as any,
        });
        const reviewCount = reviews.length;
        const rating =
            reviewCount === 0
                ? 0
                : Math.round(
                      (reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount) * 10,
                  ) / 10;
        const product = await this.productService.findOne(ctx, productId);
        if (!product) return;
        try {
            await this.productService.update(ctx, {
                id: productId,
                customFields: {
                    ...(product.customFields ?? {}),
                    reviewRating: rating,
                    reviewCount,
                } as any,
            });
        } catch (e: any) {
            Logger.error(
                `Failed to recompute rating for product ${productId}: ${e?.message ?? e}`,
                loggerCtx,
            );
        }
    }

    async getCustomerName(ctx: RequestContext, review: Review): Promise<string | null> {
        if (review.isAnonymous) {
            return null;
        }
        const customer = await this.customerService.findOne(ctx, review.customerId as any);
        if (!customer) {
            return null;
        }
        return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.emailAddress;
    }

    /**
     * 渠道评价奖励配置（Channel customFields，未配置 = 不发奖）。
     * 传 giftChoice 时优先取该礼包专属券模板，模板为空回落 reviewGiftCouponTemplateId。
     */
    private async getGiftConfig(
        ctx: RequestContext,
        giftChoice?: string | null,
    ): Promise<{ couponTemplateId: string | null; points: number }> {
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: ctx.channelId } as any });
        const cf = (channel?.customFields ?? {}) as any;
        const points = Number(cf.reviewGiftPoints) || 0;
        const field = giftChoice ? GIFT_COUPON_FIELD[giftChoice] : null;
        const picked = field ? cf[field] : null;
        const templateId = String(picked ?? cf.reviewGiftCouponTemplateId ?? '');
        const couponTemplateId = templateId ? templateId : null;
        return { couponTemplateId, points };
    }

    /** 渠道追评窗口（天；缺省 7，0 = 不允许追评）。 */
    private async getFollowUpWindowDays(ctx: RequestContext): Promise<number> {
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: ctx.channelId } as any });
        const n = Number((channel?.customFields as any)?.reviewFollowUpWindowDays);
        return Number.isFinite(n) && n >= 0 ? n : 7;
    }

    /** 评价有礼：发券/积分（任一成功返回 true）。单侧失败仅告警不阻塞。 */
    private async grantReviewGift(ctx: RequestContext, review: Review): Promise<boolean> {
        let granted = false;
        try {
            const cfg = await this.getGiftConfig(ctx, review.giftChoice);
            if (!cfg.couponTemplateId && cfg.points <= 0) {
                return false;
            }
            if (cfg.couponTemplateId) {
                try {
                    const res = await this.injector
                        .get(CouponService)
                        .grantCouponIssue(ctx, cfg.couponTemplateId as any, [review.customerId as any], false);
                    granted = granted || res?.[0]?.ok === true;
                    if (res?.[0]?.ok !== true) {
                        Logger.warn(
                            `review gift coupon not granted for review ${review.id}: ${res?.[0]?.reason ?? 'unknown'}`,
                            loggerCtx,
                        );
                    }
                } catch (e: any) {
                    Logger.warn(`grantCouponIssue failed for review ${review.id}: ${e?.message ?? e}`, loggerCtx);
                }
            }
            if (cfg.points > 0) {
                try {
                    await this.injector
                        .get(MemberLevelService)
                        .addPoints(ctx, review.customerId as any, cfg.points, null, '评价奖励');
                    granted = true;
                } catch (e: any) {
                    Logger.warn(`addPoints failed for review ${review.id}: ${e?.message ?? e}`, loggerCtx);
                }
            }
        } catch (e: any) {
            Logger.warn(`grantReviewGift failed for review ${review.id}: ${e?.message ?? e}`, loggerCtx);
        }
        return granted;
    }

    /**
     * 校验并归一化礼包选择：非法枚举直接报错；
     * ≤3 星（非好评）或未传 → null（不记录，也不发礼包券）。
     */
    private normalizeGiftChoice(raw: unknown, rating: number): string | null {
        if (raw == null || raw === '') {
            return null;
        }
        const value = String(raw).trim();
        if (!GIFT_CHOICES.includes(value)) {
            throw new UserInputError(`giftChoice must be one of ${GIFT_CHOICES.join('/')}`);
        }
        return rating >= 4 ? value : null;
    }

    private assertContent(content: string): void {
        if (content == null || !content.trim()) {
            throw new UserInputError('content must not be empty');
        }
        const minLength = this.options.minContentLength ?? 0;
        if (minLength > 0 && content.trim().length < minLength) {
            throw new UserInputError(`content must be at least ${minLength} characters`);
        }
    }

    private async requireCustomer(ctx: RequestContext): Promise<any> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedError();
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new EntityNotFoundError('Customer', ctx.activeUserId);
        }
        return customer;
    }
}