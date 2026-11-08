"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTE_FIRST_LEG_DEFAULTS = exports.ROUTE_FIRST_LEG_OPTIONS = exports.CAMPUS_ROUTES = void 0;
exports.normalizeRouteFirstLeg = normalizeRouteFirstLeg;
exports.resolveRoutePlan = resolveRoutePlan;
exports.resolvePickup = resolvePickup;
exports.listHandoverPoints = listHandoverPoints;
exports.isRouteDeliverable = isRouteDeliverable;
exports.haversineMeters = haversineMeters;
exports.selectHandoverPoint = selectHandoverPoint;
exports.resolveHandoverPoint = resolveHandoverPoint;
exports.resolveDropoff = resolveDropoff;
/**
 * 外卖履约矩阵（唯一事实来源）：R1–R5 × 店铺「按路线第一段承运」配置 → RoutePlan
 *
 * 结构由路线决定，承运由配置决定：
 * - R1 商户/自营快递→校园交接点，传信者接力上楼（接力固定）
 * - R2 外部快递→校园交接点，传信者接力（接力固定，承运固定）
 * - R3 传信者/自营快递/外部快递到档口取餐直送（一段到底）
 * - R4 到店自取
 * - R5 校园跑腿
 *
 * R6 已取消，不在此矩阵内。
 */
exports.CAMPUS_ROUTES = ['R1', 'R2', 'R3', 'R4', 'R5'];
/** 各路线允许的第一段承运方 */
exports.ROUTE_FIRST_LEG_OPTIONS = {
    R1: ['merchant', 'owned'],
    R2: ['external'], // 固定，不在配置项里出现
    R3: ['campus', 'owned', 'external'],
    R4: ['self_pickup'], // 固定到店自取
    R5: ['campus'],
};
/** 默认第一段：R1 商户，R3 传信者 */
exports.ROUTE_FIRST_LEG_DEFAULTS = {
    R1: 'merchant',
    R3: 'campus',
};
/** 校验并归一某条路线的第一段承运方；不合法返回 null */
function normalizeRouteFirstLeg(route, value) {
    if (!exports.CAMPUS_ROUTES.includes(route))
        return null;
    const options = exports.ROUTE_FIRST_LEG_OPTIONS[route];
    const v = String(value !== null && value !== void 0 ? value : '').trim();
    return options.includes(v) ? v : null;
}
function resolveRoutePlan(route, cfg, externalProvider) {
    var _a, _b;
    if (!exports.CAMPUS_ROUTES.includes(route))
        return null;
    const r = route;
    const configured = normalizeRouteFirstLeg(r, (_a = cfg.routeFirstLeg) === null || _a === void 0 ? void 0 : _a[r]);
    const first = (_b = configured !== null && configured !== void 0 ? configured : exports.ROUTE_FIRST_LEG_DEFAULTS[r]) !== null && _b !== void 0 ? _b : null;
    switch (r) {
        case 'R1':
            // 接力固定：第一段商户或自营快递，第二段恒为传信者
            return {
                route: r,
                leg1: first === 'owned' ? 'owned' : 'merchant',
                leg2: 'campus_rider',
                handover: 'to_campus_rider',
                externalProvider: null,
                dispatch: 'merchant_pool',
            };
        case 'R2':
            return {
                route: r,
                leg1: 'external_courier',
                leg2: 'campus_rider',
                handover: 'to_campus_rider',
                externalProvider: externalProvider !== null && externalProvider !== void 0 ? externalProvider : null,
                dispatch: 'external_push',
            };
        case 'R3': {
            const leg1 = first === 'owned' ? 'owned' : first === 'external' ? 'external_courier' : 'campus_rider';
            return {
                route: r,
                leg1,
                leg2: 'none',
                handover: leg1 === 'external_courier' ? 'direct_to_user' : null,
                externalProvider: leg1 === 'external_courier' ? (externalProvider !== null && externalProvider !== void 0 ? externalProvider : null) : null,
                dispatch: 'hall_grab',
            };
        }
        case 'R4':
            return {
                route: r,
                leg1: 'self_pickup',
                leg2: 'none',
                handover: null,
                externalProvider: null,
                dispatch: 'pickup',
            };
        case 'R5':
            return {
                route: r,
                leg1: 'campus_rider',
                leg2: 'none',
                handover: null,
                externalProvider: null,
                dispatch: 'errand',
            };
        default:
            return null;
    }
}
/** 取货点：店铺经纬度（档口/门店）；缺坐标返回 null，禁止用 (0,0) 派单 */
function resolvePickup(_route, cfg) {
    var _a, _b;
    if (cfg.storeLat == null || cfg.storeLng == null)
        return null;
    return {
        name: cfg.storeAddress || '商家门店',
        address: (_a = cfg.storeAddress) !== null && _a !== void 0 ? _a : undefined,
        lat: Number(cfg.storeLat),
        lng: Number(cfg.storeLng),
        phone: (_b = cfg.storePhone) !== null && _b !== void 0 ? _b : undefined,
    };
}
/** 归一某路线的交接点列表：兼容历史「单点对象」写法，剔除缺名称/坐标的脏数据 */
function listHandoverPoints(route, cfg) {
    var _a;
    const raw = (_a = cfg.handoverPoints) === null || _a === void 0 ? void 0 : _a[route];
    if (!raw)
        return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter(p => { var _a; return !!p && !!String((_a = p.name) !== null && _a !== void 0 ? _a : '').trim() && p.lat != null && p.lng != null; });
}
/**
 * 路线是否可交付（A1）：
 * 「可用交接点」判定条件（前后端唯一定义）：
 *   1) 配置中存在该路线的交接点（数组或历史单点对象均可）；
 *   2) name 去空格后非空；
 *   3) lat / lng 均非空且可转换为有限数字（排除脏数据/空坐标，避免用无效点派单）。
 * R1/R2 必须有至少一个可用交接点；其余路线不依赖交接点，恒为可交付。
 * C 端 waimaiStoreList.r1Available、下单闸门 order-gate 共用此函数，避免口径漂移。
 */
