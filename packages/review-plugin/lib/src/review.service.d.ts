import { ModuleRef } from '@nestjs/core';
import { CustomerService, ID, ListQueryBuilder, PaginatedList, ProductService, RequestContext, TransactionalConnection } from '@vendure/core';
import { Review } from './review.entity';
import { ReviewAlertService } from './review-alert.service';
import { ReviewPluginOptions } from './types';
import { CreateReviewInput, FollowUpReviewInput, ProductRating, ReviewAppealListOptions, ReviewListOptions, ReviewStats, UpdateReviewInput } from './types';
export declare class ReviewService {
    private options;
    private connection;
    private listQueryBuilder;
    private customerService;
    private productService;
    private moduleRef?;
    private alertService?;
    constructor(options: ReviewPluginOptions | undefined, connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, customerService: CustomerService, productService: ProductService, moduleRef?: ModuleRef | undefined, alertService?: ReviewAlertService | undefined);
    /** vendure Injector 由 ModuleRef 惰性构造（跨模块解析 Coupon/MemberLevel 服务，避免循环依赖） */
    private get injector();
    createReview(ctx: RequestContext, input: CreateReviewInput): Promise<Review>;
    /** 追评：挂在本人主评（parentId）下，聚合不计入；仅 approved 主评且在追评窗口内。 */
    createFollowUpReview(ctx: RequestContext, reviewId: ID, input: FollowUpReviewInput): Promise<Review>;
    /** 修改本人评价：仅 pending/approved 可改；变更涉及已审核主评时重算评分聚合。 */
    updateReview(ctx: RequestContext, id: ID, input: UpdateReviewInput): Promise<Review>;
    /** 删除本人评价（软删）。已审核主评删除后剔除聚合。 */
    deleteReview(ctx: RequestContext, id: ID): Promise<boolean>;
    replyReview(ctx: RequestContext, id: ID, reply: string): Promise<Review>;
    approveReview(ctx: RequestContext, id: ID): Promise<Review>;
    rejectReview(ctx: RequestContext, id: ID): Promise<Review>;
    getReview(ctx: RequestContext, id: ID): Promise<Review>;
    /**
     * 顾客对本人差评（1-3 星）发起申诉，诉求为隐藏该评价（内容有误 / 与商家已协商一致等）。
     * 同一评价同时只允许一条待审核申诉；追评与已删除评价不可申诉。
     */
    appealReview(ctx: RequestContext, reviewId: ID, reason: string, images?: string[] | null): Promise<Review>;
    /** 后台申诉列表：status 为申诉状态（pending/approved/rejected），缺省列出全部有申诉记录的评价。 */
    getReviewAppeals(ctx: RequestContext, options?: ReviewAppealListOptions): Promise<PaginatedList<Review>>;
    /** 申诉审核通过：评价被隐藏（退出展示与评分聚合），结果与审核人留痕。 */
    approveReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review>;
    /** 申诉驳回：评价维持原状，仅记录审核说明留痕。 */
    rejectReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review>;
    /**
     * 撤销申诉通过（人工纠错）：把已隐藏的评价恢复展示并重新计入评分聚合，
     * 申诉状态回退为 rejected，撤销原因与操作人追加到留痕字段。
     */
    revokeReviewAppeal(ctx: RequestContext, id: ID, note?: string | null): Promise<Review>;
    getReviews(ctx: RequestContext, options?: ReviewListOptions): Promise<PaginatedList<Review>>;
    /** C 端商品列表：仅对外可见（approved）的主评 + 追评（followUps 由 ResolveField 加载）。 */
    getProductReviews(ctx: RequestContext, productId: ID, options?: ReviewListOptions): Promise<PaginatedList<Review>>;
    /** C 端店铺级评论流：当前渠道全部 approved 主评（menu 评论 tab 数据源）。 */
    getChannelReviews(ctx: RequestContext, options?: ReviewListOptions): Promise<PaginatedList<Review>>;
    /** C 端店铺级统计：当前渠道全店 approved 主评（摘要卡：均分/好评率/分布/标签）。 */
    getChannelReviewStats(ctx: RequestContext): Promise<ReviewStats>;
    getMyReviews(ctx: RequestContext): Promise<Review[]>;
    getReviewFollowUps(ctx: RequestContext, review: Review): Promise<Review[]>;
    getReviewStats(ctx: RequestContext, productId: ID): Promise<ReviewStats>;
    markHelpful(ctx: RequestContext, id: ID): Promise<Review>;
    /** 读取聚合到 Product 自定义字段的评分快照（供列表卡片直接展示，避免全表扫描）。 */
    getProductRating(ctx: RequestContext, productId: ID): Promise<ProductRating>;
    /** 重算商品评风聚合（approved 主评）并写回 Product.customFields。 */
    recomputeProductRating(ctx: RequestContext, productId: number): Promise<void>;
    getCustomerName(ctx: RequestContext, review: Review): Promise<string | null>;
    /**
     * 渠道评价奖励配置（Channel customFields，未配置 = 不发奖）。
     * 传 giftChoice 时优先取该礼包专属券模板，模板为空回落 reviewGiftCouponTemplateId。
     */
    private getGiftConfig;
    /** 渠道追评窗口（天；缺省 7，0 = 不允许追评）。 */
    private getFollowUpWindowDays;
    /** 评价有礼：发券/积分（任一成功返回 true）。单侧失败仅告警不阻塞。 */
    private grantReviewGift;
    /**
     * 校验并归一化礼包选择：非法枚举直接报错；
     * ≤3 星（非好评）或未传 → null（不记录，也不发礼包券）。
     */
    private normalizeGiftChoice;
    private assertContent;
    private requireCustomer;
}
