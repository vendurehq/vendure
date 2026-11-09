"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusOrderGateProcess = exports.CampusR1NoHandoverError = exports.CampusNoZoneError = exports.CAMPUS_NO_ZONE_CODE = exports.CAMPUS_NO_ZONE_MESSAGE = exports.R1_NO_HANDOVER_CODE = exports.R1_NO_HANDOVER_MESSAGE = exports.BLACKLIST_MESSAGE = void 0;
exports.bindOrderGateConnection = bindOrderGateConnection;
exports.isBlacklisted = isBlacklisted;
exports.findSoldOutProductName = findSoldOutProductName;
exports.findTodayClosure = findTodayClosure;
exports.findChannelRouteConfig = findChannelRouteConfig;
exports.hasChannelCampusZone = hasChannelCampusZone;
const core_1 = require("@vendure/core");
const business_hours_1 = require("./business-hours");
const daily_limit_1 = require("./daily-limit");
const closure_calendar_1 = require("./closure-calendar");
const route_matrix_1 = require("./route-matrix");
/**
 * 下单前置闸门（进入 ArrangingPayment 时校验）：
 * 1) 店铺营业状态：营业时间（Channel.customFields.waimaiBusinessHours）+ 营业日历休业（§70）+ 临时休息，
 *    跑腿单豁免（跑腿是平台服务，不受商家营业状态约束）；
 * 2) 黑名单：用户 / 手机号命中 active 记录即拦截；
 * 3) 商品沽清：订单行含已售罄商品（Product.customFields.waimaiSoldOut）即拦截；
 * 4) 每日限量 / 每人限购：订单行数量超过商品当日剩余额度即拦截。
 *
 * connection 用模块级引用（与 min-order.process / shipping-calculator 同模式）。
 */
let connRef = null;
function bindOrderGateConnection(conn) {
    connRef = conn;
}
exports.BLACKLIST_MESSAGE = '该账号暂不可下单，如有疑问请联系商家客服';
/** 黑名单校验：返回 true 表示命中（导出便于单测） */
async function isBlacklisted(conn, channelId, orderId) {
    var _a;
    const rows = await conn.rawConnection.query('SELECT c.id AS "customerId", c."phoneNumber" AS phone '
        + 'FROM "order" o JOIN customer c ON c.id = o."customerId" WHERE o.id = $1', [orderId]);
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const customer = list === null || list === void 0 ? void 0 : list[0];
    if (!customer)
        return false;
    const hit = await conn.rawConnection.query('SELECT 1 FROM campus_blacklist b WHERE b."channelId" = $1 AND b.active = true '
        + 'AND ((b.type = \'user\' AND b."customerId" = $2) OR (b.type = \'phone\' AND b.phone = $3)) LIMIT 1', [channelId, Number(customer.customerId), (_a = customer.phone) !== null && _a !== void 0 ? _a : null]);
    const hits = Array.isArray(hit) && Array.isArray(hit[0]) ? hit[0] : hit;
    return Array.isArray(hits) && hits.length > 0;
}
/** 沽清校验：返回首个售罄商品名（null=全部可售） */
async function findSoldOutProductName(conn, orderId) {
    var _a;
    const rows = await conn.rawConnection.query('SELECT pt.name FROM order_line ol '
        + 'JOIN product_variant pv ON pv.id = ol."productVariantId" '
        + 'JOIN product p ON p.id = pv."productId" '
        + 'LEFT JOIN product_translation pt ON pt."baseId" = p.id '
        + 'WHERE ol."orderId" = $1 AND COALESCE(p."customFieldsWaimaisoldout", false) = true '
        + 'ORDER BY (pt."languageCode" = \'zh_Hans\') DESC LIMIT 1', [orderId]);
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const name = (_a = list === null || list === void 0 ? void 0 : list[0]) === null || _a === void 0 ? void 0 : _a.name;
    return name == null ? null : String(name);
}
/** 营业日历（§70）：读取本渠道休业名单，命中今日返回该条目（null=今日正常营业） */
async function findTodayClosure(conn, channelId, now = Date.now()) {
    var _a;
    const rows = await conn.rawConnection.query('SELECT "closureDates" FROM campus_fulfillment_config WHERE "channelId" = $1 LIMIT 1', [channelId]);
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const raw = (_a = list === null || list === void 0 ? void 0 : list[0]) === null || _a === void 0 ? void 0 : _a.closureDates;
    if (!raw)
        return null;
    return (0, closure_calendar_1.closedToday)((0, closure_calendar_1.safeClosureDates)(raw, now), now);
}
exports.R1_NO_HANDOVER_MESSAGE = '当前门店未配置 R1 配送交接点，暂不可选择 R1，请改选 R3 或到店自取';
/** A1：前端/告警可依据 GraphQL extensions.code 区分原因（文案面向顾客） */
exports.R1_NO_HANDOVER_CODE = 'CAMPUS_R1_NO_HANDOVER_POINT';
/** 分区运费闸门：R1/R3 依赖渠道配送分区（CampusZone）出运费；
 *  无分区时 shipping calculator 返回 undefined，会落到其他运费方式，存在按 0 元成交的风险。 */