function isRouteDeliverable(route, cfg) {
    if (route !== 'R1' && route !== 'R2')
        return true;
    if (!cfg)
        return false;
    return listHandoverPoints(route, cfg).some(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
}
/** 两点间球面距离（米），用于按收货楼栋挑最近交接点 */
function haversineMeters(a, b) {
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}
/**
 * 选交接点：有收货坐标取最近；否则取默认点；再否则取第一个。
 * 都缺返回 null（调用方按「未配置交接点」降级处理，禁止用 (0,0) 派单）。
 */
function selectHandoverPoint(route, cfg, dest) {
    var _a, _b, _c;
    const list = listHandoverPoints(route, cfg);
    if (!list.length)
        return null;
    let picked;
    if (dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng)) {
        picked = list.reduce((best, p) => haversineMeters(dest, p) < haversineMeters(dest, best) ? p : best);
    }
    else {
        picked = (_a = list.find(p => p.isDefault)) !== null && _a !== void 0 ? _a : list[0];
    }
    return {
        name: picked.name,
        address: (_b = picked.address) !== null && _b !== void 0 ? _b : undefined,
        phone: (_c = picked.phone) !== null && _c !== void 0 ? _c : undefined,
        lat: Number(picked.lat),
        lng: Number(picked.lng),
    };
}
/** 该路线选中的交接点（未配置返回 null，由调用方报「未配置交接点」） */
function resolveHandoverPoint(route, cfg, dest) {
    return selectHandoverPoint(route, cfg, dest);
}
/** 外部快递的收货点：R1/R2 打本路线交接点；R3 直送打用户地址；R4 无配送 */
function resolveDropoff(route, plan, cfg, userPoint, dest) {
    if (route === 'R1' || route === 'R2')
        return resolveHandoverPoint(route, cfg, dest);
    if (route === 'R4')
        return null;
    return userPoint;
}
//# sourceMappingURL=route-matrix.js.map