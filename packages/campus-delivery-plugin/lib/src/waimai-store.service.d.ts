import { RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
export interface WaimaiStore {
    channelId: number;
    name: string;
    logo: string | null;
    tags: string[];
    monthlySales: number;
    promoText: string | null;
    paused: boolean;
    routesEnabled: string[];
    deliveryMinutes: number | null;
    minOrderAmount: number | null;
    deliveryFee: number | null;
    storeAddress: string | null;
    storePhone: string | null;
    storeNotice: string | null;
    businessHours: string | null;
    /** 当前是否可下单（营业时段内 且 未暂停营业 且 今日不在休业日历） */
    openNow: boolean;
    /** 今日是否处于休业日历（§70）：true 时 C 端展示「今日休业」并禁止下单 */
    closedToday: boolean;
    /** 今日休业备注（如「国庆假期」），null=无备注或未休业 */
    closureNote: string | null;
    errandBaseFee: number | null;
    freeShippingThreshold: number | null;
    /** 配送费阶梯（P3-4）JSON 字符串：[{minAmount:分, fee:分}]，null=不启用 */
    deliveryFeeTiers: string | null;
    /** 食安公示（未配置的字段为 null，C 端不渲染对应行） */
    foodLicenseNo: string | null;
    foodLicenseImage: string | null;
    foodLicenseExpiry: string | null;
    foodSafetyGrade: string | null;
    foodSafetyCommitmentImage: string | null;
    kitchenLiveUrl: string | null;
    kitchenLiveEnabled: boolean;
    /** 打包费/餐盒费（C 端展示与前端预估口径；最终金额由结算 process 落 surcharge） */
    packingFeeEnabled: boolean;
    packingFeeMode: string;
    packingFeeAmount: number;
    packingFeeCap: number | null;
    packingFeeLabel: string | null;
}
/** 单店进店凭证：列表不再批量下发 token，C 端按 channelId 单店换取（限流） */
export interface CampusStoreEntry {
    channelId: number;
    channelToken: string;
}
/** §113 信任文案（店铺级）：enabled=false 该行不展示，text=null 回落 C 端默认文案 */
export interface CampusStoreTrust {
    qualityEnabled: boolean;
    qualityText: string | null;
    serviceEnabled: boolean;
    serviceText: string | null;
    timeEnabled: boolean;
    timeText: string | null;
}
export interface CampusStoreConfigWithChannel {
    channelId: number;
    channelName: string;
    channelToken: string;
    routesEnabled: string[];
    deliveryMinutes: number | null;
    minOrderAmount: number | null;
    deliveryFee: number | null;
    storeAddress: string | null;
    storePhone: string | null;
    storeNotice: string | null;
    errandBaseFee: number | null;
    thirdPartyBaseFee: number | null;
    freeShippingThreshold: number | null;
    /** 配送费阶梯（P3-4）JSON 字符串：[{minAmount:分, fee:分}]，null=不启用 */
    deliveryFeeTiers: string | null;
    notifyTemplateAccepted: string | null;
    notifyTemplateRiderAssigned: string | null;
    notifyTemplateCookingDone: string | null;
    notifyTemplateDelivered: string | null;
    notifyTemplateExceptionHandled: string | null;
    /** 第一段交接完成（餐/包裹已到校园交接点） */
    notifyTemplateArrivedHandover: string | null;
    /** 配送方式降级/异常重派 */
    notifyTemplateDeliveryFallback: string | null;
    notifyTemplateOrderPlaced: string | null;
    notifyTemplatePaymentPending: string | null;
    notifyTemplateCancelled: string | null;
    notifyTemplateAfterSales: string | null;
    notifyTemplateAddressChanged: string | null;
    h5BaseUrl: string | null;
    printMode: 'off' | 'onPaid' | 'onAccepted';
    /** 打印通道：local=本地 C-Lodop / feie=飞鹅 / yilianyun=易联云 */
    printProvider: string;
    printAccount: string | null;
    printDeviceSn: string | null;
    printDeviceKey: string | null;
    printCopies: number;
    routeFirstLeg: Array<{
        route: string;
        carrier: string;
    }>;
    handoverPoints: Array<{
        route: string;
        name: string;
        address: string | null;
        phone: string | null;
        lat: number;
        lng: number;
        isDefault: boolean;
    }>;
    providerShopNo: Array<{
        provider: string;
        shopNo: string;
    }>;
    merchantAcceptMinutes: number;
    externalPushTimeoutMinutes: number;
    externalFallbackMinutes: number;
    storeLat: number | null;
    storeLng: number | null;
    timeoutCompensationEnabled: boolean;
    timeoutGraceMinutes: number;
    timeoutCompensationWindowHours: number;
    timeoutCompensationCouponTemplateId: string | null;
    /** 动态计价配置 JSON 字符串（null=关闭，回退分区固定运费） */
    dynamicPricing: string | null;
    privacyNumberEnabled: boolean;
    privacyNumberProvider: string;
    /** M3：实际生效的服务商（aliyun/tencent 未接入时回落 mask） */
    privacyNumberEffectiveProvider: string;
    /** M3：配置值 ≠ 生效值（后台应提示运营「号码保护未真正启用」） */
    privacyNumberDegraded: boolean;
    privacyNumberNote: string | null;
    privacyNumberTtlMinutes: number;
    privacyNumberPrefix: string | null;
    foodLicenseNo: string | null;
    foodLicenseImage: string | null;
    foodLicenseExpiry: string | null;
    foodSafetyGrade: string | null;
    foodSafetyCommitmentImage: string | null;
    kitchenLiveUrl: string | null;
    kitchenLiveEnabled: boolean;
    packingFeeEnabled: boolean;
    packingFeeMode: string;
    packingFeeAmount: number;
    packingFeeCap: number | null;
    packingFeeLabel: string | null;
    /** 小程序上架配置（P2-1） */
    mpAppId: string | null;
    mpCategory: string | null;
    mpVersion: string | null;
    mpListingStatus: MpListingStatus;
    mpPrivacyUrl: string | null;
    mpReviewNote: string | null;
    /** 上架前检查是否齐全（AppID/类目/版本/隐私指引/客服电话/食品许可证） */
    mpReady: boolean;
    /** 上架前检查缺项 key（前端按 key 做 i18n 文案） */
    mpMissing: string[];
    /** 语音/拍照搜索服务商（P2-2）：mock / none */
    voiceSearchProvider: string;
    imageSearchProvider: string;
}
declare const PRINT_MODES: readonly ["off", "onPaid", "onAccepted"];
type PrintMode = (typeof PRINT_MODES)[number];
/** 小程序上架状态白名单（P2-1） */
declare const MP_LISTING_STATUSES: readonly ["draft", "inReview", "online", "rejected", "offline"];
type MpListingStatus = (typeof MP_LISTING_STATUSES)[number];
/** 上架前检查：返回缺项 key（空数组=可提交/可上架） */
export declare function mpListingMissing(cfg: CampusFulfillmentConfig | undefined): string[];
/** 上架状态归一化：脏值回 'draft'，避免后台展示空白状态 */
export declare function normalizeMpListingStatus(v: unknown): MpListingStatus;
/** 打印通道白名单（P1-4）：local=本地 C-Lodop，feie=飞鹅云，yilianyun=易联云 */
export declare const PRINT_PROVIDERS: readonly ["local", "feie", "yilianyun"];
/** printMode 归一化：null/非法值一律回 'off'（存量行与脏配置兜底） */
export declare function normalizePrintMode(v: unknown): PrintMode;
/** 隐私号服务商白名单：mask=仅脱敏，mock=本地虚拟号，aliyun/tencent=外部号池（缺凭证自动降级为 mask） */
export declare const PRIVACY_PROVIDERS: readonly ["mask", "mock", "aliyun", "tencent"];
/** M3：隐私号服务商实际生效口径（配置值 ≠ 生效值即降级，后台可直接看到） */
export interface PrivacyProviderStatus {
    /** 配置里选的服务商 */
    provider: string;
    /** 实际生效的服务商（外部号池未接入时回落 mask） */
    effective: 'mask' | 'mock' | 'aliyun' | 'tencent';
    degraded: boolean;
    note: string | null;
}
/**
 * 服务商生效口径（M3）：aliyun/tencent 号池接口尚未接入，
 * 即使配了凭证也只能回落脱敏号——统一算出「配置值 / 生效值 / 降级原因」，
 * 供后台配置视图与运行时 resolve 共用，避免被静默降级误导。
 */
export declare function privacyProviderStatus(cfg: {
    privacyNumberEnabled?: boolean | null;
    privacyNumberProvider?: string | null;
} | null | undefined): PrivacyProviderStatus;
/**
 * L2：外卖准入行业判断——只有「显式配置为非餐饮」才剔除；
 * industryType 未设置（存量未刷成功 / 新建渠道漏填）时按餐饮处理，
 * 避免已有履约配置的店铺从 C 端列表与进店换取里静默消失。
 */
export declare function isCateringIndustry(cf: any): boolean;
export declare class WaimaiStoreService {
    private connection;
    private readonly entryRate;
    constructor(connection: TransactionalConnection);
    /**
     * 菜品每日限量/每人限购（§68）：当前渠道「有限量配置」的商品，返回当日已售与剩余。
     * 公开只读：未登录的顾客 myToday/myRemaining 为 null。
     */
    dailyStock(ctx: RequestContext): Promise<{
        productId: number;
        dailyLimit: number | null;
        perUserLimit: number | null;
        soldToday: number;
        remaining: number | null;
        myToday: number | null;
        myRemaining: number | null;
    }[]>;
    /** §113 公开只读：当前渠道的信任文案（评价页信任签名卡三行），空文案/无配置即回默认开启 + 空串 */
    trustCopy(ctx: RequestContext): Promise<CampusStoreTrust>;
    /** 店铺列表：有履约配置的渠道即外卖店铺（跨渠道公开元数据聚合，供 C 端首页）。
     * 不再下发 channelToken；C 端进店时按 channelId 调 campusStoreEntry 单店换取。 */
    listStores(ctx: RequestContext): Promise<WaimaiStore[]>;
    /**
     * 单店进店换取渠道 token：仅对「有履约配置 + 非默认渠道 + 餐饮行业」的店铺下发，
     * 避免 public 列表一次性批量暴露全部渠道 token；每 IP 每分钟限流。
     */
    storeEntry(ctx: RequestContext, channelId: number): Promise<CampusStoreEntry>;
    /** 单店换取的进程内滑动窗口限流（多实例时各实例独立计数） */
    private assertEntryRate;
    /** admin：全店铺配置（跨渠道，join Channel 取店铺名/token；默认渠道是平台会话渠道，跳过） */
    listStoreConfigs(ctx: RequestContext): Promise<CampusStoreConfigWithChannel[]>;
    /** admin：按 channelId upsert（幂等），routesEnabled 白名单 R1-R5，负数金额拒绝 */
    updateStoreConfig(ctx: RequestContext, channelId: number, input: {
        routesEnabled: string[];
        deliveryMinutes?: number | null;
        minOrderAmount?: number | null;
        deliveryFee?: number | null;
        storeAddress?: string | null;
        storePhone?: string | null;
        storeNotice?: string | null;
        errandBaseFee?: number | null;
        thirdPartyBaseFee?: number | null;
        freeShippingThreshold?: number | null;
        /** 配送费阶梯：JSON 字符串（[{minAmount:分, fee:分}]）或数组；null/空=不启用 */
        deliveryFeeTiers?: Array<{
            minAmount: number;
            fee: number;
        }> | string | null;
        notifyTemplateAccepted?: string | null;
        notifyTemplateRiderAssigned?: string | null;
        notifyTemplateCookingDone?: string | null;
        notifyTemplateDelivered?: string | null;
        notifyTemplateExceptionHandled?: string | null;
        notifyTemplateArrivedHandover?: string | null;
        notifyTemplateDeliveryFallback?: string | null;
        notifyTemplateOrderPlaced?: string | null;
        notifyTemplatePaymentPending?: string | null;
        notifyTemplateCancelled?: string | null;
        notifyTemplateAfterSales?: string | null;
        notifyTemplateAddressChanged?: string | null;
        h5BaseUrl?: string | null;
        printMode?: string | null;
        printProvider?: string | null;
        printAccount?: string | null;
        printDeviceSn?: string | null;
        printDeviceKey?: string | null;
        printCopies?: number | null;
        timeoutCompensationEnabled?: boolean | null;
        timeoutGraceMinutes?: number | null;
        timeoutCompensationWindowHours?: number | null;
        timeoutCompensationCouponTemplateId?: string | null;
        routeFirstLeg?: Array<{
            route: string;
            carrier: string;
        }> | null;
        handoverPoints?: Array<{
            route: string;
            name: string;
            address?: string | null;
            phone?: string | null;
            lat: number;
            lng: number;
            isDefault?: boolean | null;
        }> | null;
        providerShopNo?: Array<{
            provider: string;
            shopNo: string;
        }> | null;
        merchantAcceptMinutes?: number | null;
        externalPushTimeoutMinutes?: number | null;
        externalFallbackMinutes?: number | null;
        storeLat?: number | null;
        storeLng?: number | null;
        /** 动态计价 JSON 字符串；null/'' = 关闭 */
        dynamicPricing?: string | null;
        privacyNumberEnabled?: boolean | null;
        privacyNumberProvider?: string | null;
        privacyNumberTtlMinutes?: number | null;
        privacyNumberPrefix?: string | null;
        foodLicenseNo?: string | null;
        foodLicenseImage?: string | null;
        foodLicenseExpiry?: string | null;
        foodSafetyGrade?: string | null;
        foodSafetyCommitmentImage?: string | null;
        kitchenLiveUrl?: string | null;
        kitchenLiveEnabled?: boolean | null;
        packingFeeEnabled?: boolean | null;
        packingFeeMode?: string | null;
        packingFeeAmount?: number | null;
        packingFeeCap?: number | null;
        packingFeeLabel?: string | null;
        mpAppId?: string | null;
        mpCategory?: string | null;
        mpVersion?: string | null;
        mpListingStatus?: string | null;
        mpPrivacyUrl?: string | null;
        mpReviewNote?: string | null;
        voiceSearchProvider?: string | null;
        imageSearchProvider?: string | null;
    }): Promise<CampusStoreConfigWithChannel>;
    /** 经 rawConnection 按实体名取 repo（避免对 cjk-plugin 的构建期依赖；PickupLocation 由 cjk-plugin 注册于同一进程）。
     * 可见性：isPublic=false + ownerChannelId=本渠道 + channels 含本渠道 → shop 端 applyVisibility 对本渠道可见（cjk pickup-location.service.ts:35）。 */
    private upsertStorePickupLocation;
    private toConfigView;
}
export {};
