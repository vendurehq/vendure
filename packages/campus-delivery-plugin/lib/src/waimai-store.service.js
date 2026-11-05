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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaimaiStoreService = exports.PRIVACY_PROVIDERS = exports.PRINT_PROVIDERS = void 0;
exports.mpListingMissing = mpListingMissing;
exports.normalizeMpListingStatus = normalizeMpListingStatus;
exports.normalizePrintMode = normalizePrintMode;
exports.privacyProviderStatus = privacyProviderStatus;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const route_matrix_1 = require("./route-matrix");
const business_hours_1 = require("./business-hours");
const packing_fee_1 = require("./packing-fee");
const delivery_fee_tiers_1 = require("./delivery-fee-tiers");
const search_assist_1 = require("./search-assist");
const daily_limit_1 = require("./daily-limit");
const closure_calendar_1 = require("./closure-calendar");
const PRINT_MODES = ['off', 'onPaid', 'onAccepted'];
/** 小程序上架状态白名单（P2-1） */
const MP_LISTING_STATUSES = ['draft', 'inReview', 'online', 'rejected', 'offline'];
/** 上架前检查项：key → 读取 config 的必填值（key 与前端 i18n 对齐） */
const MP_REQUIRED_ITEMS = [
    ['appId', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.mpAppId) !== null && _a !== void 0 ? _a : null; }],
    ['category', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.mpCategory) !== null && _a !== void 0 ? _a : null; }],
    ['version', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.mpVersion) !== null && _a !== void 0 ? _a : null; }],
    ['privacyUrl', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.mpPrivacyUrl) !== null && _a !== void 0 ? _a : null; }],
    ['contactPhone', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.storePhone) !== null && _a !== void 0 ? _a : null; }],
    ['licenseNo', cfg => { var _a; return (_a = cfg === null || cfg === void 0 ? void 0 : cfg.foodLicenseNo) !== null && _a !== void 0 ? _a : null; }],
];
/** 上架前检查：返回缺项 key（空数组=可提交/可上架） */
function mpListingMissing(cfg) {
    return MP_REQUIRED_ITEMS
        .filter(([, read]) => { var _a; return !String((_a = read(cfg)) !== null && _a !== void 0 ? _a : '').trim(); })
        .map(([key]) => key);
}
/** 上架状态归一化：脏值回 'draft'，避免后台展示空白状态 */
function normalizeMpListingStatus(v) {
    return MP_LISTING_STATUSES.includes(v) ? v : 'draft';
}
/** 打印通道白名单（P1-4）：local=本地 C-Lodop，feie=飞鹅云，yilianyun=易联云 */
exports.PRINT_PROVIDERS = ['local', 'feie', 'yilianyun'];
/** printMode 归一化：null/非法值一律回 'off'（存量行与脏配置兜底） */
function normalizePrintMode(v) {
    return PRINT_MODES.includes(v) ? v : 'off';
}
const ROUTE_WHITELIST = ['R1', 'R2', 'R3', 'R4', 'R5'];
/** 隐私号服务商白名单：mask=仅脱敏，mock=本地虚拟号，aliyun/tencent=外部号池（缺凭证自动降级为 mask） */
exports.PRIVACY_PROVIDERS = ['mask', 'mock', 'aliyun', 'tencent'];
/** 外部号池凭证环境变量：缺失即降级为脱敏号 */
const PROVIDER_ENV = {
    aliyun: 'PRIVACY_ALIYUN_KEY',
    tencent: 'PRIVACY_TENCENT_KEY',
};
/**
 * 服务商生效口径（M3）：aliyun/tencent 号池接口尚未接入，
 * 即使配了凭证也只能回落脱敏号——统一算出「配置值 / 生效值 / 降级原因」，
 * 供后台配置视图与运行时 resolve 共用，避免被静默降级误导。
 */