exports.CAMPUS_NO_ZONE_MESSAGE = '当前店铺未开通校园配送（未配置配送分区或所选分区已失效），请重新选择配送方式';
exports.CAMPUS_NO_ZONE_CODE = 'CAMPUS_ZONE_NOT_CONFIGURED';
class CampusNoZoneError extends core_1.UserInputError {
    constructor() {
        super(exports.CAMPUS_NO_ZONE_MESSAGE);
        this.extensions.code = exports.CAMPUS_NO_ZONE_CODE;
    }
}
exports.CampusNoZoneError = CampusNoZoneError;
/** A1：R1 渠道缺少可用交接点（Vendure 的 UserInputError 固定 code=USER_INPUT_ERROR，
 *  这里在 extensions 上补一个可机读的业务码，message 保持面向顾客可读）。 */
class CampusR1NoHandoverError extends core_1.UserInputError {
    constructor() {
        super(exports.R1_NO_HANDOVER_MESSAGE);
        this.extensions.code = exports.R1_NO_HANDOVER_CODE;
    }
}
exports.CampusR1NoHandoverError = CampusR1NoHandoverError;
/**
 * 读取渠道交接点配置（只读）。
 * simple-json 列经 pg 驱动可能回传对象，也可能回传字符串，统一解析成 RouteConfig。
 */
async function findChannelRouteConfig(conn, channelId) {
    var _a;
    const rows = await conn.rawConnection.query('SELECT "handoverPoints" FROM campus_fulfillment_config WHERE "channelId" = $1 LIMIT 1', [channelId]);
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const raw = (_a = list === null || list === void 0 ? void 0 : list[0]) === null || _a === void 0 ? void 0 : _a.handoverPoints;
    if (raw == null)
        return { handoverPoints: null };
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch (_b) {
            parsed = null;
        }
    }
    return { handoverPoints: (parsed !== null && parsed !== void 0 ? parsed : null) };
}
/** 渠道是否已配置配送分区：R1/R3 运费依赖分区，无分区时必须在下单前拦截。
 *  zoneName 非空时同时校验该分区仍属于本渠道（防止改配置后旧购物车按默认分区静默成交）。 */
