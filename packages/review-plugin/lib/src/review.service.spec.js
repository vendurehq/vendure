"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@vendure/core");
const coupon_plugin_1 = require("@vendure/coupon-plugin");
const review_entity_1 = require("./review.entity");
const review_service_1 = require("./review.service");
/**
 * 店铺级评论流/统计（三期评价系统）单测：
 * channelReviews 渠道隔离 + approved 主评 + hasImages 过滤；
 * channelReviewStats 统计口径与空态结构。
 */
function makeService(opts = {}) {
    var _a, _b;
    const andWhere = vitest_1.vi.fn().mockReturnThis();
    const qb = {
        andWhere,
        getManyAndCount: vitest_1.vi.fn().mockResolvedValue((_a = opts.qbResult) !== null && _a !== void 0 ? _a : [[], 0]),
    };
    const listQueryBuilder = { build: vitest_1.vi.fn().mockReturnValue(qb) };
    const connection = {
        getRepository: vitest_1.vi.fn().mockReturnValue({ find: vitest_1.vi.fn().mockResolvedValue((_b = opts.findResult) !== null && _b !== void 0 ? _b : []) }),
    };
    const svc = new review_service_1.ReviewService({}, connection, listQueryBuilder, {}, {});
    return { svc, listQueryBuilder, qb, andWhere, connection };
}
function review(partial) {
    return new review_entity_1.Review(Object.assign({ rating: 5, status: 'approved', parentId: null, tags: null }, partial));
}
const CTX = { channelId: 113 };
(0, vitest_1.describe)('ReviewService.getChannelReviews', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('按渠道过滤 + approved 主评约束传入 listQueryBuilder', async () => {
        const { svc, listQueryBuilder } = makeService();
        await svc.getChannelReviews(CTX, { take: 10 });
        (0, vitest_1.expect)(listQueryBuilder.build).toHaveBeenCalledWith(review_entity_1.Review, { take: 10 }, vitest_1.expect.anything());
        const where = listQueryBuilder.build.mock.calls[0][2].where;
        (0, vitest_1.expect)(where.channelId).toBeUndefined();
        (0, vitest_1.expect)(where.status).toBe('approved');
        (0, vitest_1.expect)(where.parentId).toBeDefined();
        (0, vitest_1.expect)(where.rating).toBeUndefined();
    });
    (0, vitest_1.it)('hasImages=true 附加非空数组 SQL 过滤', async () => {
        const { svc, andWhere } = makeService();
        await svc.getChannelReviews(CTX, { hasImages: true });
        (0, vitest_1.expect)(andWhere).toHaveBeenCalledWith(`("images" IS NOT NULL AND "images" <> '[]')`);
    });
    (0, vitest_1.it)('hasImages 缺省/false 不附加过滤', async () => {
        const { svc, andWhere } = makeService();
        await svc.getChannelReviews(CTX, {});
        (0, vitest_1.expect)(andWhere).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('ratingMin/ratingMax 合并为单个 FindOperator 传入 where', async () => {
        const { svc, listQueryBuilder } = makeService();
        await svc.getChannelReviews(CTX, { ratingMin: 4 });
        const where = listQueryBuilder.build.mock.calls[0][2].where;
        (0, vitest_1.expect)(where.rating).toBeDefined();
        (0, vitest_1.expect)(where.rating.value).toBe(4);
    });
});
(0, vitest_1.describe)('ReviewService.getChannelReviewStats', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('按 channelId 查询并正确聚合（均分/好评率/分布/标签）', async () => {
        var _a, _b;
        const { svc, connection } = makeService({
            findResult: [
                review({ rating: 5, tags: ['口味赞', '分量足'] }),
                review({ rating: 4, tags: ['口味赞'] }),
                review({ rating: 2, tags: [] }),
            ],
        });
        const stats = await svc.getChannelReviewStats(CTX);
        const findArgs = connection.getRepository().find.mock.calls[0][0];
        (0, vitest_1.expect)(findArgs.where.channelId).toBe(113);
        (0, vitest_1.expect)(findArgs.where.status).toBe('approved');
        (0, vitest_1.expect)(findArgs.where.parentId).toBeDefined();
        (0, vitest_1.expect)(stats.totalCount).toBe(3);
        (0, vitest_1.expect)(stats.averageRating).toBe(3.7);
        (0, vitest_1.expect)(stats.goodRate).toBe(66.7);
        (0, vitest_1.expect)((_a = stats.ratingDistribution.find(d => d.rating === 5)) === null || _a === void 0 ? void 0 : _a.count).toBe(1);
        (0, vitest_1.expect)((_b = stats.ratingDistribution.find(d => d.rating === 2)) === null || _b === void 0 ? void 0 : _b.count).toBe(1);
        (0, vitest_1.expect)(stats.topTags[0]).toEqual({ tag: '口味赞', count: 2 });
    });
    (0, vitest_1.it)('无评价 → 零值结构（分布含全 5 档）', async () => {
        const { svc } = makeService({ findResult: [] });
        const stats = await svc.getChannelReviewStats(CTX);
        (0, vitest_1.expect)(stats.totalCount).toBe(0);
        (0, vitest_1.expect)(stats.averageRating).toBe(0);
        (0, vitest_1.expect)(stats.ratingDistribution).toHaveLength(5);
        (0, vitest_1.expect)(stats.topTags).toEqual([]);
    });
});
(0, vitest_1.describe)('ReviewService.getProductReviews hasImages', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('hasImages=true 同样生效且保留 productId 约束', async () => {
        const { svc, andWhere, listQueryBuilder } = makeService();
        await svc.getProductReviews(CTX, '42', { hasImages: true });
        (0, vitest_1.expect)(listQueryBuilder.build.mock.calls[0][2].where.productId).toBe(42);
        (0, vitest_1.expect)(andWhere).toHaveBeenCalledWith(`("images" IS NOT NULL AND "images" <> '[]')`);
    });
});
// ── 四期 Task 7：评价有礼（approveReview 奖励钩子） ──
const gift = vitest_1.vi.hoisted(() => ({
    coupon: { grantCouponIssue: vitest_1.vi.fn() },
    points: { addPoints: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('@vendure/coupon-plugin', () => ({ CouponService: class CouponServiceMock {
    } }));
vitest_1.vi.mock('@vendure/member-level-plugin', () => ({ MemberLevelService: class MemberLevelServiceMock {
    } }));
function makeGiftService(channelCf, reviewRow) {
    const reviewRepo = {
        save: vitest_1.vi.fn().mockImplementation(async (r) => (Object.assign({}, r))),
        update: vitest_1.vi.fn().mockResolvedValue({}),
        find: vitest_1.vi.fn().mockResolvedValue([]),
    };
    const channelRepo = { findOne: vitest_1.vi.fn().mockResolvedValue({ id: CTX.channelId, customFields: channelCf }) };
    const connection = {
        getEntityOrThrow: vitest_1.vi.fn().mockResolvedValue(new review_entity_1.Review(reviewRow)),
        getRepository: vitest_1.vi.fn((_ctx, entity) => (entity === core_1.Channel ? channelRepo : reviewRepo)),
    };
    const moduleRef = {
        get: vitest_1.vi.fn((token) => (token === coupon_plugin_1.CouponService ? gift.coupon : gift.points)),
    };
    const productService = { findOne: vitest_1.vi.fn().mockResolvedValue(null) };
    const svc = new review_service_1.ReviewService({}, connection, {}, {}, productService, moduleRef);
    return { svc, reviewRepo, channelRepo };
}
(0, vitest_1.describe)('ReviewService.approveReview 评价有礼', () => {
    (0, vitest_1.beforeEach)(() => {
        gift.coupon.grantCouponIssue.mockReset();
        gift.points.addPoints.mockReset();
    });
    (0, vitest_1.it)('主评审核通过且渠道配置开启 → 发券+积分，giftGranted=true 并留痕 reviewedAt', async () => {
        gift.coupon.grantCouponIssue.mockResolvedValue([{ customerId: 9, ok: true, code: 'C1', reason: null }]);
        gift.points.addPoints.mockResolvedValue(10);
        const { svc, reviewRepo } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 10, reviewFollowUpWindowDays: 7 }, { id: 1, status: 'pending', parentId: null, giftGranted: false, customerId: 9, productId: 42 });
        const saved = await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).toHaveBeenCalledWith(CTX, 'T9', [9], false);
        (0, vitest_1.expect)(gift.points.addPoints).toHaveBeenCalledWith(CTX, 9, 10, null, '评价奖励');
        (0, vitest_1.expect)(saved.status).toBe('approved');
        (0, vitest_1.expect)(saved.giftGranted).toBe(true);
        (0, vitest_1.expect)(saved.reviewedAt).toBeTruthy();
        (0, vitest_1.expect)(reviewRepo.save).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('重复 approve（状态已 approved）→ 状态闸生效不再发奖', async () => {
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 10 }, { id: 1, status: 'approved', parentId: null, giftGranted: false, customerId: 9, productId: 42 });
        await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gift.points.addPoints).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('giftGranted=true 幂等闸 → 不再发奖', async () => {
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 10 }, { id: 1, status: 'pending', parentId: null, giftGranted: true, customerId: 9, productId: 42 });
        await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gift.points.addPoints).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('未配置奖励（无模板/积分为 0）→ 只流转状态不发奖不置 giftGranted', async () => {
        const { svc, reviewRepo } = makeGiftService({ reviewGiftCouponTemplateId: null, reviewGiftPoints: 0 }, { id: 1, status: 'pending', parentId: null, customerId: 9, productId: 42 });
        const saved = await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gift.points.addPoints).not.toHaveBeenCalled();
        (0, vitest_1.expect)(saved.status).toBe('approved');
        (0, vitest_1.expect)(saved.giftGranted).toBeFalsy();
        (0, vitest_1.expect)(reviewRepo.save).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('追评 approve 不发奖（仅流转+留痕）', async () => {
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 10 }, { id: 2, status: 'pending', parentId: 5, customerId: 9, productId: 42 });
        const saved = await svc.approveReview(CTX, '2');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).not.toHaveBeenCalled();
        (0, vitest_1.expect)(gift.points.addPoints).not.toHaveBeenCalled();
        (0, vitest_1.expect)(saved.status).toBe('approved');
        (0, vitest_1.expect)(saved.reviewedAt).toBeTruthy();
    });
    (0, vitest_1.it)('发奖抛错不阻塞审核流转（giftGranted 不置，便于重试）', async () => {
        gift.coupon.grantCouponIssue.mockRejectedValue(new Error('tpl missing'));
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 0 }, { id: 1, status: 'pending', parentId: null, customerId: 9, productId: 42 });
        const saved = await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(saved.status).toBe('approved');
        (0, vitest_1.expect)(saved.giftGranted).toBeFalsy();
    });
    // §114：好评送礼闭环——按顾客所选礼包取专属券模板
    (0, vitest_1.it)('礼包「质量」有专属模板 → 发该模板券（不落通用模板）', async () => {
        gift.coupon.grantCouponIssue.mockResolvedValue([{ customerId: 9, ok: true, code: 'CQ', reason: null }]);
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftQualityCouponTemplateId: 'TQ', reviewGiftPoints: 0 }, { id: 1, status: 'pending', parentId: null, customerId: 9, productId: 42, giftChoice: 'quality' });
        const saved = await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).toHaveBeenCalledWith(CTX, 'TQ', [9], false);
        (0, vitest_1.expect)(saved.giftGranted).toBe(true);
    });
    (0, vitest_1.it)('礼包专属模板为空 → 回落通用奖励券模板', async () => {
        gift.coupon.grantCouponIssue.mockResolvedValue([{ customerId: 9, ok: true, code: 'C9', reason: null }]);
        const { svc } = makeGiftService({ reviewGiftCouponTemplateId: 'T9', reviewGiftPoints: 0 }, { id: 1, status: 'pending', parentId: null, customerId: 9, productId: 42, giftChoice: 'service' });
        await svc.approveReview(CTX, '1');
        (0, vitest_1.expect)(gift.coupon.grantCouponIssue).toHaveBeenCalledWith(CTX, 'T9', [9], false);
    });
});
// ── 四期 Task 8：追评窗口校验 ──
const FOLLOW_CTX = { channelId: 113, activeUserId: 77 };
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
function makeFollowService(parentRow, channelCf = { reviewFollowUpWindowDays: 7 }) {
    const reviewRepo = {
        findOne: vitest_1.vi.fn().mockResolvedValue(parentRow ? new review_entity_1.Review(parentRow) : null),
        save: vitest_1.vi.fn().mockImplementation(async (r) => (Object.assign({}, r))),
    };
    const channelRepo = { findOne: vitest_1.vi.fn().mockResolvedValue({ id: FOLLOW_CTX.channelId, customFields: channelCf }) };
    const connection = {
        getRepository: vitest_1.vi.fn((_ctx, entity) => (entity === core_1.Channel ? channelRepo : reviewRepo)),
    };
    const customerService = { findOneByUserId: vitest_1.vi.fn().mockResolvedValue({ id: 9 }) };
    const svc = new review_service_1.ReviewService({}, connection, {}, customerService, {}, { get: vitest_1.vi.fn() });
    return { svc, reviewRepo };
}
(0, vitest_1.describe)('ReviewService.createFollowUpReview 追评窗口', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('主评 approved 且窗口内 → 追评成功（pending，挂主评）', async () => {
        const { svc } = makeFollowService({
            id: 1, customerId: 9, status: 'approved', parentId: null,
            reviewedAt: daysAgo(2), productId: 42, rating: 5, isAnonymous: false,
        });
        const fu = await svc.createFollowUpReview(FOLLOW_CTX, '1', { content: '补充：吃了一周还想吃' });
        (0, vitest_1.expect)(fu.parentId).toBe(1);
        (0, vitest_1.expect)(fu.status).toBe('pending');
    });
    (0, vitest_1.it)('窗口外（reviewedAt 10 天前，窗口 7 天）→ 抛错', async () => {
        const { svc } = makeFollowService({
            id: 1, customerId: 9, status: 'approved', parentId: null,
            reviewedAt: daysAgo(10), productId: 42, rating: 5,
        });
        await (0, vitest_1.expect)(svc.createFollowUpReview(FOLLOW_CTX, '1', { content: '迟到追评' })).rejects.toThrow(/追评窗口/);
    });
    (0, vitest_1.it)('历史主评无 reviewedAt → 回退 createdAt 判窗', async () => {
        const { svc } = makeFollowService({
            id: 1, customerId: 9, status: 'approved', parentId: null,
            createdAt: daysAgo(2), productId: 42, rating: 5,
        });
        const fu = await svc.createFollowUpReview(FOLLOW_CTX, '1', { content: '历史数据也能追' });
        (0, vitest_1.expect)(fu.parentId).toBe(1);
    });
    (0, vitest_1.it)('渠道窗口配置 0 → 未开放追评', async () => {
        const { svc } = makeFollowService({ id: 1, customerId: 9, status: 'approved', parentId: null, reviewedAt: daysAgo(0), productId: 42, rating: 5 }, { reviewFollowUpWindowDays: 0 });
        await (0, vitest_1.expect)(svc.createFollowUpReview(FOLLOW_CTX, '1', { content: 'x' })).rejects.toThrow(/未开放/);
    });
    (0, vitest_1.it)('追评的追评 → 抛错', async () => {
        const { svc } = makeFollowService({
            id: 3, customerId: 9, status: 'approved', parentId: 1,
            reviewedAt: daysAgo(1), productId: 42, rating: 5,
        });
        await (0, vitest_1.expect)(svc.createFollowUpReview(FOLLOW_CTX, '3', { content: '套娃' })).rejects.toThrow(/follow-up/i);
    });
    (0, vitest_1.it)('主评未 approved → 抛错', async () => {
        const { svc } = makeFollowService({
            id: 1, customerId: 9, status: 'pending', parentId: null,
            reviewedAt: daysAgo(1), productId: 42, rating: 5,
        });
        await (0, vitest_1.expect)(svc.createFollowUpReview(FOLLOW_CTX, '1', { content: '还没通过就追' })).rejects.toThrow(/通过审核/);
    });
});
// ── §114：好评送礼闭环（礼包选择落库与校验） ──
(0, vitest_1.describe)('ReviewService.createReview 礼包选择', () => {
    const CREATE_CTX = { channelId: 113, activeUserId: 77, channel: { id: 113 } };
    const ORDER_LINE = { id: 501, order: { customer: { id: 9 }, state: 'Delivered' } };
    function makeCreateService() {
        const reviewRepo = {
            findOne: vitest_1.vi.fn().mockResolvedValue(null),
            save: vitest_1.vi.fn().mockImplementation(async (r) => (Object.assign({}, r))),
            update: vitest_1.vi.fn().mockResolvedValue({}),
            find: vitest_1.vi.fn().mockResolvedValue([]),
        };
        const orderLineRepo = { findOne: vitest_1.vi.fn().mockResolvedValue(ORDER_LINE) };
        const connection = {
            getRepository: vitest_1.vi.fn((_ctx, entity) => (entity === core_1.OrderLine ? orderLineRepo : reviewRepo)),
        };
        const customerService = { findOneByUserId: vitest_1.vi.fn().mockResolvedValue({ id: 9 }) };
        const svc = new review_service_1.ReviewService({}, connection, {}, customerService, {});
        return { svc, reviewRepo };
    }
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('≥4 星 + 合法礼包 → 落库英文枚举 giftChoice', async () => {
        const { svc, reviewRepo } = makeCreateService();
        const saved = await svc.createReview(CREATE_CTX, {
            productId: 42, orderLineId: 501, rating: 5, content: '好吃', giftChoice: 'quality',
        });
        (0, vitest_1.expect)(saved.giftChoice).toBe('quality');
        (0, vitest_1.expect)(reviewRepo.save).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('≤3 星带礼包 → 忽略置 null（不发礼包）', async () => {
        const { svc } = makeCreateService();
        const saved = await svc.createReview(CREATE_CTX, {
            productId: 42, orderLineId: 501, rating: 2, content: '一般', giftChoice: 'time',
        });
        (0, vitest_1.expect)(saved.giftChoice).toBeNull();
    });
    (0, vitest_1.it)('非法礼包值 → 抛 UserInputError', async () => {
        const { svc } = makeCreateService();
        await (0, vitest_1.expect)(svc.createReview(CREATE_CTX, {
            productId: 42, orderLineId: 501, rating: 5, content: '好', giftChoice: '质量',
        })).rejects.toThrow(/giftChoice/);
    });
});
//# sourceMappingURL=review.service.spec.js.map