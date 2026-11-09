import { Injectable } from '@nestjs/common';
import { Channel, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { CampusFulfillmentConfig, STORE_NOTICE_MAX_LENGTH } from './campus-fulfillment-config.entity';
import { CampusRoute, isRouteDeliverable, normalizeRouteFirstLeg, ROUTE_FIRST_LEG_OPTIONS } from './route-matrix';
import { isWithinBusinessHours } from './business-hours';
import { normalizePackingFeeMode, PACKING_FEE_MODES } from './packing-fee';
import { normalizeDeliveryFeeTiers } from './delivery-fee-tiers';
import { SEARCH_ASSIST_PROVIDER_NAMES } from './search-assist';
import { normalizeLimit, queryDailySold, remainingOf } from './daily-limit';
import { closedToday, safeClosureDates } from './closure-calendar';

export interface WaimaiStore {
    channelId: number;
    name: string;
    logo: string | null;
    tags: string[];
    monthlySales: number;
    promoText: string | null;
    paused: boolean;
    routesEnabled: string[];
    /** R1 是否可售：routesEnabled 之外还要求已配置可用交接点（与下单闸门同一判据，A1） */
    r1Available: boolean;
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
    routeFirstLeg: Array<{ route: string; carrier: string }>;
    handoverPoints: Array<{ route: string; name: string; address: string | null; phone: string | null; lat: number; lng: number; isDefault: boolean }>;
    providerShopNo: Array<{ provider: string; shopNo: string }>;
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

const PRINT_MODES = ['off', 'onPaid', 'onAccepted'] as const;
type PrintMode = (typeof PRINT_MODES)[number];

/** 小程序上架状态白名单（P2-1） */
const MP_LISTING_STATUSES = ['draft', 'inReview', 'online', 'rejected', 'offline'] as const;
type MpListingStatus = (typeof MP_LISTING_STATUSES)[number];

/** 上架前检查项：key → 读取 config 的必填值（key 与前端 i18n 对齐） */
const MP_REQUIRED_ITEMS: Array<[string, (cfg: CampusFulfillmentConfig | undefined) => string | null]> = [
    ['appId', cfg => cfg?.mpAppId ?? null],
    ['category', cfg => cfg?.mpCategory ?? null],
    ['version', cfg => cfg?.mpVersion ?? null],
    ['privacyUrl', cfg => cfg?.mpPrivacyUrl ?? null],
    ['contactPhone', cfg => cfg?.storePhone ?? null],
    ['licenseNo', cfg => cfg?.foodLicenseNo ?? null],
];

/** 上架前检查：返回缺项 key（空数组=可提交/可上架） */
export function mpListingMissing(cfg: CampusFulfillmentConfig | undefined): string[] {
    return MP_REQUIRED_ITEMS
        .filter(([, read]) => !String(read(cfg) ?? '').trim())
        .map(([key]) => key);
}

/** 上架状态归一化：脏值回 'draft'，避免后台展示空白状态 */
export function normalizeMpListingStatus(v: unknown): MpListingStatus {
    return MP_LISTING_STATUSES.includes(v as MpListingStatus) ? (v as MpListingStatus) : 'draft';
}

/** 打印通道白名单（P1-4）：local=本地 C-Lodop，feie=飞鹅云，yilianyun=易联云 */
export const PRINT_PROVIDERS = ['local', 'feie', 'yilianyun'] as const;

/** printMode 归一化：null/非法值一律回 'off'（存量行与脏配置兜底） */
export function normalizePrintMode(v: unknown): PrintMode {
    return PRINT_MODES.includes(v as PrintMode) ? (v as PrintMode) : 'off';
}

const ROUTE_WHITELIST = ['R1', 'R2', 'R3', 'R4', 'R5'];
/** 隐私号服务商白名单：mask=仅脱敏，mock=本地虚拟号，aliyun/tencent=外部号池（缺凭证自动降级为 mask） */
export const PRIVACY_PROVIDERS = ['mask', 'mock', 'aliyun', 'tencent'] as const;

/** M3：隐私号服务商实际生效口径（配置值 ≠ 生效值即降级，后台可直接看到） */
export interface PrivacyProviderStatus {
    /** 配置里选的服务商 */
    provider: string;
    /** 实际生效的服务商（外部号池未接入时回落 mask） */
    effective: 'mask' | 'mock' | 'aliyun' | 'tencent';
    degraded: boolean;
    note: string | null;
}

/** 外部号池凭证环境变量：缺失即降级为脱敏号 */
const PROVIDER_ENV: Record<string, string> = {
    aliyun: 'PRIVACY_ALIYUN_KEY',
    tencent: 'PRIVACY_TENCENT_KEY',
};

/**
 * 服务商生效口径（M3）：aliyun/tencent 号池接口尚未接入，
 * 即使配了凭证也只能回落脱敏号——统一算出「配置值 / 生效值 / 降级原因」，
 * 供后台配置视图与运行时 resolve 共用，避免被静默降级误导。
 */
export function privacyProviderStatus(
    cfg: { privacyNumberEnabled?: boolean | null; privacyNumberProvider?: string | null } | null | undefined,
): PrivacyProviderStatus {
    const configured = String(cfg?.privacyNumberProvider ?? 'mask');
    const provider = PRIVACY_PROVIDERS.includes(configured as any) ? configured : 'mask';
    if (!cfg?.privacyNumberEnabled) {
        return { provider, effective: provider as PrivacyProviderStatus['effective'], degraded: false, note: null };
    }
    if (provider === 'mock') {
        return { provider, effective: 'mock', degraded: false, note: 'mock 虚拟号仅本地演示，不会真实转接' };
    }
    if (provider === 'aliyun' || provider === 'tencent') {
        const envKey = PROVIDER_ENV[provider];
        const note = process.env[envKey]
            ? `${provider} 号池接口待接入，暂以脱敏号兜底`
            : `${provider} 号池未配置凭证（${envKey}），已降级为脱敏号`;
        return { provider, effective: 'mask', degraded: true, note };
    }
    return { provider: 'mask', effective: 'mask', degraded: false, note: null };
}

/**
 * L2：外卖准入行业判断——只有「显式配置为非餐饮」才剔除；
 * industryType 未设置（存量未刷成功 / 新建渠道漏填）时按餐饮处理，
 * 避免已有履约配置的店铺从 C 端列表与进店换取里静默消失。
 */
export function isCateringIndustry(cf: any): boolean {
    const industry = String(cf?.industryType ?? '').trim();
    return !industry || industry === 'catering';
}

/** 店铺展示名：渠道自定义字段 shopName（运营填写）→ 渠道 code。
 *  shopName 为空/空白时不能让 C 端或后台出现空白店名，统一兜底为渠道 code。 */
export function channelShopDisplayName(cf: any, code: string): string {
    const name = typeof cf?.shopName === 'string' ? cf.shopName.trim() : '';
    return name || code;
}

/** 食安量化分级：A/B/C（空=未评级） */
const FOOD_GRADES = ['A', 'B', 'C'] as const;

/** 数值配置合法区间（金额=分，时长=分钟）：与 campus-config 另一写入口同口径，超界直接拒绝 */
const INT_RANGES: Record<string, [number, number]> = {
    deliveryMinutes: [1, 240],
    minOrderAmount: [0, 10_000_000],
    deliveryFee: [0, 10_000_000],
    errandBaseFee: [0, 10_000_000],
    thirdPartyBaseFee: [0, 10_000_000],
    freeShippingThreshold: [0, 10_000_000],
    merchantAcceptMinutes: [0, 240],
    externalPushTimeoutMinutes: [1, 240],
    externalFallbackMinutes: [1, 240],
    packingFeeAmount: [0, 100_000],
    packingFeeCap: [0, 1_000_000],
};

/** R4 自提点标记：campus 配置管理的本渠道门店自提点（幂等 upsert 键，复用 cjk PickupLocation 体系） */
const CAMPUS_R4_REMARK = 'campus-r4';

/** 用户侧模板消息 ID 字段：未传即保留，避免后台表单漏传把已配模板清空 */
const NOTIFY_TEMPLATE_FIELDS = [
    'notifyTemplateAccepted', 'notifyTemplateRiderAssigned', 'notifyTemplateCookingDone',
    'notifyTemplateDelivered', 'notifyTemplateExceptionHandled', 'notifyTemplateArrivedHandover',
    'notifyTemplateDeliveryFallback', 'notifyTemplateOrderPlaced',
    'notifyTemplatePaymentPending', 'notifyTemplateCancelled', 'notifyTemplateAfterSales',
    'notifyTemplateAddressChanged',
] as const;

/** 单店进店换取限流：每 IP 每分钟 120 次（首屏并发换 token 足够，抑制批量枚举） */
const ENTRY_RATE_WINDOW_MS = 60_000;
const ENTRY_RATE_MAX = 120;

@Injectable()
export class WaimaiStoreService {
    private readonly entryRate = new Map<string, { start: number; count: number }>();

    constructor(private connection: TransactionalConnection) {}

    /**
     * 菜品每日限量/每人限购（§68）：当前渠道「有限量配置」的商品，返回当日已售与剩余。
     * 公开只读：未登录的顾客 myToday/myRemaining 为 null。
     */
    async dailyStock(ctx: RequestContext) {
        const raw = this.connection.rawConnection;
        const rows: any = await raw.query(
            'SELECT p.id AS "productId", '
            + 'COALESCE(p."customFieldsWaimaidailylimit", 0) AS "dailyLimit", '
            + 'COALESCE(p."customFieldsWaimaiperuserlimit", 0) AS "perUserLimit" '
            + 'FROM product p '
            + 'JOIN product_channels_channel pc ON pc."productId" = p.id AND pc."channelId" = $1 '
            + 'WHERE COALESCE(p."customFieldsWaimaidailylimit", 0) > 0 '
            + 'OR COALESCE(p."customFieldsWaimaiperuserlimit", 0) > 0',
            [ctx.channelId],
        );
        const list: any[] = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length) return [];

        const ids = list.map((r: any) => Number(r.productId));
        const soldMap = await queryDailySold(raw, Number(ctx.channelId), ids);
        let customerId: number | null = null;
        if (ctx.activeUserId) {
            const cRows: any = await raw.query('SELECT id FROM customer WHERE "userId" = $1 LIMIT 1', [ctx.activeUserId]);
            const cList: any[] = Array.isArray(cRows) && Array.isArray(cRows[0]) ? cRows[0] : cRows;
            if (cList?.[0]?.id != null) customerId = Number(cList[0].id);
        }
        const mineMap = customerId == null
            ? new Map<number, number>()
            : await queryDailySold(raw, Number(ctx.channelId), ids, { customerId });

        return list.map((r: any) => {
            const pid = Number(r.productId);
            const dailyLimit = normalizeLimit(r.dailyLimit);
            const perUserLimit = normalizeLimit(r.perUserLimit);
            const soldToday = soldMap.get(pid) ?? 0;
            const myToday = customerId == null ? null : (mineMap.get(pid) ?? 0);
            return {
                productId: pid,
                dailyLimit,
                perUserLimit,
                soldToday,
                remaining: remainingOf(dailyLimit, soldToday),
                myToday,
                myRemaining: customerId == null ? null : remainingOf(perUserLimit, myToday as number),
            };
        });
    }

    /** §113 公开只读：当前渠道的信任文案（评价页信任签名卡三行），空文案/无配置即回默认开启 + 空串 */
    async trustCopy(ctx: RequestContext): Promise<CampusStoreTrust> {
        const cfg = await this.connection.getRepository(ctx, CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId as any } });
        return {
            qualityEnabled: cfg?.trustQualityEnabled ?? true,
            qualityText: cfg?.trustQualityText || null,
            serviceEnabled: cfg?.trustServiceEnabled ?? true,
            serviceText: cfg?.trustServiceText || null,
            timeEnabled: cfg?.trustTimeEnabled ?? true,
            timeText: cfg?.trustTimeText || null,
        };
    }

    /** 店铺列表：有履约配置的渠道即外卖店铺（跨渠道公开元数据聚合，供 C 端首页）。
     * 不再下发 channelToken；C 端进店时按 channelId 调 campusStoreEntry 单店换取。 */
    async listStores(ctx: RequestContext): Promise<WaimaiStore[]> {
        const configs = await this.connection.getRepository(ctx, CampusFulfillmentConfig).find();
        const byChannel = new Map(configs.map(c => [Number(c.channelId), c]));
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const stores: WaimaiStore[] = [];
        const now = Date.now();
        for (const ch of channels) {
            const cfg = byChannel.get(Number(ch.id));
            if (!cfg) continue;
            if (ch.code === '__default_channel__') continue;   // 默认渠道是平台会话渠道，不是店铺（防脏配置污染 C 端列表/骑手大厅）
            const cf = (ch.customFields ?? {}) as any;
            const displayName = channelShopDisplayName(cf, ch.code);
            // 外卖准入：仅餐饮行业租户展示（设计文档 2026-10-09 §4.2；存量由 BackfillWaimaiIndustryMigration 刷数）。
            // 仅过滤 C 端列表；listStoreConfigs（admin 配置视图）不过滤，避免管理员看不到已配履约的非餐饮渠道。
            // L2：未设置行业按餐饮处理（只有显式非餐饮才剔除）。
            if (!isCateringIndustry(cf)) continue;
            // 营业日历（§70）：今日在休业名单中则整店休业（优先于营业时间判断）
            const closure = closedToday(safeClosureDates(cfg.closureDates, now), now);
            stores.push({
                channelId: Number(ch.id),
                name: displayName,
                logo: cf.waimaiLogo ?? null,
                tags: typeof cf.waimaiTags === 'string' && cf.waimaiTags.length
                    ? cf.waimaiTags.split(',').map((t: string) => t.trim()).filter(Boolean)
                    : [],
                monthlySales: cf.waimaiMonthlySales ?? 0,
                promoText: cf.waimaiPromoText ?? null,
                paused: cfg.paused,
                routesEnabled: cfg.routesEnabled ?? [],
                r1Available: isRouteDeliverable('R1', cfg as any),
                deliveryMinutes: cfg.deliveryMinutes ?? null,
                minOrderAmount: cfg.minOrderAmount ?? null,
                deliveryFee: cfg.deliveryFee ?? null,
                storeAddress: cfg.storeAddress ?? null,
                storePhone: cfg.storePhone ?? null,
                storeNotice: cfg.storeNotice ?? null,
                businessHours: cf.waimaiBusinessHours ?? null,
                // 营业状态（服务端按校园时区判定，与 C 端展示/下单闸门同口径）
                openNow: isWithinBusinessHours(cf.waimaiBusinessHours ?? null) && !cfg.paused && !closure,
                closedToday: !!closure,
                closureNote: closure?.note ?? null,
                errandBaseFee: cfg.errandBaseFee ?? null,
                freeShippingThreshold: cfg.freeShippingThreshold ?? null,
                deliveryFeeTiers: cfg.deliveryFeeTiers ? JSON.stringify(cfg.deliveryFeeTiers) : null,
                foodLicenseNo: cfg.foodLicenseNo ?? null,
                foodLicenseImage: cfg.foodLicenseImage ?? null,
                foodLicenseExpiry: cfg.foodLicenseExpiry ?? null,
                foodSafetyGrade: cfg.foodSafetyGrade ?? null,
                foodSafetyCommitmentImage: cfg.foodSafetyCommitmentImage ?? null,
                kitchenLiveUrl: cfg.kitchenLiveEnabled ? cfg.kitchenLiveUrl ?? null : null,
                kitchenLiveEnabled: cfg.kitchenLiveEnabled ?? false,
                packingFeeEnabled: cfg.packingFeeEnabled ?? false,
                packingFeeMode: normalizePackingFeeMode(cfg.packingFeeMode),
                packingFeeAmount: cfg.packingFeeAmount ?? 0,
                packingFeeCap: cfg.packingFeeCap ?? null,
                packingFeeLabel: cfg.packingFeeLabel ?? null,
            });
        }
        return stores;
    }

    /**
     * 单店进店换取渠道 token：仅对「有履约配置 + 非默认渠道 + 餐饮行业」的店铺下发，
     * 避免 public 列表一次性批量暴露全部渠道 token；每 IP 每分钟限流。
     */
    async storeEntry(ctx: RequestContext, channelId: number): Promise<CampusStoreEntry> {
        if (!Number.isInteger(channelId) || channelId <= 0) {
            throw new UserInputError('店铺不存在');
        }
        this.assertEntryRate(ctx);
        const channel = await this.connection.getRepository(ctx, Channel).findOne({ where: { id: channelId } });
        if (!channel || channel.code === '__default_channel__') {
            throw new UserInputError('店铺不存在');
        }
        const cfg = await this.connection
            .getRepository(ctx, CampusFulfillmentConfig)
            .findOne({ where: { channelId } });
        const cf = (channel.customFields ?? {}) as any;
        // L2：与列表同口径——只有显式非餐饮才拒绝，未设置行业按餐饮处理
        if (!cfg || !isCateringIndustry(cf)) {
            throw new UserInputError('店铺不存在');
        }
        return { channelId: Number(channel.id), channelToken: channel.token };
    }

    /** 单店换取的进程内滑动窗口限流（多实例时各实例独立计数） */
    private assertEntryRate(ctx: RequestContext): void {
        const req: any = (ctx as any).req;
        const forwarded = req?.headers?.['x-forwarded-for'];
        const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split?.(',')?.[0]?.trim()
            || req?.ip
            || 'unknown';
        const now = Date.now();
        const rec = this.entryRate.get(ip);
        if (!rec || now - rec.start >= ENTRY_RATE_WINDOW_MS) {
            this.entryRate.set(ip, { start: now, count: 1 });
            if (this.entryRate.size > 10_000) {
                for (const [key, value] of this.entryRate) {
                    if (now - value.start >= ENTRY_RATE_WINDOW_MS) this.entryRate.delete(key);
                }
            }
            return;
        }
        if (rec.count >= ENTRY_RATE_MAX) {
            throw new UserInputError('请求过于频繁，请稍后再试');
        }
        rec.count += 1;
    }

    /** admin：全店铺配置（跨渠道，join Channel 取店铺名/token；默认渠道是平台会话渠道，跳过） */
    async listStoreConfigs(ctx: RequestContext): Promise<CampusStoreConfigWithChannel[]> {
        const configs = await this.connection.getRepository(ctx, CampusFulfillmentConfig).find();
        const byChannel = new Map(configs.map(c => [Number(c.channelId), c]));
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const out: CampusStoreConfigWithChannel[] = [];
        for (const ch of channels) {
            if (ch.code === '__default_channel__') continue;
            const cfg = byChannel.get(Number(ch.id));
            out.push(this.toConfigView(Number(ch.id), channelShopDisplayName((ch.customFields ?? {}) as any, ch.code), ch.token, cfg));
        }
        return out;
    }

    /** admin：按 channelId upsert（幂等），routesEnabled 白名单 R1-R5，负数金额拒绝 */
    async updateStoreConfig(
        ctx: RequestContext,
        channelId: number,
        input: {
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
            deliveryFeeTiers?: Array<{ minAmount: number; fee: number }> | string | null;
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
            routeFirstLeg?: Array<{ route: string; carrier: string }> | null;
            handoverPoints?: Array<{ route: string; name: string; address?: string | null; phone?: string | null; lat: number; lng: number; isDefault?: boolean | null }> | null;
            providerShopNo?: Array<{ provider: string; shopNo: string }> | null;
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
        },
    ): Promise<CampusStoreConfigWithChannel> {
        // 路线去重：重复项会让开点校验/前端渲染出现重复楼层
        const routes = Array.from(new Set((input.routesEnabled ?? []).map(r => String(r))));
        const bad = routes.filter(r => !ROUTE_WHITELIST.includes(r));
        if (bad.length) throw new UserInputError(`不支持的配送路线: ${bad.join(', ')}（仅接受 R1-R5）`);
        if (input.printMode != null && !PRINT_MODES.includes(input.printMode as PrintMode)) {
            throw new UserInputError(`不支持的打印模式: ${input.printMode}（仅接受 off/onPaid/onAccepted）`);
        }
        // 数值字段：有限数 + 区间校验 + 整数归一（金额为分），超界一律拒绝，避免脏值污染运费/超时链路
        const nums: Record<string, number> = {};
        for (const [key, [min, max]] of Object.entries(INT_RANGES)) {
            const raw = (input as any)[key];
            if (raw == null) continue;
            const n = Number(raw);
            if (!Number.isFinite(n)) throw new UserInputError(`${key} 必须是数字`);
            if (n < 0) throw new UserInputError(`${key} 不能为负数`);
            if (n > max) throw new UserInputError(`${key} 超出允许上限（${max}）`);
            if (n < min) throw new UserInputError(`${key} 不能小于 ${min}`);
            nums[key] = Math.round(n);
        }

        // 第一段承运：只有 R1（merchant|owned）、R3（campus|owned|external）可配
        const routeFirstLeg: Record<string, string> = {};
        for (const item of input.routeFirstLeg ?? []) {
            const route = String(item?.route ?? '');
            if (route !== 'R1' && route !== 'R3') {
                throw new UserInputError(`路线 ${route || '(空)'} 不支持配置第一段承运方（仅 R1、R3）`);
            }
            const carrier = normalizeRouteFirstLeg(route, item?.carrier);
            if (!carrier) {
                throw new UserInputError(
                    `路线 ${route} 的第一段承运方不合法: ${item?.carrier ?? '(空)'}（可选 ${ROUTE_FIRST_LEG_OPTIONS[route as CampusRoute].join('/')}）`,
                );
            }
            routeFirstLeg[route] = carrier;
        }

        // 校园交接点：只有 R1、R2 需要；同一路线可配多个，按楼栋距离选最近，默认点做无坐标兜底
        const handoverPoints: Record<string, Array<{ name: string; address?: string; phone?: string; lat: number; lng: number; isDefault?: boolean }>> = {};
        for (const item of input.handoverPoints ?? []) {
            const route = String(item?.route ?? '');
            if (route !== 'R1' && route !== 'R2') {
                throw new UserInputError(`路线 ${route || '(空)'} 不需要校园交接点（仅 R1、R2）`);
            }
            const name = String(item?.name ?? '').trim();
            const lat = Number(item?.lat);
            const lng = Number(item?.lng);
            if (!name) throw new UserInputError(`路线 ${route} 的交接点名称不能为空`);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
                throw new UserInputError(`路线 ${route} 的交接点经纬度不合法`);
            }
            (handoverPoints[route] ??= []).push({
                name,
                address: item?.address?.trim() || undefined,
                phone: item?.phone?.trim() || undefined,
                lat,
                lng,
                ...(item?.isDefault ? { isDefault: true } : {}),
            });
        }
        // 每条路线只保留一个默认点：已标注取第一个，未标注取该路线第一个
        for (const list of Object.values(handoverPoints)) {
            let seen = false;
            for (const p of list) {
                if (p.isDefault && !seen) seen = true;
                else delete p.isDefault;
            }
            if (!seen && list[0]) list[0].isDefault = true;
        }

        // 外部快递门店编号：外部快递用哪家由运营中心派单时决定，这里只存各家的门店编号
        const providerShopNo: Record<string, string> = {};
        for (const item of input.providerShopNo ?? []) {
            const provider = String(item?.provider ?? '');
            if (provider !== 'dada' && provider !== 'meituan') {
                throw new UserInputError(`不支持的外部快递: ${provider || '(空)'}（仅 dada/meituan）`);
            }
            const shopNo = String(item?.shopNo ?? '').trim();
            if (shopNo) providerShopNo[provider] = shopNo;
        }
        const chRepo = this.connection.getRepository(ctx, Channel);
        const ch = (await chRepo.find()).find(c => Number(c.id) === Number(channelId));
        if (!ch) throw new UserInputError(`渠道不存在: ${channelId}`);
        const repo = this.connection.getRepository(ctx, CampusFulfillmentConfig);
        let cfg = await repo.findOne({ where: { channelId: channelId as any } });
        if (!cfg) cfg = new CampusFulfillmentConfig({ channelId: channelId as any });
        // 记录「本次新开通」的路线：只有新开通 R1/R2 才强制交接点，历史配置（已开通但缺点）不阻断其它字段编辑
        const prevEnabled = [...(cfg.routesEnabled ?? [])];
        cfg.routesEnabled = routes;
        // 未传（undefined）即保留原值，只有显式传 null 才清空：
        // 旧后台表单不认识的新字段、局部更新（如只改公告）都不会把已有配置意外抹掉。
        if (input.deliveryMinutes !== undefined) cfg.deliveryMinutes = nums.deliveryMinutes ?? null;
        if (input.minOrderAmount !== undefined) cfg.minOrderAmount = nums.minOrderAmount ?? null;
        if (input.deliveryFee !== undefined) cfg.deliveryFee = nums.deliveryFee ?? null;
        if (input.storeAddress !== undefined) cfg.storeAddress = input.storeAddress ?? null;
        if (input.storePhone !== undefined) cfg.storePhone = input.storePhone ?? null;
        if (input.storeNotice !== undefined) {
            const notice = input.storeNotice == null ? null : String(input.storeNotice);
            if (notice && notice.length > STORE_NOTICE_MAX_LENGTH) {
                throw new UserInputError(`店铺公告最多 ${STORE_NOTICE_MAX_LENGTH} 字`);
            }
            cfg.storeNotice = notice;
        }
        if (input.errandBaseFee !== undefined) cfg.errandBaseFee = nums.errandBaseFee ?? null;
        // 第三方到校基价：未传即保留（旧表单不清空）；传 null 表示不接管顾客侧运费
        if (input.thirdPartyBaseFee !== undefined) cfg.thirdPartyBaseFee = nums.thirdPartyBaseFee ?? null;
        if (input.freeShippingThreshold !== undefined) cfg.freeShippingThreshold = nums.freeShippingThreshold ?? null;
        // 配送费阶梯（P3-4）：未传即保留；传 null/空串关闭；JSON 解析失败或档位非法直接拒绝
        if (input.deliveryFeeTiers !== undefined) {
            let raw: any = input.deliveryFeeTiers;
            if (typeof raw === 'string') {
                const text = raw.trim();
                if (!text) raw = null;
                else {
                    try {
                        raw = JSON.parse(text);
                    } catch {
                        throw new UserInputError('配送费阶梯不是合法 JSON');
                    }
                }
            }
            try {
                cfg.deliveryFeeTiers = normalizeDeliveryFeeTiers(raw);
            } catch (e: any) {
                throw new UserInputError(e?.message || '配送费阶梯不合法');
            }
        }
        for (const key of NOTIFY_TEMPLATE_FIELDS) {
            if (input[key] !== undefined) (cfg as any)[key] = input[key] ?? null;
        }
        if (input.h5BaseUrl !== undefined) cfg.h5BaseUrl = input.h5BaseUrl ?? null;
        /** 空串归一为 null（未配置即 C 端/小票不渲染）；undefined=保留原值 */
        const nullableText = (v: string | null | undefined) => (v === undefined ? undefined : String(v ?? '').trim() || null);
        if (input.printMode !== undefined) {
            cfg.printMode = input.printMode == null || input.printMode === '' ? 'off' : input.printMode;
        }
        // 云打印通道（P1-4）：local 走前端 C-Lodop；云通道必须备齐账号/设备/密钥，否则自动出票必然失败
        if (input.printProvider !== undefined && input.printProvider !== null) {
            const provider = String(input.printProvider).trim();
            if (!PRINT_PROVIDERS.includes(provider as any)) {
                throw new UserInputError(`不支持的打印通道: ${provider || '(空)'}（仅接受 ${PRINT_PROVIDERS.join('/')}）`);
            }
            cfg.printProvider = provider;
        }
        if (input.printAccount !== undefined) cfg.printAccount = nullableText(input.printAccount) ?? null;
        if (input.printDeviceSn !== undefined) cfg.printDeviceSn = nullableText(input.printDeviceSn) ?? null;
        if (input.printDeviceKey !== undefined) cfg.printDeviceKey = nullableText(input.printDeviceKey) ?? null;
        if (input.printCopies !== undefined && input.printCopies !== null) {
            const copies = Number(input.printCopies);
            if (!Number.isInteger(copies) || copies < 1 || copies > 5) {
                throw new UserInputError('打印联数必须为 1-5 的整数');
            }
            cfg.printCopies = copies;
        }
        // 未配置时与运行侧（cloud-print / merchant-admin）保持同一默认值 local，避免旧配置/裸对象被误判为云通道
        if (String(cfg.printProvider ?? 'local') !== 'local'
            && (!cfg.printAccount || !cfg.printDeviceSn || !cfg.printDeviceKey)) {
            throw new UserInputError('选择云打印时请填写服务商账号、设备编号与密钥');
        }
        // 超时赔付：未传即保留（旧表单不会清空已配值）
        if (input.timeoutCompensationEnabled != null) cfg.timeoutCompensationEnabled = input.timeoutCompensationEnabled;
        if (input.timeoutGraceMinutes != null) cfg.timeoutGraceMinutes = input.timeoutGraceMinutes;
        if (input.timeoutCompensationWindowHours != null) {
            const hours = Number(input.timeoutCompensationWindowHours);
            if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
                throw new UserInputError('赔付回扫窗口必须为 1-168 的整数（小时）');
            }
            cfg.timeoutCompensationWindowHours = hours;
        }
        if (input.timeoutCompensationCouponTemplateId !== undefined) {
            cfg.timeoutCompensationCouponTemplateId = input.timeoutCompensationCouponTemplateId || null;
        }
        // 未传即保留：后台旧表单不认识的字段不被清空
        if (input.routeFirstLeg !== undefined) cfg.routeFirstLeg = input.routeFirstLeg === null ? null : routeFirstLeg;
        if (input.handoverPoints !== undefined) cfg.handoverPoints = input.handoverPoints === null ? null : handoverPoints;
        if (input.providerShopNo !== undefined) cfg.providerShopNo = input.providerShopNo === null ? null : providerShopNo;
        if (input.merchantAcceptMinutes != null) cfg.merchantAcceptMinutes = nums.merchantAcceptMinutes;
        if (input.externalPushTimeoutMinutes != null) cfg.externalPushTimeoutMinutes = nums.externalPushTimeoutMinutes;
        if (input.externalFallbackMinutes != null) cfg.externalFallbackMinutes = nums.externalFallbackMinutes;
        // 门店坐标：R2/R3 距离计算与动态计价依赖，必须为有限数且在合法经纬度范围内
        for (const [key, limit] of [['storeLat', 90], ['storeLng', 180]] as const) {
            if (input[key] === undefined) continue;
            if (input[key] == null) {
                cfg[key] = null;
                continue;
            }
            const n = Number(input[key]);
            if (!Number.isFinite(n) || Math.abs(n) > limit) {
                throw new UserInputError(`${key} 不合法（需 -${limit}~${limit} 的有限数）`);
            }
            cfg[key] = n;
        }
        // 动态计价：未传即保留；传 null/'' 关闭。写入前解析校验，坏 JSON 直接拒绝
        if (input.dynamicPricing !== undefined) {
            if (input.dynamicPricing === null || input.dynamicPricing.trim() === '') {
                cfg.dynamicPricing = null;
            } else {
                let parsed: any;
                try {
                    parsed = JSON.parse(input.dynamicPricing);
                } catch {
                    throw new UserInputError('动态计价配置不是合法 JSON');
                }
                if (!parsed || typeof parsed !== 'object') throw new UserInputError('动态计价配置必须是 JSON 对象');
                cfg.dynamicPricing = parsed;
            }
        }

        // 号码保护：provider 白名单 + TTL 区间；外部号池缺凭证时由 PrivacyNumberService 运行时降级为脱敏
        if (input.privacyNumberEnabled != null) cfg.privacyNumberEnabled = !!input.privacyNumberEnabled;
        if (input.privacyNumberProvider != null) {
            const provider = String(input.privacyNumberProvider || '').trim();
            if (!PRIVACY_PROVIDERS.includes(provider as any)) {
                throw new UserInputError(`不支持的隐私号服务商: ${provider || '(空)'}（仅接受 ${PRIVACY_PROVIDERS.join('/')}）`);
            }
            cfg.privacyNumberProvider = provider;
        }
        if (input.privacyNumberTtlMinutes != null) {
            const ttl = Number(input.privacyNumberTtlMinutes);
            if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) {
                throw new UserInputError('隐私号有效期必须为 1-1440 的整数（分钟）');
            }
            cfg.privacyNumberTtlMinutes = ttl;
        }
        if (input.privacyNumberPrefix !== undefined) {
            cfg.privacyNumberPrefix = String(input.privacyNumberPrefix ?? '').trim() || null;
        }

        // 食安公示：空串归一为 null（未配置即 C 端不渲染）；等级/到期日做格式校验
        if (input.foodLicenseNo !== undefined) cfg.foodLicenseNo = nullableText(input.foodLicenseNo) ?? null;
        if (input.foodLicenseImage !== undefined) cfg.foodLicenseImage = nullableText(input.foodLicenseImage) ?? null;
        if (input.foodSafetyCommitmentImage !== undefined) {
            cfg.foodSafetyCommitmentImage = nullableText(input.foodSafetyCommitmentImage) ?? null;
        }
        if (input.kitchenLiveUrl !== undefined) cfg.kitchenLiveUrl = nullableText(input.kitchenLiveUrl) ?? null;
        if (input.foodLicenseExpiry !== undefined) {
            const expiry = nullableText(input.foodLicenseExpiry);
            if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
                throw new UserInputError('食品经营许可证到期日格式必须为 YYYY-MM-DD');
            }
            cfg.foodLicenseExpiry = expiry ?? null;
        }
        if (input.foodSafetyGrade !== undefined) {
            const grade = nullableText(input.foodSafetyGrade);
            if (grade && !FOOD_GRADES.includes(grade as any)) {
                throw new UserInputError(`食品安全量化分级仅接受 ${FOOD_GRADES.join('/')}（空=未评级）`);
            }
            cfg.foodSafetyGrade = grade ?? null;
        }
        if (input.kitchenLiveEnabled != null) cfg.kitchenLiveEnabled = !!input.kitchenLiveEnabled;
        // 明厨亮灶入口必须真的有地址，避免 C 端出现点不开的死入口
        if (cfg.kitchenLiveEnabled && !cfg.kitchenLiveUrl) {
            throw new UserInputError('开启明厨亮灶前请先填写直播/回放地址');
        }

        // 打包费：计费方式白名单 + 金额区间（nums 已做归一），开启时金额必须 > 0 且封顶不低于金额
        if (input.packingFeeEnabled != null) cfg.packingFeeEnabled = !!input.packingFeeEnabled;
        if (input.packingFeeMode != null) {
            const mode = String(input.packingFeeMode || '').trim();
            if (!PACKING_FEE_MODES.includes(mode as any)) {
                throw new UserInputError(`不支持的打包费计费方式: ${mode || '(空)'}（仅接受 ${PACKING_FEE_MODES.join('/')}）`);
            }
            cfg.packingFeeMode = mode;
        }
        if (input.packingFeeAmount !== undefined) cfg.packingFeeAmount = nums.packingFeeAmount ?? 0;
        if (input.packingFeeCap !== undefined) cfg.packingFeeCap = nums.packingFeeCap ?? null;
        if (input.packingFeeLabel !== undefined) cfg.packingFeeLabel = nullableText(input.packingFeeLabel) ?? null;
        if (cfg.packingFeeEnabled && (cfg.packingFeeAmount ?? 0) <= 0) {
            throw new UserInputError('开启打包费时请填写大于 0 的金额');
        }
        if (cfg.packingFeeCap != null && cfg.packingFeeAmount != null && cfg.packingFeeCap < cfg.packingFeeAmount) {
            throw new UserInputError('打包费单笔封顶不能小于单件/每单金额');
        }

        // 小程序上架（P2-1）：AppID/版本/隐私指引做格式校验；置为已上架前必须通过上架前检查
        if (input.mpAppId !== undefined) {
            const appId = nullableText(input.mpAppId);
            if (appId && !/^wx[0-9a-f]{16}$/i.test(appId)) {
                throw new UserInputError('小程序 AppID 格式不合法（应为 wx + 16 位十六进制）');
            }
            cfg.mpAppId = appId ?? null;
        }
        if (input.mpCategory !== undefined) {
            const cat = nullableText(input.mpCategory);
            if (cat && cat.length > 64) throw new UserInputError('小程序服务类目不能超过 64 字符');
            cfg.mpCategory = cat ?? null;
        }
        if (input.mpVersion !== undefined) {
            const ver = nullableText(input.mpVersion);
            if (ver && !/^\d{1,3}(\.\d{1,3}){1,2}$/.test(ver)) {
                throw new UserInputError('小程序版本号格式不合法（应为 x.y 或 x.y.z）');
            }
            cfg.mpVersion = ver ?? null;
        }
        if (input.mpPrivacyUrl !== undefined) {
            const url = nullableText(input.mpPrivacyUrl);
            if (url && (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 255)) {
                throw new UserInputError('隐私保护指引地址必须是 http(s) 链接且不超过 255 字符');
            }
            cfg.mpPrivacyUrl = url ?? null;
        }
        if (input.mpReviewNote !== undefined) {
            const note = nullableText(input.mpReviewNote);
            if (note && note.length > 500) throw new UserInputError('审核备注不能超过 500 字符');
            cfg.mpReviewNote = note ?? null;
        }
        if (input.mpListingStatus != null) {
            const status = String(input.mpListingStatus || '').trim();
            if (!MP_LISTING_STATUSES.includes(status as MpListingStatus)) {
                throw new UserInputError(
                    `不支持的上架状态: ${status || '(空)'}（仅接受 ${MP_LISTING_STATUSES.join('/')}）`,
                );
            }
            cfg.mpListingStatus = status as MpListingStatus;
        }
        // 置为「已上架」前必须齐全，避免审核资料缺项却对外宣称已上架
        if (cfg.mpListingStatus === 'online') {
            const missing = mpListingMissing(cfg);
            if (missing.length) {
                throw new UserInputError(`上架前请先补齐：${missing.join('、')}`);
            }
        }

        // 语音/拍照搜索（P2-2）：服务商白名单；none = 该入口关闭，未传（undefined）保留原值
        for (const [field, label] of [['voiceSearchProvider', '语音搜索'], ['imageSearchProvider', '拍照搜索']] as const) {
            if (input[field] === undefined) continue;
            const provider = String(input[field] ?? '').trim();
            if (!SEARCH_ASSIST_PROVIDER_NAMES.includes(provider as any)) {
                throw new UserInputError(
                    `不支持的${label}服务商: ${provider || '(空)'}（仅接受 ${SEARCH_ASSIST_PROVIDER_NAMES.join('/')}）`,
                );
            }
            (cfg as any)[field] = provider;
        }

        // 跨字段：新开通 R1/R2 必须有至少一个可用交接点（名称+经纬度），否则订单会降级为传信者到店取餐
        const enabled = routes;
        const hasPoint = (r: 'R1' | 'R2') => {
            const raw = cfg.handoverPoints?.[r];
            const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
            return list.some(p => !!String(p?.name ?? '').trim() && p?.lat != null && p?.lng != null);
        };
        const missingPoint = (['R1', 'R2'] as const).filter(
            r => enabled.includes(r) && !prevEnabled.includes(r) && !hasPoint(r),
        );
        if (missingPoint.length) {
            throw new UserInputError(`开通 ${missingPoint.join('、')} 需要先填写至少一个校园交接点（名称+经纬度）`);
        }
        await repo.save(cfg);
        const address = (input.storeAddress ?? '').trim();
        if (address) {
            // R4：同步幂等 upsert 本渠道门店自提点（名称=店铺名，地址=storeAddress），核销走 pickup_redemption 零新表
            await this.upsertStorePickupLocation(Number(channelId), ch.code, address, (input.storePhone ?? '').trim() || null);
        }
        return this.toConfigView(channelId, channelShopDisplayName((ch.customFields ?? {}) as any, ch.code), ch.token, cfg);
    }

    /** 经 rawConnection 按实体名取 repo（避免对 cjk-plugin 的构建期依赖；PickupLocation 由 cjk-plugin 注册于同一进程）。
     * 可见性：isPublic=false + ownerChannelId=本渠道 + channels 含本渠道 → shop 端 applyVisibility 对本渠道可见（cjk pickup-location.service.ts:35）。 */
    private async upsertStorePickupLocation(channelId: number, name: string, address: string, phone: string | null) {
        const repo = this.connection.rawConnection.getRepository('PickupLocation');
        const existing = await repo.findOne({ where: { ownerChannelId: channelId, remark: CAMPUS_R4_REMARK } });
        if (existing) {
            existing.name = name;
            existing.address = address;
            existing.phoneNumber = phone;
            existing.enabled = true;
            await repo.save(existing);
            return existing;
        }
        return repo.save({
            name,
            address,
            phoneNumber: phone,
            type: 'store',
            stockType: 'own',
            enabled: true,
            isPublic: false,
            ownerChannelId: channelId,
            channels: [{ id: channelId }],
            remark: CAMPUS_R4_REMARK,
        });
    }

    private toConfigView(
        channelId: number,
        channelName: string,
        channelToken: string,
        cfg: CampusFulfillmentConfig | undefined,
    ): CampusStoreConfigWithChannel {
        const privacyStatus = privacyProviderStatus(cfg);
        return {
            channelId,
            channelName,
            channelToken,
            routesEnabled: cfg?.routesEnabled ?? [],
            deliveryMinutes: cfg?.deliveryMinutes ?? null,
            minOrderAmount: cfg?.minOrderAmount ?? null,
            deliveryFee: cfg?.deliveryFee ?? null,
            storeAddress: cfg?.storeAddress ?? null,
            storePhone: cfg?.storePhone ?? null,
            storeNotice: cfg?.storeNotice ?? null,
            errandBaseFee: cfg?.errandBaseFee ?? null,
            thirdPartyBaseFee: cfg?.thirdPartyBaseFee ?? null,
            freeShippingThreshold: cfg?.freeShippingThreshold ?? null,
            deliveryFeeTiers: cfg?.deliveryFeeTiers ? JSON.stringify(cfg.deliveryFeeTiers) : null,
            notifyTemplateAccepted: cfg?.notifyTemplateAccepted ?? null,
            notifyTemplateRiderAssigned: cfg?.notifyTemplateRiderAssigned ?? null,
            notifyTemplateCookingDone: cfg?.notifyTemplateCookingDone ?? null,
            notifyTemplateDelivered: cfg?.notifyTemplateDelivered ?? null,
            notifyTemplateExceptionHandled: cfg?.notifyTemplateExceptionHandled ?? null,
            notifyTemplateArrivedHandover: cfg?.notifyTemplateArrivedHandover ?? null,
            notifyTemplateDeliveryFallback: cfg?.notifyTemplateDeliveryFallback ?? null,
            notifyTemplateOrderPlaced: cfg?.notifyTemplateOrderPlaced ?? null,
            notifyTemplatePaymentPending: cfg?.notifyTemplatePaymentPending ?? null,
            notifyTemplateCancelled: cfg?.notifyTemplateCancelled ?? null,
            notifyTemplateAfterSales: cfg?.notifyTemplateAfterSales ?? null,
            notifyTemplateAddressChanged: cfg?.notifyTemplateAddressChanged ?? null,
            h5BaseUrl: cfg?.h5BaseUrl ?? null,
            printMode: normalizePrintMode(cfg?.printMode),
            printProvider: cfg?.printProvider ?? 'local',
            printAccount: cfg?.printAccount ?? null,
            printDeviceSn: cfg?.printDeviceSn ?? null,
            printDeviceKey: cfg?.printDeviceKey ?? null,
            printCopies: cfg?.printCopies ?? 1,
            // 与实体默认值一致（timeoutCompensationEnabled default true）：无配置行时也应显示「已开启」
            timeoutCompensationEnabled: cfg?.timeoutCompensationEnabled ?? true,
            timeoutGraceMinutes: cfg?.timeoutGraceMinutes ?? 10,
            timeoutCompensationWindowHours: cfg?.timeoutCompensationWindowHours ?? 24,
            timeoutCompensationCouponTemplateId: cfg?.timeoutCompensationCouponTemplateId ?? null,
            routeFirstLeg: Object.entries(cfg?.routeFirstLeg ?? {}).map(([route, carrier]) => ({ route, carrier })),
            handoverPoints: Object.entries(cfg?.handoverPoints ?? {}).flatMap(([route, raw]) =>
                (Array.isArray(raw) ? raw : raw ? [raw] : []).map(p => ({
                    route,
                    name: p.name,
                    address: p.address ?? null,
                    phone: p.phone ?? null,
                    lat: p.lat,
                    lng: p.lng,
                    isDefault: !!p.isDefault,
                })),
            ),
            providerShopNo: Object.entries(cfg?.providerShopNo ?? {}).map(([provider, shopNo]) => ({ provider, shopNo })),
            merchantAcceptMinutes: cfg?.merchantAcceptMinutes ?? 5,
            externalPushTimeoutMinutes: cfg?.externalPushTimeoutMinutes ?? 10,
            externalFallbackMinutes: cfg?.externalFallbackMinutes ?? 20,
            storeLat: cfg?.storeLat ?? null,
            storeLng: cfg?.storeLng ?? null,
            dynamicPricing: cfg?.dynamicPricing ? JSON.stringify(cfg.dynamicPricing) : null,
            privacyNumberEnabled: cfg?.privacyNumberEnabled ?? false,
            privacyNumberProvider: cfg?.privacyNumberProvider ?? 'mask',
            privacyNumberEffectiveProvider: privacyStatus.effective,
            privacyNumberDegraded: privacyStatus.degraded,
            privacyNumberNote: privacyStatus.note,
            privacyNumberTtlMinutes: cfg?.privacyNumberTtlMinutes ?? 60,
            privacyNumberPrefix: cfg?.privacyNumberPrefix ?? null,
            foodLicenseNo: cfg?.foodLicenseNo ?? null,
            foodLicenseImage: cfg?.foodLicenseImage ?? null,
            foodLicenseExpiry: cfg?.foodLicenseExpiry ?? null,
            foodSafetyGrade: cfg?.foodSafetyGrade ?? null,
            foodSafetyCommitmentImage: cfg?.foodSafetyCommitmentImage ?? null,
            kitchenLiveUrl: cfg?.kitchenLiveUrl ?? null,
            kitchenLiveEnabled: cfg?.kitchenLiveEnabled ?? false,
            packingFeeEnabled: cfg?.packingFeeEnabled ?? false,
            packingFeeMode: normalizePackingFeeMode(cfg?.packingFeeMode),
            packingFeeAmount: cfg?.packingFeeAmount ?? 0,
            packingFeeCap: cfg?.packingFeeCap ?? null,
            packingFeeLabel: cfg?.packingFeeLabel ?? null,
            mpAppId: cfg?.mpAppId ?? null,
            mpCategory: cfg?.mpCategory ?? null,
            mpVersion: cfg?.mpVersion ?? null,
            mpListingStatus: normalizeMpListingStatus(cfg?.mpListingStatus),
            mpPrivacyUrl: cfg?.mpPrivacyUrl ?? null,
            mpReviewNote: cfg?.mpReviewNote ?? null,
            mpReady: mpListingMissing(cfg).length === 0,
            mpMissing: mpListingMissing(cfg),
            voiceSearchProvider: cfg?.voiceSearchProvider || 'mock',
            imageSearchProvider: cfg?.imageSearchProvider || 'mock',
        };
    }
}