async function hasChannelCampusZone(conn, channelId, zoneName) {
    const sql = zoneName
        ? 'SELECT 1 FROM campus_zone WHERE "channelId" = $1 AND name = $2 LIMIT 1'
        : 'SELECT 1 FROM campus_zone WHERE "channelId" = $1 LIMIT 1';
    const params = zoneName ? [channelId, zoneName] : [channelId];
    const rows = await conn.rawConnection.query(sql, params);
    const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    return Array.isArray(list) && list.length > 0;
}
exports.campusOrderGateProcess = {
    async onTransitionStart(fromState, toState, { ctx, order }) {
        var _a, _b, _c, _d, _e;
        if (toState !== 'ArrangingPayment')
            return;
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        const isErrand = cf.orderKind === 'errand';
        // 1) 营业状态（跑腿单是平台跑腿服务，不受商家堂食营业时间约束）
        if (!isErrand) {
            const hours = ((_c = (_b = ctx.channel) === null || _b === void 0 ? void 0 : _b.customFields) !== null && _c !== void 0 ? _c : {}).waimaiBusinessHours;
            if (hours && !(0, business_hours_1.isWithinBusinessHours)(hours)) {
                throw new core_1.UserInputError(`店铺已打烊（营业时间 ${hours}），暂不可下单`);
            }
        }
        const conn = connRef;
        if (!conn)
            return;
        // 1b) 营业日历（§70）：今日在休业名单中则整店休业（与营业时间/临时休息同层级）
        if (!isErrand) {
            const closure = await findTodayClosure(conn, Number(ctx.channelId));
            if (closure) {
                const note = closure.note ? `（${closure.note}）` : '';
                throw new core_1.UserInputError(`本店今日休业${note}，暂不可下单，请明日再来`);
            }
        }
        // 2) 黑名单
        if (await isBlacklisted(conn, Number(ctx.channelId), Number(order.id))) {
            throw new core_1.UserInputError(exports.BLACKLIST_MESSAGE);
        }
        // 3) 沽清
        const soldOut = await findSoldOutProductName(conn, Number(order.id));
        if (soldOut) {
            throw new core_1.UserInputError(`商品「${soldOut}」今日已售完，请重新选择`);
        }
        // 4) 每日限量 / 每人限购（额度按 UTC+8 当日已支付订单统计，本单不计入；
        //    同时把待付款单计入占用，并在同事务内加渠道锁，防止并发订单双双通过后超卖）
        // 取当前事务绑定的 manager（事务上下文中 getRepository 返回事务内仓库），
        // 让 advisory lock 与订单状态写入同事务生效；无事务时锁降级为单语句立即释放
        const limitHit = await (0, daily_limit_1.findDailyLimitViolation)(conn, Number(ctx.channelId), Number(order.id), conn.getRepository(ctx, core_1.Order).manager);
        if (limitHit) {
            throw new core_1.UserInputError(limitHit);
        }
        // 5) 配送路线闸门（外卖单）：一旦选择了校园交付点（分区/楼栋/时段），必须带合法路线。
        //    路线为空时支付后不会入厅（hallStatus 永远为空），进而脱离超时扫描、无人接单退款等全部兜底，
        //    订单会停在"已支付但无人处理"。仅对存在校园交付意图的单生效，避免误伤 Marketplace/普通快递/
        //    到店自取（R4 由 R4TagService 在过渡事件中打标）与跑腿/服务单。
        if (!isErrand && String((_d = cf.orderKind) !== null && _d !== void 0 ? _d : '') !== 'assistant') {
            const route = String((_e = cf.fulfillmentRoute) !== null && _e !== void 0 ? _e : '');
            const hasCampusTarget = cf.campusZone != null || cf.buildingId != null || cf.deliverySlotId != null;
            if (route || hasCampusTarget) {
                if (!route_matrix_1.CAMPUS_ROUTES.includes(route)) {
                    throw new core_1.UserInputError('配送路线缺失或无效，请重新选择配送方式');
                }
                if (['R1', 'R2', 'R3'].includes(route) && cf.buildingId == null) {
                    throw new core_1.UserInputError('请先选择配送楼栋后再提交订单');
                }
                // 5b) A1：R1 依赖交接点。未配置时下单前明确拒绝，避免支付后被静默降级为单段直送却仍收 R1 运费。
                if (route === 'R1') {
                    const routeCfg = await findChannelRouteConfig(conn, Number(ctx.channelId));
                    if (!(0, route_matrix_1.isRouteDeliverable)('R1', routeCfg)) {
                        throw new CampusR1NoHandoverError();
                    }
                }
                // 5c) 分区闸门：R1/R3 运费只由分区出价，无分区时 calculator 返回 undefined，
                //     Vendure 会落到其他运费方式（可能 0 元成交）。没有分区的渠道直接拒绝。
                if (route === 'R1' || route === 'R3') {
                    const hasZone = await hasChannelCampusZone(conn, Number(ctx.channelId), cf.campusZone != null ? String(cf.campusZone) : null);
                    if (!hasZone)
                        throw new CampusNoZoneError();
                }
            }
        }
    },
};
//# sourceMappingURL=order-gate.process.js.map