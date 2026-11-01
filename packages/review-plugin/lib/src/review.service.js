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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const coupon_plugin_1 = require("@vendure/coupon-plugin");
const member_level_plugin_1 = require("@vendure/member-level-plugin");
const constants_1 = require("./constants");
const review_entity_1 = require("./review.entity");
const review_alert_service_1 = require("./review-alert.service");
const typeorm_1 = require("typeorm");
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
const GIFT_COUPON_FIELD = {
    quality: 'reviewGiftQualityCouponTemplateId',
    service: 'reviewGiftServiceCouponTemplateId',
    time: 'reviewGiftTimeCouponTemplateId',
};
/**
 * 星级档筛选条件：TypeORM 的同一列不能挂两个 FindOperator，故按入参合并为单个。
 * 入参越界（非 1-5 整数）或 min > max 时返回 undefined，即忽略该筛选（不抛错，避免拖垮 C 端列表）。
 */
function buildRatingFilter(min, max) {
    const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= 5;
    const hasMin = inRange(min);
    const hasMax = inRange(max);
    if (hasMin && hasMax)
        return min > max ? undefined : (0, typeorm_1.Between)(min, max);
    if (hasMin)
        return (0, typeorm_1.MoreThanOrEqual)(min);
    if (hasMax)
        return (0, typeorm_1.LessThanOrEqual)(max);
    return undefined;
}
/** simple-json 列「有图」过滤：images 为非空 JSON 数组（PG text 存储口径）。 */
function applyHasImagesFilter(qb, options) {
    if ((options === null || options === void 0 ? void 0 : options.hasImages) === true) {
        qb.andWhere(`("images" IS NOT NULL AND "images" <> '[]')`);
    }
}
/** approved 主评集合 → 统计摘要（商品级与店铺级共用）。 */
function computeStats(reviews) {
    var _a, _b, _c;
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
    const distMap = new Map();
    for (const r of reviews) {
        distMap.set(r.rating, ((_a = distMap.get(r.rating)) !== null && _a !== void 0 ? _a : 0) + 1);
    }
    const ratingDistribution = [1, 2, 3, 4, 5].map(rating => {
        var _a;
        return ({
            rating,
            count: (_a = distMap.get(rating)) !== null && _a !== void 0 ? _a : 0,
        });
    });
    const tagMap = new Map();
    for (const r of reviews) {
        for (const tag of (_b = r.tags) !== null && _b !== void 0 ? _b : []) {
            tagMap.set(tag, ((_c = tagMap.get(tag)) !== null && _c !== void 0 ? _c : 0) + 1);
        }
    }
    const topTags = [...tagMap.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return { totalCount, goodRate, averageRating, ratingDistribution, topTags };
}
let ReviewService = class ReviewService {
    constructor(options = {}, connection, listQueryBuilder, customerService, productService, moduleRef, alertService) {
        this.options = options;
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.customerService = customerService;
        this.productService = productService;
        this.moduleRef = moduleRef;
        this.alertService = alertService;
    }
    /** vendure Injector 由 ModuleRef 惰性构造（跨模块解析 Coupon/MemberLevel 服务，避免循环依赖） */
    get injector() {
        return new core_2.Injector(this.moduleRef);
    }
    async createReview(ctx, input) {
        var _a, _b, _c, _d, _e, _f;
        const customer = await this.requireCustomer(ctx);
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
            throw new core_2.UserInputError('rating must be an integer between 1 and 5');
        }
        this.assertContent(input.content);
        if (!input.orderLineId) {
            throw new core_2.UserInputError('orderLineId is required to create a review');
        }
        const giftChoice = this.normalizeGiftChoice(input.giftChoice, input.rating);
        const orderLineRepo = this.connection.getRepository(ctx, core_2.OrderLine);
        const orderLine = await orderLineRepo.findOne({
            where: { id: Number(input.orderLineId) },
            relations: ['order', 'order.customer'],
        });
        if (!orderLine || !orderLine.order) {
            throw new core_2.EntityNotFoundError('OrderLine', input.orderLineId);
        }
        const order = orderLine.order;
        if (!order.customer || order.customer.id !== customer.id) {
            throw new core_2.ForbiddenError();
        }
        if (!ALLOWED_ORDER_STATES.includes(order.state)) {
            throw new core_2.UserInputError('Order must be delivered before reviewing');
        }
        const reviewRepo = this.connection.getRepository(ctx, review_entity_1.Review);
        const existing = await reviewRepo.findOne({
            where: {
                orderLineId: Number(input.orderLineId),
                customerId: customer.id,
            },
        });
        if (existing) {
            throw new core_2.UserInputError('You have already reviewed this order line');
        }
        const status = this.options.autoApprove ? VISIBLE_STATUS : 'pending';
        const review = new review_entity_1.Review({
            customerId: customer.id,
            productId: Number(input.productId),
            orderLineId: Number(input.orderLineId),
            variantId: input.variantId ? Number(input.variantId) : null,
            rating: input.rating,
            content: input.content.trim(),
            images: (_a = input.images) !== null && _a !== void 0 ? _a : null,
            videos: (_b = input.videos) !== null && _b !== void 0 ? _b : null,
            tags: (_c = input.tags) !== null && _c !== void 0 ? _c : null,
            isAnonymous: (_d = input.isAnonymous) !== null && _d !== void 0 ? _d : false,
            status,
            channelId: ctx.channelId,
            giftChoice,
        });
        review.channels = [ctx.channel];
        const saved = await reviewRepo.save(review);
        // P4-2 品质闭环：差评落库即预警（不等审核），失败不影响评价主流程
        try {
            await ((_e = this.alertService) === null || _e === void 0 ? void 0 : _e.recordFromReview(ctx, saved));
        }
        catch (e) {
            core_2.Logger.warn(`review alert failed for review ${saved.id}: ${(_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : e}`, constants_1.loggerCtx);
        }
        if (status === VISIBLE_STATUS) {
            await this.recomputeProductRating(ctx, Number(input.productId));
        }
        core_2.Logger.info(`Review created by customer ${customer.id} for product ${input.productId}`, constants_1.loggerCtx);
        return saved;
    }
    /** 追评：挂在本人主评（parentId）下，聚合不计入；仅 approved 主评且在追评窗口内。 */
    async createFollowUpReview(ctx, reviewId, input) {
        var _a, _b, _c, _d, _e, _f, _g;
        const customer = await this.requireCustomer(ctx);
        const reviewRepo = this.connection.getRepository(ctx, review_entity_1.Review);
        const parent = await reviewRepo.findOne({ where: { id: Number(reviewId) } });
        if (!parent) {
            throw new core_2.EntityNotFoundError('Review', reviewId);
        }
        if (parent.customerId !== customer.id) {
            throw new core_2.ForbiddenError();
        }
        if (parent.status === DELETED_STATUS) {
            throw new core_2.UserInputError('Cannot add a follow-up to a deleted review');
        }
        if (parent.parentId != null) {
            throw new core_2.UserInputError('Cannot add a follow-up to a follow-up');
        }
        if (parent.status !== VISIBLE_STATUS) {
            throw new core_2.UserInputError('主评价通过审核后才能追评');
        }
        const windowDays = await this.getFollowUpWindowDays(ctx);
        if (windowDays <= 0) {
            throw new core_2.UserInputError('当前店铺未开放追评');
        }
        const base = (_a = parent.reviewedAt) !== null && _a !== void 0 ? _a : parent.createdAt;
        if (base && Date.now() - new Date(base).getTime() > windowDays * 86400000) {
            throw new core_2.UserInputError(`已超过追评窗口（审核通过后 ${windowDays} 天内可追评）`);
        }
        if (input.content != null) {
            this.assertContent(input.content);
        }
        if (input.rating != null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
            throw new core_2.UserInputError('rating must be an integer between 1 and 5');
        }
        const followUp = new review_entity_1.Review({
            customerId: customer.id,
            productId: parent.productId,
            orderLineId: parent.orderLineId,
            variantId: parent.variantId,
            rating: (_b = input.rating) !== null && _b !== void 0 ? _b : parent.rating,
            content: ((_c = input.content) !== null && _c !== void 0 ? _c : '').trim(),
            images: (_d = input.images) !== null && _d !== void 0 ? _d : null,
            videos: (_e = input.videos) !== null && _e !== void 0 ? _e : null,
            tags: (_f = input.tags) !== null && _f !== void 0 ? _f : null,
            isAnonymous: (_g = input.isAnonymous) !== null && _g !== void 0 ? _g : parent.isAnonymous,
            status: this.options.autoApprove ? VISIBLE_STATUS : 'pending',
            parentId: parent.id,
            channelId: ctx.channelId,
        });
        followUp.channels = [ctx.channel];
        return reviewRepo.save(followUp);
    }
    /** 修改本人评价：仅 pending/approved 可改；变更涉及已审核主评时重算评分聚合。 */
    async updateReview(ctx, id, input) {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        if (review.customerId !== customer.id) {
            throw new core_2.ForbiddenError();
        }
        if (review.status !== 'pending' && review.status !== VISIBLE_STATUS) {
            throw new core_2.UserInputError('Only pending or approved reviews can be updated');
        }
        if (input.content != null) {
            this.assertContent(input.content);
            review.content = input.content.trim();
        }
        if (input.rating != null) {
            if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
                throw new core_2.UserInputError('rating must be an integer between 1 and 5');
            }
            // 追评无独立评分聚合，改评风仅主评生效
            if (!review.parentId) {
                review.rating = input.rating;
            }
        }
        if (input.images !== undefined)
            review.images = input.images;
        if (input.videos !== undefined)
            review.videos = input.videos;
        if (input.tags !== undefined)
            review.tags = input.tags;
        if (input.isAnonymous !== undefined)
            review.isAnonymous = input.isAnonymous;
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return saved;
    }
    /** 删除本人评价（软删）。已审核主评删除后剔除聚合。 */
    async deleteReview(ctx, id) {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        if (review.customerId !== customer.id) {
            throw new core_2.ForbiddenError();
        }
        if (review.status === DELETED_STATUS) {
            return true;
        }
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.status = DELETED_STATUS;
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return true;
    }
    async replyReview(ctx, id, reply) {
        if (!reply || !reply.trim()) {
            throw new core_2.UserInputError('reply must not be empty');
        }
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        review.reply = reply;
        review.repliedAt = new Date();
        return this.connection.getRepository(ctx, review_entity_1.Review).save(review);
    }
    async approveReview(ctx, id) {
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        const wasVisible = review.status === VISIBLE_STATUS;
        review.status = VISIBLE_STATUS;
        review.reviewedAt = new Date();
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        if (!review.parentId) {
            await this.recomputeProductRating(ctx, saved.productId);
            if (!wasVisible && !review.giftGranted) {
                // 评价有礼：发奖成功则回写 giftGranted（幂等闸），失败不阻塞审核流转
                const granted = await this.grantReviewGift(ctx, review);
                if (granted) {
                    review.giftGranted = true;
                    return this.connection.getRepository(ctx, review_entity_1.Review).save(review);
                }
            }
        }
        return saved;
    }
    async rejectReview(ctx, id) {
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.status = 'rejected';
        review.reviewedAt = new Date();
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        return saved;
    }
    async getReview(ctx, id) {
        return this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
    }
    // ---------------- 差评申诉（P0-4） ----------------
    /**
     * 顾客对本人差评（1-3 星）发起申诉，诉求为隐藏该评价（内容有误 / 与商家已协商一致等）。
     * 同一评价同时只允许一条待审核申诉；追评与已删除评价不可申诉。
     */
    async appealReview(ctx, reviewId, reason, images) {
        const customer = await this.requireCustomer(ctx);
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, reviewId);
        if (review.customerId !== customer.id) {
            throw new core_2.ForbiddenError();
        }
        if (review.parentId) {
            throw new core_2.UserInputError('追评不支持申诉');
        }
        if (review.rating > APPEALABLE_MAX_RATING) {
            throw new core_2.UserInputError(`仅 ${APPEALABLE_MAX_RATING} 星及以下差评可申诉`);
        }
        if (review.status === DELETED_STATUS) {
            throw new core_2.UserInputError('已删除的评价不可申诉');
        }
        if (review.appealStatus === 'pending') {
            throw new core_2.UserInputError('申诉已提交，请等待审核');
        }
        if (review.appealStatus === 'approved') {
            throw new core_2.UserInputError('该评价已申诉通过并隐藏');
        }
        const text = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!text) {
            throw new core_2.UserInputError('请填写申诉理由');
        }
        if (text.length > MAX_APPEAL_REASON) {
            throw new core_2.UserInputError(`申诉理由不能超过 ${MAX_APPEAL_REASON} 个字符`);
        }
        const imgs = (images !== null && images !== void 0 ? images : []).map(v => String(v !== null && v !== void 0 ? v : '').trim()).filter(Boolean);
        if (imgs.length > MAX_APPEAL_IMAGES) {
            throw new core_2.UserInputError(`最多上传 ${MAX_APPEAL_IMAGES} 张图片`);
        }
        review.appealStatus = 'pending';
        review.appealReason = text;
        review.appealImages = imgs.length ? imgs : null;
        review.appealAt = new Date();
        review.appealResult = null;
        review.appealReviewedBy = null;
        review.appealReviewedAt = null;
        return this.connection.getRepository(ctx, review_entity_1.Review).save(review);
    }
    /** 后台申诉列表：status 为申诉状态（pending/approved/rejected），缺省列出全部有申诉记录的评价。 */
    async getReviewAppeals(ctx, options) {
        var _a;
        if ((options === null || options === void 0 ? void 0 : options.status) && !APPEAL_STATUSES.includes(options.status)) {
            throw new core_2.UserInputError('申诉状态不合法');
        }
        return this.listQueryBuilder
            .build(review_entity_1.Review, options, {
            ctx,
            relations: ['channels'],
            channelId: ctx.channelId,
            where: {
                appealStatus: (_a = options === null || options === void 0 ? void 0 : options.status) !== null && _a !== void 0 ? _a : (0, typeorm_1.Not)((0, typeorm_1.IsNull)()),
            },
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    /** 申诉审核通过：评价被隐藏（退出展示与评分聚合），结果与审核人留痕。 */
    async approveReviewAppeal(ctx, id, note) {
        var _a;
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        if (review.appealStatus !== 'pending') {
            throw new core_2.UserInputError('该申诉已处理');
        }
        const wasApprovedRoot = review.status === VISIBLE_STATUS && !review.parentId;
        review.appealStatus = 'approved';
        review.appealResult = String(note !== null && note !== void 0 ? note : '').trim() || null;
        review.appealReviewedBy = String((_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : '');
        review.appealReviewedAt = new Date();
        review.status = HIDDEN_STATUS;
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        core_2.Logger.info(`Review appeal approved for review ${review.id}`, constants_1.loggerCtx);
        return saved;
    }
    /** 申诉驳回：评价维持原状，仅记录审核说明留痕。 */
    async rejectReviewAppeal(ctx, id, note) {
        var _a;
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        if (review.appealStatus !== 'pending') {
            throw new core_2.UserInputError('该申诉已处理');
        }
        review.appealStatus = 'rejected';
        review.appealResult = String(note !== null && note !== void 0 ? note : '').trim() || null;
        review.appealReviewedBy = String((_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : '');
        review.appealReviewedAt = new Date();
        return this.connection.getRepository(ctx, review_entity_1.Review).save(review);
    }
    /**
     * 撤销申诉通过（人工纠错）：把已隐藏的评价恢复展示并重新计入评分聚合，
     * 申诉状态回退为 rejected，撤销原因与操作人追加到留痕字段。
     */
    async revokeReviewAppeal(ctx, id, note) {
        var _a, _b;
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        if (review.appealStatus !== 'approved') {
            throw new core_2.UserInputError('仅已通过的申诉可撤销');
        }
        if (review.status !== HIDDEN_STATUS) {
            throw new core_2.UserInputError('评价当前不是隐藏态，无需撤销');
        }
        const reason = String(note !== null && note !== void 0 ? note : '').trim();
        if (!reason) {
            throw new core_2.UserInputError('请填写撤销原因');
        }
        if (reason.length > MAX_APPEAL_REASON) {
            throw new core_2.UserInputError(`撤销原因不能超过 ${MAX_APPEAL_REASON} 个字符`);
        }
        // 去掉末尾标点，避免与拼接分隔符「；」重复（如「…评价隐藏。；撤销通过：…」）
        const prev = String((_a = review.appealResult) !== null && _a !== void 0 ? _a : '').trim().replace(/[；;。，,]+$/u, '');
        review.appealStatus = 'rejected';
        review.appealResult = `${prev ? `${prev}；` : ''}撤销通过：${reason}`;
        review.appealReviewedBy = String((_b = ctx.activeUserId) !== null && _b !== void 0 ? _b : '');
        review.appealReviewedAt = new Date();
        review.status = VISIBLE_STATUS;
        const saved = await this.connection.getRepository(ctx, review_entity_1.Review).save(review);
        // 追评不进评分聚合，仅主评恢复展示时重算
        if (!saved.parentId) {
            await this.recomputeProductRating(ctx, saved.productId);
        }
        core_2.Logger.info(`Review appeal revoked for review ${review.id}`, constants_1.loggerCtx);
        return saved;
    }
    async getReviews(ctx, options) {
        const where = {};
        if ((options === null || options === void 0 ? void 0 : options.productId) != null) {
            where.productId = Number(options.productId);
        }
        if ((options === null || options === void 0 ? void 0 : options.status) != null) {
            where.status = options.status;
        }
        return this.listQueryBuilder
            .build(review_entity_1.Review, options, {
            ctx,
            relations: ['channels'],
            channelId: ctx.channelId,
            where,
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    /** C 端商品列表：仅对外可见（approved）的主评 + 追评（followUps 由 ResolveField 加载）。 */
    async getProductReviews(ctx, productId, options) {
        const ratingFilter = buildRatingFilter(options === null || options === void 0 ? void 0 : options.ratingMin, options === null || options === void 0 ? void 0 : options.ratingMax);
        const qb = this.listQueryBuilder
            .build(review_entity_1.Review, Object.assign({}, options), {
            ctx,
            relations: ['channels'],
            channelId: ctx.channelId,
            where: Object.assign({ productId: Number(productId), status: VISIBLE_STATUS, parentId: (0, typeorm_1.IsNull)() }, (ratingFilter ? { rating: ratingFilter } : {})),
        });
        applyHasImagesFilter(qb, options);
        return qb
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    /** C 端店铺级评论流：当前渠道全部 approved 主评（menu 评论 tab 数据源）。 */
    async getChannelReviews(ctx, options) {
        const ratingFilter = buildRatingFilter(options === null || options === void 0 ? void 0 : options.ratingMin, options === null || options === void 0 ? void 0 : options.ratingMax);
        const qb = this.listQueryBuilder
            .build(review_entity_1.Review, Object.assign({}, options), {
            ctx,
            relations: ['channels'],
            channelId: ctx.channelId,
            where: Object.assign({ status: VISIBLE_STATUS, parentId: (0, typeorm_1.IsNull)() }, (ratingFilter ? { rating: ratingFilter } : {})),
        });
        applyHasImagesFilter(qb, options);
        return qb
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    /** C 端店铺级统计：当前渠道全店 approved 主评（摘要卡：均分/好评率/分布/标签）。 */
    async getChannelReviewStats(ctx) {
        const reviews = await this.connection
            .getRepository(ctx, review_entity_1.Review)
            .find({
            where: {
                channelId: ctx.channelId,
                status: VISIBLE_STATUS,
                parentId: (0, typeorm_1.IsNull)(),
            },
        });
        return computeStats(reviews);
    }
    async getMyReviews(ctx) {
        const customer = await this.requireCustomer(ctx);
        return this.connection
            .getRepository(ctx, review_entity_1.Review)
            .find({
            where: { customerId: customer.id },
            order: { createdAt: 'DESC' },
        });
    }
    async getReviewFollowUps(ctx, review) {
        return this.connection
            .getRepository(ctx, review_entity_1.Review)
            .find({
            where: { parentId: review.id, status: VISIBLE_STATUS },
            order: { createdAt: 'ASC' },
        });
    }
    async getReviewStats(ctx, productId) {
        const reviews = await this.connection.getRepository(ctx, review_entity_1.Review).find({
            where: { productId: Number(productId), status: VISIBLE_STATUS, parentId: (0, typeorm_1.IsNull)() },
        });
        return computeStats(reviews);
    }
    async markHelpful(ctx, id) {
        const review = await this.connection.getEntityOrThrow(ctx, review_entity_1.Review, id);
        review.helpfulCount += 1;
        return this.connection.getRepository(ctx, review_entity_1.Review).save(review);
    }
    /** 读取聚合到 Product 自定义字段的评分快照（供列表卡片直接展示，避免全表扫描）。 */
    async getProductRating(ctx, productId) {
        var _a, _b, _c;
        const product = await this.productService.findOne(ctx, productId);
        if (!product) {
            throw new core_2.EntityNotFoundError('Product', productId);
        }
        const cf = ((_a = product.customFields) !== null && _a !== void 0 ? _a : {});
        return {
            rating: (_b = cf.reviewRating) !== null && _b !== void 0 ? _b : 0,
            reviewCount: (_c = cf.reviewCount) !== null && _c !== void 0 ? _c : 0,
        };
    }
    /** 重算商品评风聚合（approved 主评）并写回 Product.customFields。 */
    async recomputeProductRating(ctx, productId) {
        var _a, _b;
        const reviews = await this.connection.getRepository(ctx, review_entity_1.Review).find({
            where: { productId, status: VISIBLE_STATUS, parentId: (0, typeorm_1.IsNull)() },
        });
        const reviewCount = reviews.length;
        const rating = reviewCount === 0
            ? 0
            : Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount) * 10) / 10;
        const product = await this.productService.findOne(ctx, productId);
        if (!product)
            return;
        try {
            await this.productService.update(ctx, {
                id: productId,
                customFields: Object.assign(Object.assign({}, ((_a = product.customFields) !== null && _a !== void 0 ? _a : {})), { reviewRating: rating, reviewCount }),
            });
        }
        catch (e) {
            core_2.Logger.error(`Failed to recompute rating for product ${productId}: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, constants_1.loggerCtx);
        }
    }
    async getCustomerName(ctx, review) {
        if (review.isAnonymous) {
            return null;
        }
        const customer = await this.customerService.findOne(ctx, review.customerId);
        if (!customer) {
            return null;
        }
        return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.emailAddress;
    }
    /**
     * 渠道评价奖励配置（Channel customFields，未配置 = 不发奖）。
     * 传 giftChoice 时优先取该礼包专属券模板，模板为空回落 reviewGiftCouponTemplateId。
     */
    async getGiftConfig(ctx, giftChoice) {
        var _a, _b;
        const channel = await this.connection
            .getRepository(ctx, core_2.Channel)
            .findOne({ where: { id: ctx.channelId } });
        const cf = ((_a = channel === null || channel === void 0 ? void 0 : channel.customFields) !== null && _a !== void 0 ? _a : {});
        const points = Number(cf.reviewGiftPoints) || 0;
        const field = giftChoice ? GIFT_COUPON_FIELD[giftChoice] : null;
        const picked = field ? cf[field] : null;
        const templateId = String((_b = picked !== null && picked !== void 0 ? picked : cf.reviewGiftCouponTemplateId) !== null && _b !== void 0 ? _b : '');
        const couponTemplateId = templateId ? templateId : null;
        return { couponTemplateId, points };
    }
    /** 渠道追评窗口（天；缺省 7，0 = 不允许追评）。 */
    async getFollowUpWindowDays(ctx) {
        var _a;
        const channel = await this.connection
            .getRepository(ctx, core_2.Channel)
            .findOne({ where: { id: ctx.channelId } });
        const n = Number((_a = channel === null || channel === void 0 ? void 0 : channel.customFields) === null || _a === void 0 ? void 0 : _a.reviewFollowUpWindowDays);
        return Number.isFinite(n) && n >= 0 ? n : 7;
    }
    /** 评价有礼：发券/积分（任一成功返回 true）。单侧失败仅告警不阻塞。 */
    async grantReviewGift(ctx, review) {
        var _a, _b, _c, _d, _e, _f, _g;
        let granted = false;
        try {
            const cfg = await this.getGiftConfig(ctx, review.giftChoice);
            if (!cfg.couponTemplateId && cfg.points <= 0) {
                return false;
            }
            if (cfg.couponTemplateId) {
                try {
                    const res = await this.injector
                        .get(coupon_plugin_1.CouponService)
                        .grantCouponIssue(ctx, cfg.couponTemplateId, [review.customerId], false);
                    granted = granted || ((_a = res === null || res === void 0 ? void 0 : res[0]) === null || _a === void 0 ? void 0 : _a.ok) === true;
                    if (((_b = res === null || res === void 0 ? void 0 : res[0]) === null || _b === void 0 ? void 0 : _b.ok) !== true) {
                        core_2.Logger.warn(`review gift coupon not granted for review ${review.id}: ${(_d = (_c = res === null || res === void 0 ? void 0 : res[0]) === null || _c === void 0 ? void 0 : _c.reason) !== null && _d !== void 0 ? _d : 'unknown'}`, constants_1.loggerCtx);
                    }
                }
                catch (e) {
                    core_2.Logger.warn(`grantCouponIssue failed for review ${review.id}: ${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`, constants_1.loggerCtx);
                }
            }
            if (cfg.points > 0) {
                try {
                    await this.injector
                        .get(member_level_plugin_1.MemberLevelService)
                        .addPoints(ctx, review.customerId, cfg.points, null, '评价奖励');
                    granted = true;
                }
                catch (e) {
                    core_2.Logger.warn(`addPoints failed for review ${review.id}: ${(_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : e}`, constants_1.loggerCtx);
                }
            }
        }
        catch (e) {
            core_2.Logger.warn(`grantReviewGift failed for review ${review.id}: ${(_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : e}`, constants_1.loggerCtx);
        }
        return granted;
    }
    /**
     * 校验并归一化礼包选择：非法枚举直接报错；
     * ≤3 星（非好评）或未传 → null（不记录，也不发礼包券）。
     */
    normalizeGiftChoice(raw, rating) {
        if (raw == null || raw === '') {
            return null;
        }
        const value = String(raw).trim();
        if (!GIFT_CHOICES.includes(value)) {
            throw new core_2.UserInputError(`giftChoice must be one of ${GIFT_CHOICES.join('/')}`);
        }
        return rating >= 4 ? value : null;
    }
    assertContent(content) {
        var _a;
        if (content == null || !content.trim()) {
            throw new core_2.UserInputError('content must not be empty');
        }
        const minLength = (_a = this.options.minContentLength) !== null && _a !== void 0 ? _a : 0;
        if (minLength > 0 && content.trim().length < minLength) {
            throw new core_2.UserInputError(`content must be at least ${minLength} characters`);
        }
    }
    async requireCustomer(ctx) {
        if (!ctx.activeUserId) {
            throw new core_2.UnauthorizedError();
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new core_2.EntityNotFoundError('Customer', ctx.activeUserId);
        }
        return customer;
    }
};
exports.ReviewService = ReviewService;
exports.ReviewService = ReviewService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(constants_1.REVIEW_PLUGIN_OPTIONS)),
    __param(5, (0, common_1.Optional)()),
    __param(6, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [Object, core_2.TransactionalConnection,
        core_2.ListQueryBuilder,
        core_2.CustomerService,
        core_2.ProductService,
        core_1.ModuleRef,
        review_alert_service_1.ReviewAlertService])
], ReviewService);
//# sourceMappingURL=review.service.js.map