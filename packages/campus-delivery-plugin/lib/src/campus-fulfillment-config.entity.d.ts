import { DeepPartial, ID, VendureEntity } from '@vendure/core';
/** 店铺公告最大长度（列宽与应用层校验共用，避免「能填不能存」） */
export declare const STORE_NOTICE_MAX_LENGTH = 500;
/** 信任文案单条最大长度（§113）：评价页信任签名卡三行自定义文案 */
export declare const TRUST_TEXT_MAX_LENGTH = 80;
export declare class CampusFulfillmentConfig extends VendureEntity {
    [key: string]: any;
    channelId: ID;
    routesEnabled: string[];
    riderCommissionRate: number;
    autoAssignMinutes: number;
    paused: boolean;
    autoRefundMinutes: number;
    inProgressSlaMinutes: number;
    compensationCouponTemplateId: string;
    deliveryMinutes: number | null;
    minOrderAmount: number | null;
    deliveryFee: number | null;
    storeAddress: string | null;
    storePhone: string | null;
    storeNotice: string | null;
    errandBaseFee: number | null;
    thirdPartyBaseFee: number | null;
    freeShippingThreshold: number | null;
    /** 配送费阶梯（P3-4）：按商品金额分档替换分区运费基价，[{minAmount:分, fee:分}]，null=不启用 */
    deliveryFeeTiers: Array<{
        minAmount: number;
        fee: number;
    }> | null;
    merchantConfirmEnabled: boolean;
    merchantAutoOpenMinutes: number;
    /** 自动接单总开关（默认关） */
    autoAcceptEnabled: boolean;
    /** 下单到自动接单的延迟秒数（0-600），留出用户改址/商家拒单窗口 */
    autoAcceptDelaySeconds: number;
    /** 每日自动接单上限（0 = 不限）；打到上限后新单仍待人工接单 */
    autoAcceptDailyLimit: number;
    /** 适用范围（路线）：默认 R1/R2/R3，可在后台按配送方式勾选 */
    autoAcceptRoutes: string[];
    /** 休业日期列表：[{date:'YYYY-MM-DD', note?}]，校园时区自然日；null/空=不启用 */
    closureDates: Array<{
        date: string;
        note?: string | null;
    }> | null;
    timeoutCompensationEnabled: boolean;
    timeoutGraceMinutes: number;
    /** 超时赔付回扫窗口（小时）：只回补近 N 小时送达单（默认 24，可放大以覆盖更长账期） */
    timeoutCompensationWindowHours: number;
    timeoutCompensationCouponTemplateId: string | null;
    notifyTemplateAccepted: string | null;
    notifyTemplateRiderAssigned: string | null;
    notifyTemplateCookingDone: string | null;
    notifyTemplateDelivered: string | null;
    notifyTemplateExceptionHandled: string | null;
    notifyTemplateArrivedHandover: string | null;
    notifyTemplateDeliveryFallback: string | null;
    notifyTemplateOrderPlaced: string | null;
    notifyTemplatePaymentPending: string | null;
    notifyTemplateCancelled: string | null;
    notifyTemplateAfterSales: string | null;
    notifyTemplateAddressChanged: string | null;
    h5BaseUrl: string | null;
    printMode: string | null;
    /** 打印通道：local（默认）/ feie / yilianyun */
    printProvider: string;
    /** 服务商账号：飞鹅用户名 / 易联云 client_id */
    printAccount: string | null;
    /** 设备编号：飞鹅 sn / 易联云 machine_code */
    printDeviceSn: string | null;
    /** 服务商密钥：飞鹅 ukey / 易联云 client_secret */
    printDeviceKey: string | null;
    /** 联数（1-5），默认 1 */
    printCopies: number;
    /** 第一段由谁送（按路线）：R1 = merchant|owned，R3 = campus|owned|external；缺省 R1=merchant、R3=campus */
    routeFirstLeg: Record<string, string> | null;
    /** 校园交接点：R1/R2 各一个（键为路线号） */
    handoverPoints: Record<string, Array<{
        name: string;
        address?: string;
        phone?: string;
        lat: number;
        lng: number;
        isDefault?: boolean;
    }>> | null;
    /** 外部快递各 provider 的门店编号：{ dada?: string, meituan?: string } */
    providerShopNo: Record<string, string> | null;
    /** R1 商户接单超时（分钟），超时自动转自营快递；0 = 不自动转 */
    merchantAcceptMinutes: number;
    /** 等运营推送外部快递的超时（分钟），超时退回抢单大厅 */
    externalPushTimeoutMinutes: number;
    /** 已推送外部快递但久未接单/取货的超时（分钟），超时取消并退回抢单大厅 */
    externalFallbackMinutes: number;
    storeLat: number | null;
    storeLng: number | null;
    /** 动态配送计价配置（时段高峰/供需/手动倍率/封顶），null=关闭，回退分区固定运费 */
    dynamicPricing: Record<string, any> | null;
    /** 接单班次校验：开启后骑手仅能在后台登记的排班时段内抢单 */
    shiftCheckEnabled: boolean;
    /** 自动拉黑阈值：近 30 天顾客主动取消订单达到该次数自动加入黑名单（0 = 关闭） */
    blacklistAutoCancelCount: number;
    privacyNumberEnabled: boolean;
    /** 隐私号服务商：mask=仅脱敏（零依赖兜底），mock=本地虚拟号，aliyun/tencent=外部号池 */
    privacyNumberProvider: string;
    /** 虚拟号有效期（分钟），过期后重新申请；仅外部号池 provider 生效 */
    privacyNumberTtlMinutes: number;
    /** 隐私号小号区号/号码池前缀（provider 需要时配置） */
    privacyNumberPrefix: string | null;
    /** 食安公示：食品经营许可证编号 */
    foodLicenseNo: string | null;
    /** 食安公示：许可证照片 URL */
    foodLicenseImage: string | null;
    /** 食安公示：许可证到期日 YYYY-MM-DD（临近/过期 C 端标红） */
    foodLicenseExpiry: string | null;
    /** 食安公示：量化分级 A/B/C（空=未评级） */
    foodSafetyGrade: string | null;
    /** 食安公示：食品安全承诺书照片 URL */
    foodSafetyCommitmentImage: string | null;
    /** 食安公示：明厨亮灶直播/回放地址（空=未开通） */
    kitchenLiveUrl: string | null;
    /** 食安公示：是否在 C 端展示明厨亮灶入口 */
    kitchenLiveEnabled: boolean;
    /** 打包费开关（默认关） */
    packingFeeEnabled: boolean;
    /** 计费方式：perItem=按件累加（默认）/ perOrder=每单固定 */
    packingFeeMode: string;
    /** 打包费金额（分）：perItem=单件金额；perOrder=每单金额 */
    packingFeeAmount: number;
    /** 单笔封顶（分；null=不封顶） */
    packingFeeCap: number | null;
    /** C 端展示名称（空=「打包费」） */
    packingFeeLabel: string | null;
    /** 小程序 AppID（wx + 16 位十六进制） */
    mpAppId: string | null;
    /** 服务类目（如「餐饮/外卖」） */
    mpCategory: string | null;
    /** 当前上架版本号（x.y.z） */
    mpVersion: string | null;
    /** 上架状态：draft/inReview/online/rejected/offline */
    mpListingStatus: string;
    /** 用户隐私保护指引地址（审核必填） */
    mpPrivacyUrl: string | null;
    /** 审核备注 / 驳回原因 */
    mpReviewNote: string | null;
    /** 语音搜索服务商：mock（内置模拟识别）/ none（未开启） */
    voiceSearchProvider: string;
    /** 拍照搜索服务商：mock（内置模拟识别）/ none（未开启） */
    imageSearchProvider: string;
    /** 质量行开关（默认开）：关=该行不展示 */
    trustQualityEnabled: boolean;
    /** 质量行自定义文案（空=回落 C 端默认文案） */
    trustQualityText: string | null;
    /** 服务行开关（默认开） */
    trustServiceEnabled: boolean;
    /** 服务行自定义文案（空=回落默认） */
    trustServiceText: string | null;
    /** 时间行开关（默认开） */
    trustTimeEnabled: boolean;
    /** 时间行自定义文案（空=回落默认） */
    trustTimeText: string | null;
    /** 无人配送通道总开关 */
    unmannedDeliveryEnabled: boolean;
    /** 通道服务商：none / mock / meituan / xinshiji */
    unmannedDeliveryProvider: string;
    /** 通道接口地址（真实厂商必填） */
    unmannedDeliveryEndpoint: string | null;
    /** 通道密钥（真实厂商必填；后台只回「是否已配置」，不回明文） */
    unmannedDeliveryKey: string | null;
    constructor(input?: DeepPartial<CampusFulfillmentConfig>);
}
