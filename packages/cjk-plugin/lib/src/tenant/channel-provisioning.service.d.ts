import { Channel, ChannelService, ID, RequestContext, TransactionalConnection } from '@vendure/core';
/**
 * 新渠道默认绑定的配送方式 code（按顺序取第一个存在的）。
 * 不写渠道 id，避免各环境 id 漂移。
 */
export declare const DEFAULT_PROVISION_SHIPPING_METHOD_CODES: string[];
/**
 * 新渠道默认绑定的支付方式 code。
 * 只绑「可直接用于流程验证」的方式；korea-pg 一期是桩，默认不绑（见 B-04）。
 */
export declare const DEFAULT_PROVISION_PAYMENT_METHOD_CODES: string[];
export interface ChannelProvisionResult {
    channelId: ID;
    defaultTaxZoneId: ID | null;
    defaultShippingZoneId: ID | null;
    shippingMethodIds: ID[];
    paymentMethodIds: ID[];
    shippingProfileId: ID | null;
    /** 非致命问题（缺 code、绑定失败等），调用方据需告警 */
    warnings: string[];
}
/**
 * 新建渠道的「兜底配置」——B-01 根因治理。
 *
 * 背景：ChannelService.create 不继承任何默认值，新建渠道既没有税区/配送区，
 * 也没有绑配送方式/支付方式，导致：
 *   - hydratePriceFields 抛「tax zone 无法确定」→ specSheets 价格 null；
 *   - eligibleShippingMethods / eligiblePaymentMethods 为空 → 无法下单；
 *   - BoxShippingLineAssignmentStrategy 找不到生效配送档案 → shippingLineId 为空 →
 *     订单卡在 `not all lines have shipping`（B-02 同根因）。
 *
 * 本服务把「该有的配置」收敛到一处并幂等补齐，新建租户不再依赖人工二次补配。
 */
export declare class ChannelProvisioningService {
    private connection;
    private channelService;
    constructor(connection: TransactionalConnection, channelService: ChannelService);
    /**
     * 读取默认渠道（`__default_channel__`）的税区 / 配送区，用于新渠道继承。
     * 供 createChannel 在 channelService.create 入参里直接带上。
     */
    getDefaultChannelZones(ctx: RequestContext): Promise<{
        defaultTaxZoneId: ID | null;
        defaultShippingZoneId: ID | null;
    }>;
    /**
     * 为已创建的渠道补齐默认配置（幂等，可重复执行，可用于存量渠道修复）：
     * 1. 缺税区/配送区时继承默认渠道；
     * 2. 绑定默认配送方式（courier-delivery 等）；
     * 3. 绑定默认支付方式（cash-on-delivery 等）；
     * 4. 无租户默认配送档案时创建，并把已绑配送方式挂进去（mode=mail）。
     *
     * 单步失败只记 warning，不阻断渠道创建（避免因某个 code 缺失导致建租户整体失败）；
     * 失败原因会随结果返回，调用方写日志。
     */
    provision(ctx: RequestContext, channel: Channel, options?: {
        shippingMethodCodes?: string[];
        paymentMethodCodes?: string[];
        createDefaultShippingProfile?: boolean;
    }): Promise<ChannelProvisionResult>;
    /** 缺省继承默认渠道的税区/配送区；已有值不动（不覆盖人工配置） */
    private ensureDefaultZones;
    /** 按 code 找到配送/支付方式并幂等绑定到渠道，返回渠道内可用的 id 列表 */
    private ensureMethodsInChannel;
    /**
     * 无租户默认配送档案时创建并设为默认，挂上已绑定的配送方式（default mode=mail）。
     * 这是 `not all lines have shipping` 的治本点：BoxShippingLineAssignmentStrategy
     * 在变体未绑定档案时回退租户默认档案，没有默认档案就没有 shippingLineId。
     */
    private ensureTenantDefaultShippingProfile;
}
