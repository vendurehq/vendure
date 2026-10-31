import { Column, Entity } from 'typeorm';
import { DeepPartial, ID, VendureEntity } from '@vendure/core';

/** 店铺公告最大长度（列宽与应用层校验共用，避免「能填不能存」） */
export const STORE_NOTICE_MAX_LENGTH = 500;
/** 信任文案单条最大长度（§113）：评价页信任签名卡三行自定义文案 */
export const TRUST_TEXT_MAX_LENGTH = 80;

@Entity()
export class CampusFulfillmentConfig extends VendureEntity {
    [key: string]: any;
    @Column('int', { unique: true }) channelId: ID;
    @Column({ type: 'simple-json', default: '["R1","R3","R4","R5"]' })
    routesEnabled: string[];
    @Column({ type: 'int', default: 100 }) riderCommissionRate: number; // 百分比
    @Column({ type: 'int', default: 10 }) autoAssignMinutes: number;
    @Column({ default: false }) paused: boolean; // 运力暂停开关
    @Column({ type: 'int', default: 30 }) autoRefundMinutes: number; // T4 终态
    @Column({ type: 'int', default: 45 }) inProgressSlaMinutes: number; // T3 SLA 告警
    @Column({ type: 'varchar', nullable: true }) compensationCouponTemplateId: string; // T4 补偿券模板
    @Column({ type: 'int', nullable: true }) deliveryMinutes: number | null; // 配送时长（分钟）
    @Column({ type: 'int', nullable: true }) minOrderAmount: number | null; // 起送价（分）
    @Column({ type: 'int', nullable: true }) deliveryFee: number | null; // 配送费（分，本期仅展示）
    @Column({ type: 'varchar', nullable: true }) storeAddress: string | null; // 自提地址
    @Column({ type: 'varchar', nullable: true }) storePhone: string | null; // 联系电话
    @Column({ type: 'varchar', length: STORE_NOTICE_MAX_LENGTH, nullable: true }) storeNotice: string | null; // 店铺公告
    @Column({ type: 'int', nullable: true }) errandBaseFee: number | null; // R5 跑腿起步价（分；null=默认 200）
    @Column({ type: 'int', nullable: true }) thirdPartyBaseFee: number | null; // R2 第三方到校配送基价（分；null=不接管，沿用店铺普通快递运费；0=免费接管）
    @Column({ type: 'int', nullable: true }) freeShippingThreshold: number | null; // 满 X 元免配送费（分；null=不启用，仅 R1/R3 外卖单）
    /** 配送费阶梯（P3-4）：按商品金额分档替换分区运费基价，[{minAmount:分, fee:分}]，null=不启用 */
    @Column({ type: 'simple-json', nullable: true })
    deliveryFeeTiers: Array<{ minAmount: number; fee: number }> | null;
    @Column({ default: false }) merchantConfirmEnabled: boolean; // 商家接单确认模式：支付后先待商家接单，出餐完成才入大厅
    @Column({ type: 'int', default: 15 }) merchantAutoOpenMinutes: number; // 商家未处理（待接单/备餐中）超时自动入厅，防卡单
    // 商家自动接单（§69）：营业中且未暂停时，新单延迟若干秒自动确认，超每日上限退回人工
    /** 自动接单总开关（默认关） */
    @Column({ default: false }) autoAcceptEnabled: boolean;
    /** 下单到自动接单的延迟秒数（0-600），留出用户改址/商家拒单窗口 */
    @Column({ type: 'int', default: 30 }) autoAcceptDelaySeconds: number;
    /** 每日自动接单上限（0 = 不限）；打到上限后新单仍待人工接单 */
    @Column({ type: 'int', default: 0 }) autoAcceptDailyLimit: number;
    /** 适用范围（路线）：默认 R1/R2/R3，可在后台按配送方式勾选 */
    @Column({ type: 'simple-json', default: '["R1","R2","R3"]' })
    autoAcceptRoutes: string[];
    // 营业日历（§70）：指定日期休业（节假日/临时休业），当天 C 端「今日休业」并禁止下单
    /** 休业日期列表：[{date:'YYYY-MM-DD', note?}]，校园时区自然日；null/空=不启用 */
    @Column({ type: 'simple-json', nullable: true })
    closureDates: Array<{ date: string; note?: string | null }> | null;
    // 超时赔付（P0）：开关默认开，缺券模板时扫到会限频告警（等运营补配置）
    @Column({ default: true }) timeoutCompensationEnabled: boolean;
    @Column({ type: 'int', default: 10 }) timeoutGraceMinutes: number; // 超时宽限（分钟），超过才赔
    /** 超时赔付回扫窗口（小时）：只回补近 N 小时送达单（默认 24，可放大以覆盖更长账期） */
    @Column({ type: 'int', default: 24 }) timeoutCompensationWindowHours: number;
    @Column({ type: 'varchar', nullable: true }) timeoutCompensationCouponTemplateId: string | null;
    // 用户侧节点通知（公众号模板消息）：五个触点的模板 ID，未配置 = 该节点静默跳过
    @Column({ type: 'varchar', nullable: true }) notifyTemplateAccepted: string | null; // 商家已接单
    @Column({ type: 'varchar', nullable: true }) notifyTemplateRiderAssigned: string | null; // 骑手已接单
    @Column({ type: 'varchar', nullable: true }) notifyTemplateCookingDone: string | null; // 出餐完成
    @Column({ type: 'varchar', nullable: true }) notifyTemplateDelivered: string | null; // 已送达
    @Column({ type: 'varchar', nullable: true }) notifyTemplateExceptionHandled: string | null; // 异常处置完结
    @Column({ type: 'varchar', nullable: true }) notifyTemplateArrivedHandover: string | null; // 已到校园交接点
    @Column({ type: 'varchar', nullable: true }) notifyTemplateDeliveryFallback: string | null; // 配送方式降级/异常重派
    // 订单域通知（spec §4.1）：4 个模板 ID + H5 落地页域名（禁硬编码域名，per-channel 配置）
    @Column({ type: 'varchar', nullable: true }) notifyTemplateOrderPlaced: string | null; // 下单成功
    @Column({ type: 'varchar', nullable: true }) notifyTemplatePaymentPending: string | null; // 待付款提醒
    @Column({ type: 'varchar', nullable: true }) notifyTemplateCancelled: string | null; // 取消通知
    @Column({ type: 'varchar', nullable: true }) notifyTemplateAfterSales: string | null; // 售后进度
    @Column({ type: 'varchar', nullable: true }) notifyTemplateAddressChanged: string | null; // 改址成功
    @Column({ type: 'varchar', nullable: true }) h5BaseUrl: string | null; // C 端 H5 站点 origin，如 https://www.yourbao.cn
    @Column({ type: 'varchar', nullable: true }) printMode: string | null; // 商家小票打印时机 'off' | 'onPaid' | 'onAccepted'（null=off）
    // 云打印（P1-4）：local=前端 C-Lodop 本地打印；feie=飞鹅 / yilianyun=易联云
    /** 打印通道：local（默认）/ feie / yilianyun */
    @Column({ type: 'varchar', length: 16, default: 'local' }) printProvider: string;
    /** 服务商账号：飞鹅用户名 / 易联云 client_id */
    @Column({ type: 'varchar', length: 64, nullable: true }) printAccount: string | null;
    /** 设备编号：飞鹅 sn / 易联云 machine_code */
    @Column({ type: 'varchar', length: 64, nullable: true }) printDeviceSn: string | null;
    /** 服务商密钥：飞鹅 ukey / 易联云 client_secret */
    @Column({ type: 'varchar', length: 128, nullable: true }) printDeviceKey: string | null;
    /** 联数（1-5），默认 1 */
    @Column({ type: 'int', default: 1 }) printCopies: number;
    /** 第一段由谁送（按路线）：R1 = merchant|owned，R3 = campus|owned|external；缺省 R1=merchant、R3=campus */
    @Column({ type: 'simple-json', nullable: true })
    routeFirstLeg: Record<string, string> | null;
    /** 校园交接点：R1/R2 各一个（键为路线号） */
    @Column({ type: 'simple-json', nullable: true })
    handoverPoints: Record<string, Array<{ name: string; address?: string; phone?: string; lat: number; lng: number; isDefault?: boolean }>> | null;
    /** 外部快递各 provider 的门店编号：{ dada?: string, meituan?: string } */
    @Column({ type: 'simple-json', nullable: true })
    providerShopNo: Record<string, string> | null;
    /** R1 商户接单超时（分钟），超时自动转自营快递；0 = 不自动转 */
    @Column({ type: 'int', default: 5 }) merchantAcceptMinutes: number;
    /** 等运营推送外部快递的超时（分钟），超时退回抢单大厅 */
    @Column({ type: 'int', default: 10 }) externalPushTimeoutMinutes: number;
    /** 已推送外部快递但久未接单/取货的超时（分钟），超时取消并退回抢单大厅 */
    @Column({ type: 'int', default: 20 }) externalFallbackMinutes: number;
    @Column({ nullable: true, type: 'float' }) storeLat: number | null; // 档口/门店取货点纬度
    @Column({ nullable: true, type: 'float' }) storeLng: number | null; // 档口/门店取货点经度
    /** 动态配送计价配置（时段高峰/供需/手动倍率/封顶），null=关闭，回退分区固定运费 */
    @Column({ type: 'simple-json', nullable: true }) dynamicPricing: Record<string, any> | null;
    /** 接单班次校验：开启后骑手仅能在后台登记的排班时段内抢单 */
    @Column({ default: false }) shiftCheckEnabled: boolean;
    /** 自动拉黑阈值：近 30 天顾客主动取消订单达到该次数自动加入黑名单（0 = 关闭） */
    @Column({ type: 'int', default: 0 }) blacklistAutoCancelCount: number;
    // 号码保护（P0）：开启后骑手/商家/客服侧只拿到脱敏号或虚拟号，顾客真实号不下发
    @Column({ default: false }) privacyNumberEnabled: boolean;
    /** 隐私号服务商：mask=仅脱敏（零依赖兜底），mock=本地虚拟号，aliyun/tencent=外部号池 */
    @Column({ type: 'varchar', default: 'mask' }) privacyNumberProvider: string;
    /** 虚拟号有效期（分钟），过期后重新申请；仅外部号池 provider 生效 */
    @Column({ type: 'int', default: 60 }) privacyNumberTtlMinutes: number;
    /** 隐私号小号区号/号码池前缀（provider 需要时配置） */
    @Column({ type: 'varchar', nullable: true }) privacyNumberPrefix: string | null;
    /** 食安公示：食品经营许可证编号 */
    @Column({ type: 'varchar', nullable: true }) foodLicenseNo: string | null;
    /** 食安公示：许可证照片 URL */
    @Column({ type: 'varchar', nullable: true }) foodLicenseImage: string | null;
    /** 食安公示：许可证到期日 YYYY-MM-DD（临近/过期 C 端标红） */
    @Column({ type: 'varchar', nullable: true }) foodLicenseExpiry: string | null;
    /** 食安公示：量化分级 A/B/C（空=未评级） */
    @Column({ type: 'varchar', nullable: true }) foodSafetyGrade: string | null;
    /** 食安公示：食品安全承诺书照片 URL */
    @Column({ type: 'varchar', nullable: true }) foodSafetyCommitmentImage: string | null;
    /** 食安公示：明厨亮灶直播/回放地址（空=未开通） */
    @Column({ type: 'varchar', nullable: true }) kitchenLiveUrl: string | null;
    /** 食安公示：是否在 C 端展示明厨亮灶入口 */
    @Column({ default: false }) kitchenLiveEnabled: boolean;
    // 打包费/餐盒费（P1）：按单或按件计费，商品可覆盖单件费，结算时落一条 surcharge
    /** 打包费开关（默认关） */
    @Column({ default: false }) packingFeeEnabled: boolean;
    /** 计费方式：perItem=按件累加（默认）/ perOrder=每单固定 */
    @Column({ type: 'varchar', default: 'perItem' }) packingFeeMode: string;
    /** 打包费金额（分）：perItem=单件金额；perOrder=每单金额 */
    @Column({ type: 'int', default: 0 }) packingFeeAmount: number;
    /** 单笔封顶（分；null=不封顶） */
    @Column({ type: 'int', nullable: true }) packingFeeCap: number | null;
    /** C 端展示名称（空=「打包费」） */
    @Column({ type: 'varchar', nullable: true }) packingFeeLabel: string | null;
    // 小程序上架配置（P2-1）：上架前检查 + 审核状态留痕，供运营按渠道维护
    /** 小程序 AppID（wx + 16 位十六进制） */
    @Column({ type: 'varchar', length: 64, nullable: true }) mpAppId: string | null;
    /** 服务类目（如「餐饮/外卖」） */
    @Column({ type: 'varchar', length: 64, nullable: true }) mpCategory: string | null;
    /** 当前上架版本号（x.y.z） */
    @Column({ type: 'varchar', length: 32, nullable: true }) mpVersion: string | null;
    /** 上架状态：draft/inReview/online/rejected/offline */
    @Column({ type: 'varchar', length: 16, default: 'draft' }) mpListingStatus: string;
    /** 用户隐私保护指引地址（审核必填） */
    @Column({ type: 'varchar', length: 255, nullable: true }) mpPrivacyUrl: string | null;
    /** 审核备注 / 驳回原因 */
    @Column({ type: 'varchar', length: 500, nullable: true }) mpReviewNote: string | null;
    // 语音/拍照搜索（P2-2）：服务商按渠道可切换，none = 该入口关闭
    /** 语音搜索服务商：mock（内置模拟识别）/ none（未开启） */
    @Column({ type: 'varchar', length: 16, default: 'mock' }) voiceSearchProvider: string;
    /** 拍照搜索服务商：mock（内置模拟识别）/ none（未开启） */
    @Column({ type: 'varchar', length: 16, default: 'mock' }) imageSearchProvider: string;
    // 信任文案（§113）：评价页信任签名卡「质量→服务→时间」三行，店铺级自定义；空文案=C 端回落默认
    /** 质量行开关（默认开）：关=该行不展示 */
    @Column({ default: true }) trustQualityEnabled: boolean;
    /** 质量行自定义文案（空=回落 C 端默认文案） */
    @Column({ type: 'varchar', length: TRUST_TEXT_MAX_LENGTH, nullable: true }) trustQualityText: string | null;
    /** 服务行开关（默认开） */
    @Column({ default: true }) trustServiceEnabled: boolean;
    /** 服务行自定义文案（空=回落默认） */
    @Column({ type: 'varchar', length: TRUST_TEXT_MAX_LENGTH, nullable: true }) trustServiceText: string | null;
    /** 时间行开关（默认开） */
    @Column({ default: true }) trustTimeEnabled: boolean;
    /** 时间行自定义文案（空=回落默认） */
    @Column({ type: 'varchar', length: TRUST_TEXT_MAX_LENGTH, nullable: true }) trustTimeText: string | null;
    // 无人配送（P2-4）：接口占位，mock=模拟受理；真实厂商需 endpoint + key
    /** 无人配送通道总开关 */
    @Column({ default: false }) unmannedDeliveryEnabled: boolean;
    /** 通道服务商：none / mock / meituan / xinshiji */
    @Column({ type: 'varchar', length: 16, default: 'mock' }) unmannedDeliveryProvider: string;
    /** 通道接口地址（真实厂商必填） */
    @Column({ type: 'varchar', length: 255, nullable: true }) unmannedDeliveryEndpoint: string | null;
    /** 通道密钥（真实厂商必填；后台只回「是否已配置」，不回明文） */
    @Column({ type: 'varchar', length: 128, nullable: true }) unmannedDeliveryKey: string | null;
    constructor(input?: DeepPartial<CampusFulfillmentConfig>) {
        super(input);
    }
}