function privacyProviderStatus(cfg) {
    var _a;
    const configured = String((_a = cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberProvider) !== null && _a !== void 0 ? _a : 'mask');
    const provider = exports.PRIVACY_PROVIDERS.includes(configured) ? configured : 'mask';
    if (!(cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberEnabled)) {
        return { provider, effective: provider, degraded: false, note: null };
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
function isCateringIndustry(cf) {
    var _a;
    const industry = String((_a = cf === null || cf === void 0 ? void 0 : cf.industryType) !== null && _a !== void 0 ? _a : '').trim();
    return !industry || industry === 'catering';
}
/** 食安量化分级：A/B/C（空=未评级） */
const FOOD_GRADES = ['A', 'B', 'C'];
/** 数值配置合法区间（金额=分，时长=分钟）：与 campus-config 另一写入口同口径，超界直接拒绝 */
const INT_RANGES = {
    deliveryMinutes: [1, 240],
    minOrderAmount: [0, 10000000],
    deliveryFee: [0, 10000000],
    errandBaseFee: [0, 10000000],
    thirdPartyBaseFee: [0, 10000000],
    freeShippingThreshold: [0, 10000000],
    merchantAcceptMinutes: [0, 240],
    externalPushTimeoutMinutes: [1, 240],
    externalFallbackMinutes: [1, 240],
    packingFeeAmount: [0, 100000],
    packingFeeCap: [0, 1000000],
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
];
/** 单店进店换取限流：每 IP 每分钟 120 次（首屏并发换 token 足够，抑制批量枚举） */
const ENTRY_RATE_WINDOW_MS = 60000;
const ENTRY_RATE_MAX = 120;
let WaimaiStoreService = class WaimaiStoreService {
    constructor(connection) {
        this.connection = connection;
        this.entryRate = new Map();
    }
    /**
     * 菜品每日限量/每人限购（§68）：当前渠道「有限量配置」的商品，返回当日已售与剩余。
     * 公开只读：未登录的顾客 myToday/myRemaining 为 null。
     */
    async dailyStock(ctx) {
        var _a;
        const raw = this.connection.rawConnection;
        const rows = await raw.query('SELECT p.id AS "productId", '
            + 'COALESCE(p."customFieldsWaimaidailylimit", 0) AS "dailyLimit", '
            + 'COALESCE(p."customFieldsWaimaiperuserlimit", 0) AS "perUserLimit" '
            + 'FROM product p '
            + 'JOIN product_channels_channel pc ON pc."productId" = p.id AND pc."channelId" = $1 '
            + 'WHERE COALESCE(p."customFieldsWaimaidailylimit", 0) > 0 '
            + 'OR COALESCE(p."customFieldsWaimaiperuserlimit", 0) > 0', [ctx.channelId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length)
            return [];
        const ids = list.map((r) => Number(r.productId));
        const soldMap = await (0, daily_limit_1.queryDailySold)(raw, Number(ctx.channelId), ids);
        let customerId = null;
        if (ctx.activeUserId) {
            const cRows = await raw.query('SELECT id FROM customer WHERE "userId" = $1 LIMIT 1', [ctx.activeUserId]);
            const cList = Array.isArray(cRows) && Array.isArray(cRows[0]) ? cRows[0] : cRows;
            if (((_a = cList === null || cList === void 0 ? void 0 : cList[0]) === null || _a === void 0 ? void 0 : _a.id) != null)
                customerId = Number(cList[0].id);
        }
        const mineMap = customerId == null
            ? new Map()
            : await (0, daily_limit_1.queryDailySold)(raw, Number(ctx.channelId), ids, { customerId });
        return list.map((r) => {
            var _a, _b;
            const pid = Number(r.productId);
            const dailyLimit = (0, daily_limit_1.normalizeLimit)(r.dailyLimit);
            const perUserLimit = (0, daily_limit_1.normalizeLimit)(r.perUserLimit);
            const soldToday = (_a = soldMap.get(pid)) !== null && _a !== void 0 ? _a : 0;
            const myToday = customerId == null ? null : ((_b = mineMap.get(pid)) !== null && _b !== void 0 ? _b : 0);
            return {
                productId: pid,
                dailyLimit,
                perUserLimit,
                soldToday,
                remaining: (0, daily_limit_1.remainingOf)(dailyLimit, soldToday),
                myToday,
                myRemaining: customerId == null ? null : (0, daily_limit_1.remainingOf)(perUserLimit, myToday),
            };
        });
    }
    /** §113 公开只读：当前渠道的信任文案（评价页信任签名卡三行），空文案/无配置即回默认开启 + 空串 */
    async trustCopy(ctx) {
        var _a, _b, _c;
        const cfg = await this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId } });
        return {
            qualityEnabled: (_a = cfg === null || cfg === void 0 ? void 0 : cfg.trustQualityEnabled) !== null && _a !== void 0 ? _a : true,
            qualityText: (cfg === null || cfg === void 0 ? void 0 : cfg.trustQualityText) || null,
            serviceEnabled: (_b = cfg === null || cfg === void 0 ? void 0 : cfg.trustServiceEnabled) !== null && _b !== void 0 ? _b : true,
            serviceText: (cfg === null || cfg === void 0 ? void 0 : cfg.trustServiceText) || null,
            timeEnabled: (_c = cfg === null || cfg === void 0 ? void 0 : cfg.trustTimeEnabled) !== null && _c !== void 0 ? _c : true,
            timeText: (cfg === null || cfg === void 0 ? void 0 : cfg.trustTimeText) || null,
        };
    }
    /** 店铺列表：有履约配置的渠道即外卖店铺（跨渠道公开元数据聚合，供 C 端首页）。
     * C 端进入店铺后用 channelToken 作 vendure-token 切换渠道拉菜单/下单。 */
    async listStores(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
        const configs = await this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig).find();
        const byChannel = new Map(configs.map(c => [Number(c.channelId), c]));
        const channels = await this.connection.getRepository(ctx, core_1.Channel).find();
        const stores = [];
        const now = Date.now();
        for (const ch of channels) {
            const cfg = byChannel.get(Number(ch.id));
            if (!cfg)
                continue;
            if (ch.code === '__default_channel__')
                continue; // 默认渠道是平台会话渠道，不是店铺（防脏配置污染 C 端列表/骑手大厅）
            const cf = ((_a = ch.customFields) !== null && _a !== void 0 ? _a : {});
            // 外卖准入：仅餐饮行业租户展示（设计文档 2026-10-09 §4.2；存量由 BackfillWaimaiIndustryMigration 刷数）。
            // 仅过滤 C 端列表；listStoreConfigs（admin 配置视图）不过滤，避免管理员看不到已配履约的非餐饮渠道。
            if (cf.industryType !== 'catering')
                continue;
            // 营业日历（§70）：今日在休业名单中则整店休业（优先于营业时间判断）
            const closure = (0, closure_calendar_1.closedToday)((0, closure_calendar_1.safeClosureDates)(cfg.closureDates, now), now);
            stores.push({
                channelId: Number(ch.id),
                channelToken: ch.token,
                name: ch.code,
                logo: (_b = cf.waimaiLogo) !== null && _b !== void 0 ? _b : null,
                tags: typeof cf.waimaiTags === 'string' && cf.waimaiTags.length
                    ? cf.waimaiTags.split(',').map((t) => t.trim()).filter(Boolean)
                    : [],
                monthlySales: (_c = cf.waimaiMonthlySales) !== null && _c !== void 0 ? _c : 0,
                promoText: (_d = cf.waimaiPromoText) !== null && _d !== void 0 ? _d : null,
                paused: cfg.paused,
                routesEnabled: (_e = cfg.routesEnabled) !== null && _e !== void 0 ? _e : [],
                deliveryMinutes: (_f = cfg.deliveryMinutes) !== null && _f !== void 0 ? _f : null,
                minOrderAmount: (_g = cfg.minOrderAmount) !== null && _g !== void 0 ? _g : null,
                deliveryFee: (_h = cfg.deliveryFee) !== null && _h !== void 0 ? _h : null,
                storeAddress: (_j = cfg.storeAddress) !== null && _j !== void 0 ? _j : null,
                storePhone: (_k = cfg.storePhone) !== null && _k !== void 0 ? _k : null,
                storeNotice: (_l = cfg.storeNotice) !== null && _l !== void 0 ? _l : null,
                businessHours: (_m = cf.waimaiBusinessHours) !== null && _m !== void 0 ? _m : null,
                // 营业状态（服务端按校园时区判定，与 C 端展示/下单闸门同口径）
                openNow: (0, business_hours_1.isWithinBusinessHours)((_o = cf.waimaiBusinessHours) !== null && _o !== void 0 ? _o : null) && !cfg.paused && !closure,
                closedToday: !!closure,
                closureNote: (_p = closure === null || closure === void 0 ? void 0 : closure.note) !== null && _p !== void 0 ? _p : null,
                errandBaseFee: (_q = cfg.errandBaseFee) !== null && _q !== void 0 ? _q : null,
                freeShippingThreshold: (_r = cfg.freeShippingThreshold) !== null && _r !== void 0 ? _r : null,
                deliveryFeeTiers: cfg.deliveryFeeTiers ? JSON.stringify(cfg.deliveryFeeTiers) : null,
                foodLicenseNo: (_s = cfg.foodLicenseNo) !== null && _s !== void 0 ? _s : null,
                foodLicenseImage: (_t = cfg.foodLicenseImage) !== null && _t !== void 0 ? _t : null,
                foodLicenseExpiry: (_u = cfg.foodLicenseExpiry) !== null && _u !== void 0 ? _u : null,
                foodSafetyGrade: (_v = cfg.foodSafetyGrade) !== null && _v !== void 0 ? _v : null,
                foodSafetyCommitmentImage: (_w = cfg.foodSafetyCommitmentImage) !== null && _w !== void 0 ? _w : null,
                kitchenLiveUrl: cfg.kitchenLiveEnabled ? (_x = cfg.kitchenLiveUrl) !== null && _x !== void 0 ? _x : null : null,
                kitchenLiveEnabled: (_y = cfg.kitchenLiveEnabled) !== null && _y !== void 0 ? _y : false,
                packingFeeEnabled: (_z = cfg.packingFeeEnabled) !== null && _z !== void 0 ? _z : false,
                packingFeeMode: (0, packing_fee_1.normalizePackingFeeMode)(cfg.packingFeeMode),
                packingFeeAmount: (_0 = cfg.packingFeeAmount) !== null && _0 !== void 0 ? _0 : 0,
                packingFeeCap: (_1 = cfg.packingFeeCap) !== null && _1 !== void 0 ? _1 : null,
                packingFeeLabel: (_2 = cfg.packingFeeLabel) !== null && _2 !== void 0 ? _2 : null,
            });
        }
        return stores;
    }
    /**
     * 单店进店换取渠道 token：仅对「有履约配置 + 非默认渠道 + 餐饮行业」的店铺下发，
     * 避免 public 列表一次性批量暴露全部渠道 token；每 IP 每分钟限流。
     */
    async storeEntry(ctx, channelId) {
        var _a;
        if (!Number.isInteger(channelId) || channelId <= 0) {
            throw new core_1.UserInputError('店铺不存在');
        }
        this.assertEntryRate(ctx);
        const channel = await this.connection.getRepository(ctx, core_1.Channel).findOne({ where: { id: channelId } });
        if (!channel || channel.code === '__default_channel__') {
            throw new core_1.UserInputError('店铺不存在');
        }
        const cfg = await this.connection
            .getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
            .findOne({ where: { channelId } });
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        // L2：与列表同口径——只有显式非餐饮才拒绝，未设置行业按餐饮处理
        if (!cfg || !isCateringIndustry(cf)) {
            throw new core_1.UserInputError('店铺不存在');
        }
        return { channelId: Number(channel.id), channelToken: channel.token };
    }
    /** 单店换取的进程内滑动窗口限流（多实例时各实例独立计数） */
    assertEntryRate(ctx) {
        var _a, _b, _c, _d, _e;
        const req = ctx.req;
        const forwarded = (_a = req === null || req === void 0 ? void 0 : req.headers) === null || _a === void 0 ? void 0 : _a['x-forwarded-for'];
        const ip = ((_e = (_d = (_c = (_b = (Array.isArray(forwarded) ? forwarded[0] : forwarded)) === null || _b === void 0 ? void 0 : _b.split) === null || _c === void 0 ? void 0 : _c.call(_b, ',')) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.trim())
            || (req === null || req === void 0 ? void 0 : req.ip)
            || 'unknown';
        const now = Date.now();
        const rec = this.entryRate.get(ip);
        if (!rec || now - rec.start >= ENTRY_RATE_WINDOW_MS) {
            this.entryRate.set(ip, { start: now, count: 1 });
            if (this.entryRate.size > 10000) {
                for (const [key, value] of this.entryRate) {
                    if (now - value.start >= ENTRY_RATE_WINDOW_MS)
                        this.entryRate.delete(key);
                }
            }
            return;
        }
        if (rec.count >= ENTRY_RATE_MAX) {
            throw new core_1.UserInputError('请求过于频繁，请稍后再试');
        }
        rec.count += 1;
    }
    /** admin：全店铺配置（跨渠道，join Channel 取店铺名/token；默认渠道是平台会话渠道，跳过） */
    async listStoreConfigs(ctx) {
        const configs = await this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig).find();
        const byChannel = new Map(configs.map(c => [Number(c.channelId), c]));
        const channels = await this.connection.getRepository(ctx, core_1.Channel).find();
        const out = [];
        for (const ch of channels) {
            if (ch.code === '__default_channel__')
                continue;
            const cfg = byChannel.get(Number(ch.id));
            out.push(this.toConfigView(Number(ch.id), ch.code, ch.token, cfg));
        }
        return out;
    }
    /** admin：按 channelId upsert（幂等），routesEnabled 白名单 R1-R5，负数金额拒绝 */
    async updateStoreConfig(ctx, channelId, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15;
        // 路线去重：重复项会让开点校验/前端渲染出现重复楼层
        const routes = Array.from(new Set(((_a = input.routesEnabled) !== null && _a !== void 0 ? _a : []).map(r => String(r))));
        const bad = routes.filter(r => !ROUTE_WHITELIST.includes(r));
        if (bad.length)
            throw new core_1.UserInputError(`不支持的配送路线: ${bad.join(', ')}（仅接受 R1-R5）`);
        if (input.printMode != null && !PRINT_MODES.includes(input.printMode)) {
            throw new core_1.UserInputError(`不支持的打印模式: ${input.printMode}（仅接受 off/onPaid/onAccepted）`);
        }
        // 数值字段：有限数 + 区间校验 + 整数归一（金额为分），超界一律拒绝，避免脏值污染运费/超时链路
        const nums = {};
        for (const [key, [min, max]] of Object.entries(INT_RANGES)) {
            const raw = input[key];
            if (raw == null)
                continue;
            const n = Number(raw);
            if (!Number.isFinite(n))
                throw new core_1.UserInputError(`${key} 必须是数字`);
            if (n < 0)
                throw new core_1.UserInputError(`${key} 不能为负数`);
            if (n > max)
                throw new core_1.UserInputError(`${key} 超出允许上限（${max}）`);
            if (n < min)
                throw new core_1.UserInputError(`${key} 不能小于 ${min}`);
            nums[key] = Math.round(n);
        }
        // 第一段承运：只有 R1（merchant|owned）、R3（campus|owned|external）可配
        const routeFirstLeg = {};
        for (const item of (_b = input.routeFirstLeg) !== null && _b !== void 0 ? _b : []) {
            const route = String((_c = item === null || item === void 0 ? void 0 : item.route) !== null && _c !== void 0 ? _c : '');
            if (route !== 'R1' && route !== 'R3') {
                throw new core_1.UserInputError(`路线 ${route || '(空)'} 不支持配置第一段承运方（仅 R1、R3）`);
            }
            const carrier = (0, route_matrix_1.normalizeRouteFirstLeg)(route, item === null || item === void 0 ? void 0 : item.carrier);
            if (!carrier) {
                throw new core_1.UserInputError(`路线 ${route} 的第一段承运方不合法: ${(_d = item === null || item === void 0 ? void 0 : item.carrier) !== null && _d !== void 0 ? _d : '(空)'}（可选 ${route_matrix_1.ROUTE_FIRST_LEG_OPTIONS[route].join('/')}）`);
            }
            routeFirstLeg[route] = carrier;
        }
        // 校园交接点：只有 R1、R2 需要；同一路线可配多个，按楼栋距离选最近，默认点做无坐标兜底
        const handoverPoints = {};
        for (const item of (_e = input.handoverPoints) !== null && _e !== void 0 ? _e : []) {
            const route = String((_f = item === null || item === void 0 ? void 0 : item.route) !== null && _f !== void 0 ? _f : '');
            if (route !== 'R1' && route !== 'R2') {
                throw new core_1.UserInputError(`路线 ${route || '(空)'} 不需要校园交接点（仅 R1、R2）`);
            }
            const name = String((_g = item === null || item === void 0 ? void 0 : item.name) !== null && _g !== void 0 ? _g : '').trim();
            const lat = Number(item === null || item === void 0 ? void 0 : item.lat);
            const lng = Number(item === null || item === void 0 ? void 0 : item.lng);
            if (!name)
                throw new core_1.UserInputError(`路线 ${route} 的交接点名称不能为空`);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
                throw new core_1.UserInputError(`路线 ${route} 的交接点经纬度不合法`);
            }
            ((_h = handoverPoints[route]) !== null && _h !== void 0 ? _h : (handoverPoints[route] = [])).push(Object.assign({ name, address: ((_j = item === null || item === void 0 ? void 0 : item.address) === null || _j === void 0 ? void 0 : _j.trim()) || undefined, phone: ((_k = item === null || item === void 0 ? void 0 : item.phone) === null || _k === void 0 ? void 0 : _k.trim()) || undefined, lat,
                lng }, ((item === null || item === void 0 ? void 0 : item.isDefault) ? { isDefault: true } : {})));
        }
        // 每条路线只保留一个默认点：已标注取第一个，未标注取该路线第一个
        for (const list of Object.values(handoverPoints)) {
            let seen = false;
            for (const p of list) {
                if (p.isDefault && !seen)
                    seen = true;
                else
                    delete p.isDefault;
            }
            if (!seen && list[0])
                list[0].isDefault = true;
        }
        // 外部快递门店编号：外部快递用哪家由运营中心派单时决定，这里只存各家的门店编号
        const providerShopNo = {};
        for (const item of (_l = input.providerShopNo) !== null && _l !== void 0 ? _l : []) {
            const provider = String((_m = item === null || item === void 0 ? void 0 : item.provider) !== null && _m !== void 0 ? _m : '');
            if (provider !== 'dada' && provider !== 'meituan') {
                throw new core_1.UserInputError(`不支持的外部快递: ${provider || '(空)'}（仅 dada/meituan）`);
            }
            const shopNo = String((_o = item === null || item === void 0 ? void 0 : item.shopNo) !== null && _o !== void 0 ? _o : '').trim();
            if (shopNo)
                providerShopNo[provider] = shopNo;
        }
        const chRepo = this.connection.getRepository(ctx, core_1.Channel);
        const ch = (await chRepo.find()).find(c => Number(c.id) === Number(channelId));
        if (!ch)
            throw new core_1.UserInputError(`渠道不存在: ${channelId}`);
        const repo = this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig);
        let cfg = await repo.findOne({ where: { channelId: channelId } });
        if (!cfg)
            cfg = new campus_fulfillment_config_entity_1.CampusFulfillmentConfig({ channelId: channelId });
        // 记录「本次新开通」的路线：只有新开通 R1/R2 才强制交接点，历史配置（已开通但缺点）不阻断其它字段编辑
        const prevEnabled = [...((_p = cfg.routesEnabled) !== null && _p !== void 0 ? _p : [])];
        cfg.routesEnabled = routes;
        // 未传（undefined）即保留原值，只有显式传 null 才清空：
        // 旧后台表单不认识的新字段、局部更新（如只改公告）都不会把已有配置意外抹掉。
        if (input.deliveryMinutes !== undefined)
            cfg.deliveryMinutes = (_q = nums.deliveryMinutes) !== null && _q !== void 0 ? _q : null;
        if (input.minOrderAmount !== undefined)
            cfg.minOrderAmount = (_r = nums.minOrderAmount) !== null && _r !== void 0 ? _r : null;
        if (input.deliveryFee !== undefined)
            cfg.deliveryFee = (_s = nums.deliveryFee) !== null && _s !== void 0 ? _s : null;
        if (input.storeAddress !== undefined)
            cfg.storeAddress = (_t = input.storeAddress) !== null && _t !== void 0 ? _t : null;
        if (input.storePhone !== undefined)
            cfg.storePhone = (_u = input.storePhone) !== null && _u !== void 0 ? _u : null;
        if (input.storeNotice !== undefined) {
            const notice = input.storeNotice == null ? null : String(input.storeNotice);
            if (notice && notice.length > campus_fulfillment_config_entity_1.STORE_NOTICE_MAX_LENGTH) {
                throw new core_1.UserInputError(`店铺公告最多 ${campus_fulfillment_config_entity_1.STORE_NOTICE_MAX_LENGTH} 字`);
            }
            cfg.storeNotice = notice;
        }
        if (input.errandBaseFee !== undefined)
            cfg.errandBaseFee = (_v = nums.errandBaseFee) !== null && _v !== void 0 ? _v : null;
        // 第三方到校基价：未传即保留（旧表单不清空）；传 null 表示不接管顾客侧运费
        if (input.thirdPartyBaseFee !== undefined)
            cfg.thirdPartyBaseFee = (_w = nums.thirdPartyBaseFee) !== null && _w !== void 0 ? _w : null;
        if (input.freeShippingThreshold !== undefined)
            cfg.freeShippingThreshold = (_x = nums.freeShippingThreshold) !== null && _x !== void 0 ? _x : null;
        // 配送费阶梯（P3-4）：未传即保留；传 null/空串关闭；JSON 解析失败或档位非法直接拒绝
        if (input.deliveryFeeTiers !== undefined) {
            let raw = input.deliveryFeeTiers;
            if (typeof raw === 'string') {
                const text = raw.trim();
                if (!text)
                    raw = null;
                else {
                    try {
                        raw = JSON.parse(text);
                    }
                    catch (_16) {
                        throw new core_1.UserInputError('配送费阶梯不是合法 JSON');
                    }
                }
            }
            try {
                cfg.deliveryFeeTiers = (0, delivery_fee_tiers_1.normalizeDeliveryFeeTiers)(raw);
            }
            catch (e) {
                throw new core_1.UserInputError((e === null || e === void 0 ? void 0 : e.message) || '配送费阶梯不合法');
            }
        }
        for (const key of NOTIFY_TEMPLATE_FIELDS) {
            if (input[key] !== undefined)
                cfg[key] = (_y = input[key]) !== null && _y !== void 0 ? _y : null;
        }
        if (input.h5BaseUrl !== undefined)
            cfg.h5BaseUrl = (_z = input.h5BaseUrl) !== null && _z !== void 0 ? _z : null;
        /** 空串归一为 null（未配置即 C 端/小票不渲染）；undefined=保留原值 */
        const nullableText = (v) => (v === undefined ? undefined : String(v !== null && v !== void 0 ? v : '').trim() || null);
        if (input.printMode !== undefined) {
            cfg.printMode = input.printMode == null || input.printMode === '' ? 'off' : input.printMode;
        }
        // 云打印通道（P1-4）：local 走前端 C-Lodop；云通道必须备齐账号/设备/密钥，否则自动出票必然失败
        if (input.printProvider !== undefined && input.printProvider !== null) {
            const provider = String(input.printProvider).trim();
            if (!exports.PRINT_PROVIDERS.includes(provider)) {
                throw new core_1.UserInputError(`不支持的打印通道: ${provider || '(空)'}（仅接受 ${exports.PRINT_PROVIDERS.join('/')}）`);
            }
            cfg.printProvider = provider;
        }
        if (input.printAccount !== undefined)
            cfg.printAccount = (_0 = nullableText(input.printAccount)) !== null && _0 !== void 0 ? _0 : null;
        if (input.printDeviceSn !== undefined)
            cfg.printDeviceSn = (_1 = nullableText(input.printDeviceSn)) !== null && _1 !== void 0 ? _1 : null;
        if (input.printDeviceKey !== undefined)
            cfg.printDeviceKey = (_2 = nullableText(input.printDeviceKey)) !== null && _2 !== void 0 ? _2 : null;
        if (input.printCopies !== undefined && input.printCopies !== null) {
            const copies = Number(input.printCopies);
            if (!Number.isInteger(copies) || copies < 1 || copies > 5) {
                throw new core_1.UserInputError('打印联数必须为 1-5 的整数');
            }
            cfg.printCopies = copies;
        }
        // 未配置时与运行侧（cloud-print / merchant-admin）保持同一默认值 local，避免旧配置/裸对象被误判为云通道
        if (String((_3 = cfg.printProvider) !== null && _3 !== void 0 ? _3 : 'local') !== 'local'
            && (!cfg.printAccount || !cfg.printDeviceSn || !cfg.printDeviceKey)) {
            throw new core_1.UserInputError('选择云打印时请填写服务商账号、设备编号与密钥');
        }
        // 超时赔付：未传即保留（旧表单不会清空已配值）
        if (input.timeoutCompensationEnabled != null)
            cfg.timeoutCompensationEnabled = input.timeoutCompensationEnabled;
        if (input.timeoutGraceMinutes != null)
            cfg.timeoutGraceMinutes = input.timeoutGraceMinutes;
        if (input.timeoutCompensationWindowHours != null) {
            const hours = Number(input.timeoutCompensationWindowHours);
            if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
                throw new core_1.UserInputError('赔付回扫窗口必须为 1-168 的整数（小时）');
            }
            cfg.timeoutCompensationWindowHours = hours;
        }
        if (input.timeoutCompensationCouponTemplateId !== undefined) {
            cfg.timeoutCompensationCouponTemplateId = input.timeoutCompensationCouponTemplateId || null;
        }
        // 未传即保留：后台旧表单不认识的字段不被清空
        if (input.routeFirstLeg !== undefined)
            cfg.routeFirstLeg = input.routeFirstLeg === null ? null : routeFirstLeg;
        if (input.handoverPoints !== undefined)
            cfg.handoverPoints = input.handoverPoints === null ? null : handoverPoints;
        if (input.providerShopNo !== undefined)
            cfg.providerShopNo = input.providerShopNo === null ? null : providerShopNo;
        if (input.merchantAcceptMinutes != null)
            cfg.merchantAcceptMinutes = nums.merchantAcceptMinutes;
        if (input.externalPushTimeoutMinutes != null)
            cfg.externalPushTimeoutMinutes = nums.externalPushTimeoutMinutes;
        if (input.externalFallbackMinutes != null)
            cfg.externalFallbackMinutes = nums.externalFallbackMinutes;
        // 门店坐标：R2/R3 距离计算与动态计价依赖，必须为有限数且在合法经纬度范围内
        for (const [key, limit] of [['storeLat', 90], ['storeLng', 180]]) {
            if (input[key] === undefined)
                continue;
            if (input[key] == null) {
                cfg[key] = null;
                continue;
            }
            const n = Number(input[key]);
            if (!Number.isFinite(n) || Math.abs(n) > limit) {
                throw new core_1.UserInputError(`${key} 不合法（需 -${limit}~${limit} 的有限数）`);
            }
            cfg[key] = n;
        }
        // 动态计价：未传即保留；传 null/'' 关闭。写入前解析校验，坏 JSON 直接拒绝
        if (input.dynamicPricing !== undefined) {
            if (input.dynamicPricing === null || input.dynamicPricing.trim() === '') {
                cfg.dynamicPricing = null;
            }
            else {
                let parsed;
                try {
                    parsed = JSON.parse(input.dynamicPricing);
                }
                catch (_17) {
                    throw new core_1.UserInputError('动态计价配置不是合法 JSON');
                }
                if (!parsed || typeof parsed !== 'object')
                    throw new core_1.UserInputError('动态计价配置必须是 JSON 对象');
                cfg.dynamicPricing = parsed;
            }
        }
        // 号码保护：provider 白名单 + TTL 区间；外部号池缺凭证时由 PrivacyNumberService 运行时降级为脱敏
        if (input.privacyNumberEnabled != null)
            cfg.privacyNumberEnabled = !!input.privacyNumberEnabled;
        if (input.privacyNumberProvider != null) {
            const provider = String(input.privacyNumberProvider || '').trim();
            if (!exports.PRIVACY_PROVIDERS.includes(provider)) {
                throw new core_1.UserInputError(`不支持的隐私号服务商: ${provider || '(空)'}（仅接受 ${exports.PRIVACY_PROVIDERS.join('/')}）`);
            }
            cfg.privacyNumberProvider = provider;
        }
        if (input.privacyNumberTtlMinutes != null) {
            const ttl = Number(input.privacyNumberTtlMinutes);
            if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) {
                throw new core_1.UserInputError('隐私号有效期必须为 1-1440 的整数（分钟）');
            }
            cfg.privacyNumberTtlMinutes = ttl;
        }
        if (input.privacyNumberPrefix !== undefined) {
            cfg.privacyNumberPrefix = String((_4 = input.privacyNumberPrefix) !== null && _4 !== void 0 ? _4 : '').trim() || null;
        }
        // 食安公示：空串归一为 null（未配置即 C 端不渲染）；等级/到期日做格式校验
        if (input.foodLicenseNo !== undefined)
            cfg.foodLicenseNo = (_5 = nullableText(input.foodLicenseNo)) !== null && _5 !== void 0 ? _5 : null;
        if (input.foodLicenseImage !== undefined)
            cfg.foodLicenseImage = (_6 = nullableText(input.foodLicenseImage)) !== null && _6 !== void 0 ? _6 : null;
        if (input.foodSafetyCommitmentImage !== undefined) {
            cfg.foodSafetyCommitmentImage = (_7 = nullableText(input.foodSafetyCommitmentImage)) !== null && _7 !== void 0 ? _7 : null;
        }
        if (input.kitchenLiveUrl !== undefined)
            cfg.kitchenLiveUrl = (_8 = nullableText(input.kitchenLiveUrl)) !== null && _8 !== void 0 ? _8 : null;
        if (input.foodLicenseExpiry !== undefined) {
            const expiry = nullableText(input.foodLicenseExpiry);
            if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
                throw new core_1.UserInputError('食品经营许可证到期日格式必须为 YYYY-MM-DD');
            }
            cfg.foodLicenseExpiry = expiry !== null && expiry !== void 0 ? expiry : null;
        }
        if (input.foodSafetyGrade !== undefined) {
            const grade = nullableText(input.foodSafetyGrade);
            if (grade && !FOOD_GRADES.includes(grade)) {
                throw new core_1.UserInputError(`食品安全量化分级仅接受 ${FOOD_GRADES.join('/')}（空=未评级）`);
            }
            cfg.foodSafetyGrade = grade !== null && grade !== void 0 ? grade : null;
        }
        if (input.kitchenLiveEnabled != null)
            cfg.kitchenLiveEnabled = !!input.kitchenLiveEnabled;
        // 明厨亮灶入口必须真的有地址，避免 C 端出现点不开的死入口
        if (cfg.kitchenLiveEnabled && !cfg.kitchenLiveUrl) {
            throw new core_1.UserInputError('开启明厨亮灶前请先填写直播/回放地址');
        }
        // 打包费：计费方式白名单 + 金额区间（nums 已做归一），开启时金额必须 > 0 且封顶不低于金额
        if (input.packingFeeEnabled != null)
            cfg.packingFeeEnabled = !!input.packingFeeEnabled;
        if (input.packingFeeMode != null) {
            const mode = String(input.packingFeeMode || '').trim();
            if (!packing_fee_1.PACKING_FEE_MODES.includes(mode)) {
                throw new core_1.UserInputError(`不支持的打包费计费方式: ${mode || '(空)'}（仅接受 ${packing_fee_1.PACKING_FEE_MODES.join('/')}）`);
            }
            cfg.packingFeeMode = mode;
        }
        if (input.packingFeeAmount !== undefined)
            cfg.packingFeeAmount = (_9 = nums.packingFeeAmount) !== null && _9 !== void 0 ? _9 : 0;
        if (input.packingFeeCap !== undefined)
            cfg.packingFeeCap = (_10 = nums.packingFeeCap) !== null && _10 !== void 0 ? _10 : null;
        if (input.packingFeeLabel !== undefined)
            cfg.packingFeeLabel = (_11 = nullableText(input.packingFeeLabel)) !== null && _11 !== void 0 ? _11 : null;
        if (cfg.packingFeeEnabled && ((_12 = cfg.packingFeeAmount) !== null && _12 !== void 0 ? _12 : 0) <= 0) {
            throw new core_1.UserInputError('开启打包费时请填写大于 0 的金额');
        }
        if (cfg.packingFeeCap != null && cfg.packingFeeAmount != null && cfg.packingFeeCap < cfg.packingFeeAmount) {
            throw new core_1.UserInputError('打包费单笔封顶不能小于单件/每单金额');
        }
        // 小程序上架（P2-1）：AppID/版本/隐私指引做格式校验；置为已上架前必须通过上架前检查
        if (input.mpAppId !== undefined) {
            const appId = nullableText(input.mpAppId);
            if (appId && !/^wx[0-9a-f]{16}$/i.test(appId)) {
                throw new core_1.UserInputError('小程序 AppID 格式不合法（应为 wx + 16 位十六进制）');
            }
            cfg.mpAppId = appId !== null && appId !== void 0 ? appId : null;
        }
        if (input.mpCategory !== undefined) {
            const cat = nullableText(input.mpCategory);
            if (cat && cat.length > 64)
                throw new core_1.UserInputError('小程序服务类目不能超过 64 字符');
            cfg.mpCategory = cat !== null && cat !== void 0 ? cat : null;
        }
        if (input.mpVersion !== undefined) {
            const ver = nullableText(input.mpVersion);
            if (ver && !/^\d{1,3}(\.\d{1,3}){1,2}$/.test(ver)) {
                throw new core_1.UserInputError('小程序版本号格式不合法（应为 x.y 或 x.y.z）');
            }
            cfg.mpVersion = ver !== null && ver !== void 0 ? ver : null;
        }
        if (input.mpPrivacyUrl !== undefined) {
            const url = nullableText(input.mpPrivacyUrl);
            if (url && (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 255)) {
                throw new core_1.UserInputError('隐私保护指引地址必须是 http(s) 链接且不超过 255 字符');
            }
            cfg.mpPrivacyUrl = url !== null && url !== void 0 ? url : null;
        }
        if (input.mpReviewNote !== undefined) {
            const note = nullableText(input.mpReviewNote);
            if (note && note.length > 500)
                throw new core_1.UserInputError('审核备注不能超过 500 字符');
            cfg.mpReviewNote = note !== null && note !== void 0 ? note : null;
        }
        if (input.mpListingStatus != null) {
            const status = String(input.mpListingStatus || '').trim();
            if (!MP_LISTING_STATUSES.includes(status)) {
                throw new core_1.UserInputError(`不支持的上架状态: ${status || '(空)'}（仅接受 ${MP_LISTING_STATUSES.join('/')}）`);
            }
            cfg.mpListingStatus = status;
        }
        // 置为「已上架」前必须齐全，避免审核资料缺项却对外宣称已上架
        if (cfg.mpListingStatus === 'online') {
            const missing = mpListingMissing(cfg);
            if (missing.length) {
                throw new core_1.UserInputError(`上架前请先补齐：${missing.join('、')}`);
            }
        }
        // 语音/拍照搜索（P2-2）：服务商白名单；none = 该入口关闭，未传（undefined）保留原值
        for (const [field, label] of [['voiceSearchProvider', '语音搜索'], ['imageSearchProvider', '拍照搜索']]) {
            if (input[field] === undefined)
                continue;
            const provider = String((_13 = input[field]) !== null && _13 !== void 0 ? _13 : '').trim();
            if (!search_assist_1.SEARCH_ASSIST_PROVIDER_NAMES.includes(provider)) {
                throw new core_1.UserInputError(`不支持的${label}服务商: ${provider || '(空)'}（仅接受 ${search_assist_1.SEARCH_ASSIST_PROVIDER_NAMES.join('/')}）`);
            }
            cfg[field] = provider;
        }
        // 跨字段：新开通 R1/R2 必须有至少一个可用交接点（名称+经纬度），否则订单会降级为传信者到店取餐
        const enabled = routes;
        const hasPoint = (r) => {
            var _a;
            const raw = (_a = cfg.handoverPoints) === null || _a === void 0 ? void 0 : _a[r];
            const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
            return list.some(p => { var _a; return !!String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : '').trim() && (p === null || p === void 0 ? void 0 : p.lat) != null && (p === null || p === void 0 ? void 0 : p.lng) != null; });
        };
        const missingPoint = ['R1', 'R2'].filter(r => enabled.includes(r) && !prevEnabled.includes(r) && !hasPoint(r));
        if (missingPoint.length) {
            throw new core_1.UserInputError(`开通 ${missingPoint.join('、')} 需要先填写至少一个校园交接点（名称+经纬度）`);
        }
        await repo.save(cfg);
        const address = ((_14 = input.storeAddress) !== null && _14 !== void 0 ? _14 : '').trim();
        if (address) {
            // R4：同步幂等 upsert 本渠道门店自提点（名称=店铺名，地址=storeAddress），核销走 pickup_redemption 零新表
            await this.upsertStorePickupLocation(Number(channelId), ch.code, address, ((_15 = input.storePhone) !== null && _15 !== void 0 ? _15 : '').trim() || null);
        }
        return this.toConfigView(channelId, ch.code, ch.token, cfg);
    }
    /** 经 rawConnection 按实体名取 repo（避免对 cjk-plugin 的构建期依赖；PickupLocation 由 cjk-plugin 注册于同一进程）。
     * 可见性：isPublic=false + ownerChannelId=本渠道 + channels 含本渠道 → shop 端 applyVisibility 对本渠道可见（cjk pickup-location.service.ts:35）。 */
    async upsertStorePickupLocation(channelId, name, address, phone) {
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
    toConfigView(channelId, channelName, channelToken, cfg) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35;
        const privacyStatus = privacyProviderStatus(cfg);
        return {
            channelId,
            channelName,
            channelToken,
            routesEnabled: (_a = cfg === null || cfg === void 0 ? void 0 : cfg.routesEnabled) !== null && _a !== void 0 ? _a : [],
            deliveryMinutes: (_b = cfg === null || cfg === void 0 ? void 0 : cfg.deliveryMinutes) !== null && _b !== void 0 ? _b : null,
            minOrderAmount: (_c = cfg === null || cfg === void 0 ? void 0 : cfg.minOrderAmount) !== null && _c !== void 0 ? _c : null,
            deliveryFee: (_d = cfg === null || cfg === void 0 ? void 0 : cfg.deliveryFee) !== null && _d !== void 0 ? _d : null,
            storeAddress: (_e = cfg === null || cfg === void 0 ? void 0 : cfg.storeAddress) !== null && _e !== void 0 ? _e : null,
            storePhone: (_f = cfg === null || cfg === void 0 ? void 0 : cfg.storePhone) !== null && _f !== void 0 ? _f : null,
            storeNotice: (_g = cfg === null || cfg === void 0 ? void 0 : cfg.storeNotice) !== null && _g !== void 0 ? _g : null,
            errandBaseFee: (_h = cfg === null || cfg === void 0 ? void 0 : cfg.errandBaseFee) !== null && _h !== void 0 ? _h : null,
            thirdPartyBaseFee: (_j = cfg === null || cfg === void 0 ? void 0 : cfg.thirdPartyBaseFee) !== null && _j !== void 0 ? _j : null,
            freeShippingThreshold: (_k = cfg === null || cfg === void 0 ? void 0 : cfg.freeShippingThreshold) !== null && _k !== void 0 ? _k : null,
            deliveryFeeTiers: (cfg === null || cfg === void 0 ? void 0 : cfg.deliveryFeeTiers) ? JSON.stringify(cfg.deliveryFeeTiers) : null,
            notifyTemplateAccepted: (_l = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateAccepted) !== null && _l !== void 0 ? _l : null,
            notifyTemplateRiderAssigned: (_m = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateRiderAssigned) !== null && _m !== void 0 ? _m : null,
            notifyTemplateCookingDone: (_o = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateCookingDone) !== null && _o !== void 0 ? _o : null,
            notifyTemplateDelivered: (_p = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateDelivered) !== null && _p !== void 0 ? _p : null,
            notifyTemplateExceptionHandled: (_q = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateExceptionHandled) !== null && _q !== void 0 ? _q : null,
            notifyTemplateArrivedHandover: (_r = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateArrivedHandover) !== null && _r !== void 0 ? _r : null,
            notifyTemplateDeliveryFallback: (_s = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateDeliveryFallback) !== null && _s !== void 0 ? _s : null,
            notifyTemplateOrderPlaced: (_t = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateOrderPlaced) !== null && _t !== void 0 ? _t : null,
            notifyTemplatePaymentPending: (_u = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplatePaymentPending) !== null && _u !== void 0 ? _u : null,
            notifyTemplateCancelled: (_v = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateCancelled) !== null && _v !== void 0 ? _v : null,
            notifyTemplateAfterSales: (_w = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateAfterSales) !== null && _w !== void 0 ? _w : null,
            notifyTemplateAddressChanged: (_x = cfg === null || cfg === void 0 ? void 0 : cfg.notifyTemplateAddressChanged) !== null && _x !== void 0 ? _x : null,
            h5BaseUrl: (_y = cfg === null || cfg === void 0 ? void 0 : cfg.h5BaseUrl) !== null && _y !== void 0 ? _y : null,
            printMode: normalizePrintMode(cfg === null || cfg === void 0 ? void 0 : cfg.printMode),
            printProvider: (_z = cfg === null || cfg === void 0 ? void 0 : cfg.printProvider) !== null && _z !== void 0 ? _z : 'local',
            printAccount: (_0 = cfg === null || cfg === void 0 ? void 0 : cfg.printAccount) !== null && _0 !== void 0 ? _0 : null,
            printDeviceSn: (_1 = cfg === null || cfg === void 0 ? void 0 : cfg.printDeviceSn) !== null && _1 !== void 0 ? _1 : null,
            printDeviceKey: (_2 = cfg === null || cfg === void 0 ? void 0 : cfg.printDeviceKey) !== null && _2 !== void 0 ? _2 : null,
            printCopies: (_3 = cfg === null || cfg === void 0 ? void 0 : cfg.printCopies) !== null && _3 !== void 0 ? _3 : 1,
            // 与实体默认值一致（timeoutCompensationEnabled default true）：无配置行时也应显示「已开启」
            timeoutCompensationEnabled: (_4 = cfg === null || cfg === void 0 ? void 0 : cfg.timeoutCompensationEnabled) !== null && _4 !== void 0 ? _4 : true,
            timeoutGraceMinutes: (_5 = cfg === null || cfg === void 0 ? void 0 : cfg.timeoutGraceMinutes) !== null && _5 !== void 0 ? _5 : 10,
            timeoutCompensationWindowHours: (_6 = cfg === null || cfg === void 0 ? void 0 : cfg.timeoutCompensationWindowHours) !== null && _6 !== void 0 ? _6 : 24,
            timeoutCompensationCouponTemplateId: (_7 = cfg === null || cfg === void 0 ? void 0 : cfg.timeoutCompensationCouponTemplateId) !== null && _7 !== void 0 ? _7 : null,
            routeFirstLeg: Object.entries((_8 = cfg === null || cfg === void 0 ? void 0 : cfg.routeFirstLeg) !== null && _8 !== void 0 ? _8 : {}).map(([route, carrier]) => ({ route, carrier })),
            handoverPoints: Object.entries((_9 = cfg === null || cfg === void 0 ? void 0 : cfg.handoverPoints) !== null && _9 !== void 0 ? _9 : {}).flatMap(([route, raw]) => (Array.isArray(raw) ? raw : raw ? [raw] : []).map(p => {
                var _a, _b;
                return ({
                    route,
                    name: p.name,
                    address: (_a = p.address) !== null && _a !== void 0 ? _a : null,
                    phone: (_b = p.phone) !== null && _b !== void 0 ? _b : null,
                    lat: p.lat,
                    lng: p.lng,
                    isDefault: !!p.isDefault,
                });
            })),
            providerShopNo: Object.entries((_10 = cfg === null || cfg === void 0 ? void 0 : cfg.providerShopNo) !== null && _10 !== void 0 ? _10 : {}).map(([provider, shopNo]) => ({ provider, shopNo })),
            merchantAcceptMinutes: (_11 = cfg === null || cfg === void 0 ? void 0 : cfg.merchantAcceptMinutes) !== null && _11 !== void 0 ? _11 : 5,
            externalPushTimeoutMinutes: (_12 = cfg === null || cfg === void 0 ? void 0 : cfg.externalPushTimeoutMinutes) !== null && _12 !== void 0 ? _12 : 10,
            externalFallbackMinutes: (_13 = cfg === null || cfg === void 0 ? void 0 : cfg.externalFallbackMinutes) !== null && _13 !== void 0 ? _13 : 20,
            storeLat: (_14 = cfg === null || cfg === void 0 ? void 0 : cfg.storeLat) !== null && _14 !== void 0 ? _14 : null,
            storeLng: (_15 = cfg === null || cfg === void 0 ? void 0 : cfg.storeLng) !== null && _15 !== void 0 ? _15 : null,
            dynamicPricing: (cfg === null || cfg === void 0 ? void 0 : cfg.dynamicPricing) ? JSON.stringify(cfg.dynamicPricing) : null,
            privacyNumberEnabled: (_16 = cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberEnabled) !== null && _16 !== void 0 ? _16 : false,
            privacyNumberProvider: (_17 = cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberProvider) !== null && _17 !== void 0 ? _17 : 'mask',
            privacyNumberEffectiveProvider: privacyStatus.effective,
            privacyNumberDegraded: privacyStatus.degraded,
            privacyNumberNote: privacyStatus.note,
            privacyNumberTtlMinutes: (_18 = cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberTtlMinutes) !== null && _18 !== void 0 ? _18 : 60,
            privacyNumberPrefix: (_19 = cfg === null || cfg === void 0 ? void 0 : cfg.privacyNumberPrefix) !== null && _19 !== void 0 ? _19 : null,
            foodLicenseNo: (_20 = cfg === null || cfg === void 0 ? void 0 : cfg.foodLicenseNo) !== null && _20 !== void 0 ? _20 : null,
            foodLicenseImage: (_21 = cfg === null || cfg === void 0 ? void 0 : cfg.foodLicenseImage) !== null && _21 !== void 0 ? _21 : null,
            foodLicenseExpiry: (_22 = cfg === null || cfg === void 0 ? void 0 : cfg.foodLicenseExpiry) !== null && _22 !== void 0 ? _22 : null,
            foodSafetyGrade: (_23 = cfg === null || cfg === void 0 ? void 0 : cfg.foodSafetyGrade) !== null && _23 !== void 0 ? _23 : null,
            foodSafetyCommitmentImage: (_24 = cfg === null || cfg === void 0 ? void 0 : cfg.foodSafetyCommitmentImage) !== null && _24 !== void 0 ? _24 : null,
            kitchenLiveUrl: (_25 = cfg === null || cfg === void 0 ? void 0 : cfg.kitchenLiveUrl) !== null && _25 !== void 0 ? _25 : null,
            kitchenLiveEnabled: (_26 = cfg === null || cfg === void 0 ? void 0 : cfg.kitchenLiveEnabled) !== null && _26 !== void 0 ? _26 : false,
            packingFeeEnabled: (_27 = cfg === null || cfg === void 0 ? void 0 : cfg.packingFeeEnabled) !== null && _27 !== void 0 ? _27 : false,
            packingFeeMode: (0, packing_fee_1.normalizePackingFeeMode)(cfg === null || cfg === void 0 ? void 0 : cfg.packingFeeMode),
            packingFeeAmount: (_28 = cfg === null || cfg === void 0 ? void 0 : cfg.packingFeeAmount) !== null && _28 !== void 0 ? _28 : 0,
            packingFeeCap: (_29 = cfg === null || cfg === void 0 ? void 0 : cfg.packingFeeCap) !== null && _29 !== void 0 ? _29 : null,
            packingFeeLabel: (_30 = cfg === null || cfg === void 0 ? void 0 : cfg.packingFeeLabel) !== null && _30 !== void 0 ? _30 : null,
            mpAppId: (_31 = cfg === null || cfg === void 0 ? void 0 : cfg.mpAppId) !== null && _31 !== void 0 ? _31 : null,
            mpCategory: (_32 = cfg === null || cfg === void 0 ? void 0 : cfg.mpCategory) !== null && _32 !== void 0 ? _32 : null,
            mpVersion: (_33 = cfg === null || cfg === void 0 ? void 0 : cfg.mpVersion) !== null && _33 !== void 0 ? _33 : null,
            mpListingStatus: normalizeMpListingStatus(cfg === null || cfg === void 0 ? void 0 : cfg.mpListingStatus),
            mpPrivacyUrl: (_34 = cfg === null || cfg === void 0 ? void 0 : cfg.mpPrivacyUrl) !== null && _34 !== void 0 ? _34 : null,
            mpReviewNote: (_35 = cfg === null || cfg === void 0 ? void 0 : cfg.mpReviewNote) !== null && _35 !== void 0 ? _35 : null,
            mpReady: mpListingMissing(cfg).length === 0,
            mpMissing: mpListingMissing(cfg),
            voiceSearchProvider: (cfg === null || cfg === void 0 ? void 0 : cfg.voiceSearchProvider) || 'mock',
            imageSearchProvider: (cfg === null || cfg === void 0 ? void 0 : cfg.imageSearchProvider) || 'mock',
        };
    }
};
exports.WaimaiStoreService = WaimaiStoreService;
exports.WaimaiStoreService = WaimaiStoreService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], WaimaiStoreService);
//# sourceMappingURL=waimai-store.service.js.map