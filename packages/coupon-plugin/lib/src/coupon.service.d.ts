import { Customer, I18nError, ID, Injector, ListQueryBuilder, ListQueryOptions, RequestContext, TransactionalConnection } from '@vendure/core';
import type { CouponIssuedBy } from './types';
import { CouponBindingService } from './coupon-binding.service';
import { CouponTemplate } from './coupon-template.entity';
import { CustomerCoupon } from './customer-coupon.entity';
import { CouponGrantBatch } from './coupon-grant-batch.entity';
import { ProductCouponBinding } from './product-coupon-binding.entity';
/**
 * 属店权限不足错误。本版本 Vendure 的 ForbiddenError 构造器固定 message='error.forbidden'（code='FORBIDDEN'），
 * 无法注入自定义文案；故继承 I18nError，沿用 FORBIDDEN 错误码，以显式携带 COUPON_NOT_OWNED 语义消息。
 */
export declare class CouponNotOwnedError extends I18nError {
    constructor();
}
export declare class CouponService {
    private connection;
    private listQueryBuilder;
    private bindingService;
    constructor(connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, bindingService: CouponBindingService);
    private orderService;
    private customerService;
    private memberLevelService;
    private codePrefix;
    init(injector: Injector): void;
    /**
     * 将模板上的 memberLevel 字符串解析为所需最低档位（1-5）。
     * 支持：纯数字（"3"→3）、英文档位码（gold→3）、中文档位名（金卡会员→3）。
     * 无法解析或空 → 返回 null（不设限，fail-open）。对未知文案保持宽容，避免误伤。
     */
    resolveRequiredMemberLevel(memberLevel?: string | null): Promise<number | null>;
    /**
     * 会员等级门槛判定（非阻塞）。memberLevel 未设 / 解析失败 / 会员插件未注册 → 放行；
     * 否则要求顾客当前档位 >= 所需档位。
     */
    couponMeetsMemberLevel(ctx: RequestContext, customerId: number, tpl: CouponTemplate): Promise<boolean>;
    /** 会员等级门槛校验（抛错）。 */
    assertCouponMemberLevel(ctx: RequestContext, customerId: number, tpl: CouponTemplate): Promise<void>;
    findAllTemplates(ctx: RequestContext, options?: ListQueryOptions<CouponTemplate>): Promise<{
        items: CouponTemplate[];
        totalItems: number;
    }>;
    findOneTemplate(ctx: RequestContext, id: ID): Promise<CouponTemplate | undefined>;
    /** 下线 CATEGORY scope（coupon.md §8 A1）：结算无分类匹配逻辑、无 UI/实体关系指向，
     *  使管理员误配「分类券」时静默全场可抵。create/update 一律拒绝该值。 */
    private assertScopeSupported;
    createTemplate(ctx: RequestContext, input: any): Promise<CouponTemplate>;
    updateTemplate(ctx: RequestContext, input: any): Promise<CouponTemplate>;
    /**
     * 兑换码入参规范化（create/update 共用）：
     * - 未传 → 不动；空串/空白 → 清空（null）
     * - 去首尾空白后全库唯一（兑换接口按 claimCode 定位模板，重复会导致归属歧义）
     */
    private applyClaimCodeInput;
    /**
     * 券成本承担入参规范化（create/update 共用）：
     * - costBearer 仅接受 PLATFORM|MERCHANT|SPLIT，非法值回退 PLATFORM（历史行为：平台承担）
     * - merchantCostRate 仅在 SPLIT 下生效（0-100，缺省 50）；PLATFORM 归 0、MERCHANT 归 100，
     *   保证结算侧只需按比例计算
     */
    private applyCostBearerInput;
    /**
     * 门店覆盖范围入参规范化（create/update 共用）：仅接受 ALL|MERCHANT|STORE，
     * 非法值回退 ALL（不限门店，与历史券行为一致）。
     */
    private applyStoreCoverageInput;
    /**
     * 营销字段入参规范化（create/update 共用）：
     * anchorPrice 仅接受正整数（分），非法/<=0 归 null（不展示划线价）；
     * label 去首尾空白、限 30 字符，空串归 null（不展示标签）。
     */
    private applyMarketingInput;
    /**
     * 多语言合并：nameZh/nameEn/descZh/descEn 按需写入，产出 LocalizedText 对象，
     * 并保留既有的其它语言文案。任一多语言字段均未提供时不改动。
     */
    private applyMultilingualInput;
    /** 合并单条 LocalizedText：当前值（对象取其已有键，纯字符串视为 zh）叠加 zh_Hans/en 覆盖。 */
    private mergeLocalized;
    deleteTemplate(ctx: RequestContext, id: ID): Promise<void>;
    /**
     * 领券中心。scene 口径：ONLINE（默认，历史行为）| IN_STORE（到店券，C 端到店券 tab）| ALL（全部）。
     * 匹配规则见 matchesScene：ALL 场景券在 ONLINE 与 IN_STORE 口径下均会返回。
     */
    couponCentre(ctx: RequestContext, scene?: string): Promise<CouponTemplate[]>;
    /** 领券中心「即将开始」：enabled 且 startsAt 在未来的券模板（与 couponCentre 同渠道/scene 口径） */
    couponCentreUpcoming(ctx: RequestContext, scene?: string): Promise<CouponTemplate[]>;
    /** 默认商城渠道下，本商城商品（Product.customFields.shopId）中出现过的店铺 id 集合。 */
    private shopIdsPresentInChannel;
    listMyCoupons(ctx: RequestContext, status?: string): Promise<CustomerCoupon[]>;
    /**
     * C 端：按券码精准查当前登录用户自己的单张券（券码页轮询核销状态用）。
     * 只匹配本人名下的券，非本人或不存在一律返回 null，避免越权探测券码。
     */
    getMyCouponByCode(ctx: RequestContext, code: string): Promise<CustomerCoupon | null>;
    /**
     * 到店收银：列出某顾客在当前渠道「可到店核销」的券（未使用 / 未过期 / 场景含 IN_STORE）。
     * 仅到店场景过滤，不做渠道集合判定（券可由任意渠道获得，到店核销只看场景与归属）。
     */
    listInStoreCoupons(ctx: RequestContext, customerId: number): Promise<CustomerCoupon[]>;
    listAllCoupons(ctx: RequestContext, options?: ListQueryOptions<CustomerCoupon>): Promise<{
        items: CustomerCoupon[];
        totalItems: number;
    }>;
    /**
     * 核销看板四指标：按模板聚合领券记录状态（仅状态计数，不新增埋点）。
     * 口径：claimed=领取量（记录条数，CustomerCoupon 每行一张券实例）；used=核销量；
     * redemptionRate=核销率=used/claimed；expiredRate=过期率=expired/claimed（百分比 0-100）。
     * 时间筛选按领取时间（createdAt）闭区间；templateId 可选；属店隔离与 listAllCoupons 同法。
     */
    couponRedemptionStats(ctx: RequestContext, options?: {
        templateId?: number | null;
        from?: Date | null;
        to?: Date | null;
    }): Promise<Array<{
        templateId: number;
        name: string | null;
        claimed: number;
        used: number;
        expired: number;
        unused: number;
        returned: number;
        invalid: number;
        redemptionRate: number;
        expiredRate: number;
    }>>;
    pointsMallTemplates(ctx: RequestContext): Promise<CouponTemplate[]>;
    exchangeWithPoints(ctx: RequestContext, templateId: ID): Promise<{
        coupon: CustomerCoupon;
        spentPoints: number;
    }>;
    claimCoupon(ctx: RequestContext, templateId: ID): Promise<CustomerCoupon>;
    /** 详情页可领券：binding.enabled && 模板 enabled && claimable + 渠道匹配（listByProduct 已过滤） */
    listProductCoupons(ctx: RequestContext, productId: ID): Promise<ProductCouponBinding[]>;
    /** 详情页领券：按 bindingId 找到模板后复用 claimCoupon（限领/余量/newCustomerOnly 校验都在其中） */
    claimProductCoupon(ctx: RequestContext, bindingId: ID): Promise<CustomerCoupon>;
    /** 凭码兑换：同租户内 claimCode 唯一匹配模板 → 复用 claimCoupon */
    redeemByClaimCode(ctx: RequestContext, claimCode: string): Promise<CustomerCoupon>;
    /** 模板渠道归属校验：channels 为空（不限渠道）→ true；否则要求包含当前渠道（供到店买单复用） */
    templateBelongsToChannel(ctx: RequestContext, tpl: CouponTemplate): boolean;
    grantCoupon(ctx: RequestContext, templateId: ID, customerIds: ID[]): Promise<string[]>;
    listChannelCustomers(ctx: RequestContext, query?: string, take?: number, skip?: number): Promise<{
        items: Customer[];
        totalItems: number;
    }>;
    /** 本店商品 id 列表（Product.customFields.shopId === shopId），供「本店顾客」归属过滤。 */
    private findShopProductIds;
    private customerInChannel;
    private notifyCouponIssued;
    grantCouponIssue(ctx: RequestContext, templateId: ID, customerIds: ID[], notify: boolean, opts?: {
        issuedBy?: CouponIssuedBy;
        recentIssuedDays?: number;
    }): Promise<Array<{
        customerId: ID;
        ok: boolean;
        code: string | null;
        reason: string | null;
    }>>;
    /**
     * 圈选「N 天未消费」客户（E1）：本渠道内，近期（cutoff 之后）在本渠道无任何有效下单记录的客户。
     * 两步法（先查近期消费者集合，再差集）避免跨库 NOT EXISTS 方言差异；上限 take 防失控。
     */
    findSleepingCustomerIds(ctx: RequestContext, days: number, take?: number): Promise<number[]>;
    /** E1 圈人预览：只数不发。 */
    winBackPreviewCount(ctx: RequestContext, days: number): Promise<number>;
    /**
     * E1 批量发放：圈人 → 逐人走 grantCouponIssue（RECALL 渠道留痕 + R4 七日防骚扰）→ 落批次留痕。
     * 单人失败不中断整批；结果逐人记录在批次 resultsJson，可查询。
     */
    winBackGrant(ctx: RequestContext, templateId: ID, days: number, notify: boolean): Promise<CouponGrantBatch>;
    /** E1 批次查询（结果可查询）：本渠道倒序。 */
    listGrantBatches(ctx: RequestContext, take?: number): Promise<CouponGrantBatch[]>;
    revokeCoupon(ctx: RequestContext, id: ID): Promise<CustomerCoupon>;
    /**
     * 惰性 EXPIRED 落库：把已越界（expiredAt <= now）但仍为 UNUSED/RETURNED 的券置为 EXPIRED。
     * 单语句条件 UPDATE，原子且幂等：条件含 `status IN ('UNUSED','RETURNED')` → 天然不会覆盖
     * USED/INVALID；已 EXPIRED 不在条件内 → 多次执行不受影响。返回受影响行数（便于观测/测试）。
     * customerId 省略时全量（供定时清扫），否则仅转化该用户（用户路径）。
     */
    expireDueCoupons(ctx: RequestContext, customerId?: number): Promise<number>;
    /** 全量清扫（定时任务用）：rawConnection + 无 ctx，Replica 直连；幂等。 */
    expireDueCouponsAll(): Promise<number>;
    applyCouponToOrder(ctx: RequestContext, orderId: ID, code: string): Promise<any>;
    clearCouponFromOrder(ctx: RequestContext, orderId: ID): Promise<any>;
    /** 支付成功后核销券 */
    bindAsUsed(ctx: RequestContext, orderId: ID): Promise<void>;
    /** 订单取消回退券（可复用） */
    returnCoupon(ctx: RequestContext, orderId: ID): Promise<void>;
    /**
     * A3（coupon.md §8 A1/A3）：整单全额退款后回退券。
     * Vendure 订单无 "Refunded" 态，退款由 Refund 实体走独立状态机到 "Settled"；
     * 故按「该订单累计已 Settled 的退款额 >= 应付总额（totalWithTax）」判定为整单退完，
     * 触发 returnCoupon 回退。部分退（未达全额）不触发。幂等由 returnCoupon 保证。
     */
    returnCouponOnFullRefund(ctx: RequestContext, refundId: ID): Promise<void>;
    /**
     * 归属解析：activeUserId → Administrator.user → Shop.administratorId（与 shop-plugin 同法，不依赖 ctx.channelId）。
     * 若连接未注册 Shop 实体（shop-plugin 未加载）或 admin 无法解析，则回退为 undefined（不阻断）。
     *
     * 公开（public）：供 CouponAdminResolver 等鉴权调用点复用，避免在 service 内重复实现。
     * 保持签名兼容，Task B 既有的私有调用不受影响。
     */
    resolveShopIdFromActiveUser(ctx: RequestContext, userId?: ID): Promise<number | undefined>;
    /**
     * 原则：超级管理员（无属店 Shop）可管理全部券；属店管理员只能管理「平台级券（shopId 为空）
     * + 本店发行的券」，其余一率抛 ForbiddenError(COUPON_NOT_OWNED)。
     * 供 resolver 与列表过滤复用。
     */
    assertManagedByShop(ctx: RequestContext, targetShopId?: number): Promise<void>;
    /** 按实体名称从连接元数据中取回实体类（用于在插件未直接依赖 Shop 时安全解析）。 */
    findEntityClass(name: string): any | undefined;
    private orderCode;
    private currentCustomerId;
    private countHeld;
    /** 原子扣减发行余量；受影响数大于 0 表示成功 */
    private atomicIncrementClaimed;
    /** 新客判定：本租户是否已有历史有效订单（排除创建/购物车/待支付/修改/取消等未完成态） */
    private hasPlacedOrder;
    /**
     * 新客综合判定（FR-D/FR-C 口径）：本租户无历史有效订单 且 未持有过新客券
     * （UNUSED/RETURNED/USED 任一状态的新客券均计「已持」，防 1 元购复购绕过）。
     */
    isCampaignNewCustomer(ctx: RequestContext, customerId: number): Promise<boolean>;
    /** 是否持有过新客券（newCustomerOnly 模板发放的券，未作废即计）。 */
    holdsNewCustomerCoupon(ctx: RequestContext, customerId: number): Promise<boolean>;
    /**
     * 购买/加价购侧硬拦（FR-D）：新客券要求「综合新客 + 每人限购 1 张（PAID 出售单计）」；
     * E2：配置会员等级门槛的券，不达标不可购（可见性过滤之外的第二道防线）。
     */
    assertCustomerCanBuy(ctx: RequestContext, customerId: number, tpl: CouponTemplate): Promise<void>;
    /**
     * FR-F 通用领取前校门面（每日领券/神券日/支付有礼共用）：
     * 模板 perUserLimit（持有有效张数口径）+ 会员等级门槛（E2）。
     * 返回拦截原因（PER_USER_LIMIT / MEMBER_LEVEL_BLOCKED）或 null（可领）。
     */
    assertCustomerCanClaim(ctx: RequestContext, customerId: number, tpl: CouponTemplate): Promise<string | null>;
    /** 程序化发放公共入口（FR-C 裂变）：原子扣发行余量 + 建券（R2 计入限量 / R1 issuedBy 渠道留痕）。 */
    issueForProgram(ctx: RequestContext, customerId: number, tpl: CouponTemplate, issuedBy: CouponIssuedBy): Promise<CustomerCoupon>;
    /**
     * E2 会员等级可见性过滤：配置等级门槛的券仅该等级及以上可见；无等级数据按 1 档（非会员）。
     * 全部模板无门槛（或仅 1 档）时跳过等级查询，零额外 IO。
     * （saleCatalogue 等目录服务也会调用，故 public。）
     */
    filterByMemberLevelVisibility<T extends CouponTemplate>(ctx: RequestContext, list: T[]): Promise<T[]>;
    /**
     * 出售发券桥接：复用发券不变量（原子扣余量 → 建券并记录出售单溯源）。
     * 券包逐张调用本方法，任一张售罄即抛错，由调用方事务回滚整包。
     */
    issueForSale(ctx: RequestContext, customerId: number, tpl: CouponTemplate, saleOrderId: number): Promise<CustomerCoupon>;
    private createUserCoupon;
}
