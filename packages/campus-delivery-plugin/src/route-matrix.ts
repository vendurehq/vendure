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
export const CAMPUS_ROUTES = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;
export type CampusRoute = (typeof CAMPUS_ROUTES)[number];

export type DeliveryPlan = 'campus_rider' | 'external_courier' | 'owned' | 'merchant' | 'self_pickup';
export type HandoverMode = 'to_campus_rider' | 'direct_to_user';
export type RouteFirstLeg = 'merchant' | 'owned' | 'campus' | 'external';
export type ExternalProviderCode = 'dada' | 'meituan';
/** 派单策略：调用方据此分流到不同处理器 */
export type DispatchStrategy = 'merchant_pool' | 'external_push' | 'hall_grab' | 'pickup' | 'errand';

/** 各路线允许的第一段承运方 */
export const ROUTE_FIRST_LEG_OPTIONS: Record<CampusRoute, readonly string[]> = {
    R1: ['merchant', 'owned'],
    R2: ['external'], // 固定，不在配置项里出现
    R3: ['campus', 'owned', 'external'],
    R4: ['self_pickup'], // 固定到店自取
    R5: ['campus'],
};

/** 默认第一段：R1 商户，R3 传信者 */
export const ROUTE_FIRST_LEG_DEFAULTS: Partial<Record<CampusRoute, RouteFirstLeg>> = {
    R1: 'merchant',
    R3: 'campus',
};

export interface HandoverPointConfig {
    name: string;
    address?: string;
    phone?: string;
    lat: number;
    lng: number;
    /** 兜底默认点：订单无可定位坐标时使用；每条路线最多一个生效 */
    isDefault?: boolean;
}

export interface RouteConfig {
    /** 按路线配置第一段承运方（只有 R1/R3 生效），未配置用默认值 */
    routeFirstLeg?: Record<string, string> | null;
    /** 校园交接点：R1/R2 可配多个（数组），兼容历史单点对象写法 */
    handoverPoints?: Record<string, HandoverPointConfig | HandoverPointConfig[]> | null;
    storeAddress?: string | null;
    storePhone?: string | null;
    storeLat?: number | null;
    storeLng?: number | null;
    merchantAcceptMinutes?: number | null;
}

export interface RoutePlan {
    route: CampusRoute;
    /** 第一段承运 */
    leg1: DeliveryPlan;
    /** 第二段：仅接力路线有 */
    leg2: 'campus_rider' | 'none';
    handover: HandoverMode | null;
    /** 仅 leg1=external_courier 时有值；由运营中心派单时决定 */
    externalProvider: ExternalProviderCode | null;
    dispatch: DispatchStrategy;
}

export interface GeoPointLike {
    name: string;
    address?: string;
    lat: number;
    lng: number;
    phone?: string;
}

/** 校验并归一某条路线的第一段承运方；不合法返回 null */
export function normalizeRouteFirstLeg(route: string, value: string | null | undefined): RouteFirstLeg | null {
    if (!(CAMPUS_ROUTES as readonly string[]).includes(route)) return null;
    const options = ROUTE_FIRST_LEG_OPTIONS[route as CampusRoute];
    const v = String(value ?? '').trim();
    return (options as readonly string[]).includes(v) ? (v as RouteFirstLeg) : null;
}

export function resolveRoutePlan(
    route: string,
    cfg: RouteConfig,
    externalProvider?: ExternalProviderCode | null,
): RoutePlan | null {
    if (!(CAMPUS_ROUTES as readonly string[]).includes(route)) return null;
    const r = route as CampusRoute;
    const configured = normalizeRouteFirstLeg(r, cfg.routeFirstLeg?.[r]);
    const first = configured ?? ROUTE_FIRST_LEG_DEFAULTS[r] ?? null;

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
                externalProvider: externalProvider ?? null,
                dispatch: 'external_push',
            };
        case 'R3': {
            const leg1: DeliveryPlan =
                first === 'owned' ? 'owned' : first === 'external' ? 'external_courier' : 'campus_rider';
            return {
                route: r,
                leg1,
                leg2: 'none',
                handover: leg1 === 'external_courier' ? 'direct_to_user' : null,
                externalProvider: leg1 === 'external_courier' ? (externalProvider ?? null) : null,
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
export function resolvePickup(_route: CampusRoute, cfg: RouteConfig): GeoPointLike | null {
    if (cfg.storeLat == null || cfg.storeLng == null) return null;
    return {
        name: cfg.storeAddress || '商家门店',
        address: cfg.storeAddress ?? undefined,
        lat: Number(cfg.storeLat),
        lng: Number(cfg.storeLng),
        phone: cfg.storePhone ?? undefined,
    };
}

/** 归一某路线的交接点列表：兼容历史「单点对象」写法，剔除缺名称/坐标的脏数据 */
export function listHandoverPoints(route: CampusRoute, cfg: RouteConfig): HandoverPointConfig[] {
    const raw = cfg.handoverPoints?.[route];
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter(p => !!p && !!String(p.name ?? '').trim() && p.lat != null && p.lng != null);
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
export function isRouteDeliverable(route: CampusRoute, cfg: RouteConfig | null | undefined): boolean {
    if (route !== 'R1' && route !== 'R2') return true;
    if (!cfg) return false;
    return listHandoverPoints(route, cfg).some(
        p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)),
    );
}

/** 两点间球面距离（米），用于按收货楼栋挑最近交接点 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000;
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

/**
 * 选交接点：有收货坐标取最近；否则取默认点；再否则取第一个。
 * 都缺返回 null（调用方按「未配置交接点」降级处理，禁止用 (0,0) 派单）。
 */
export function selectHandoverPoint(
    route: CampusRoute,
    cfg: RouteConfig,
    dest?: { lat: number; lng: number } | null,
): GeoPointLike | null {
    const list = listHandoverPoints(route, cfg);
    if (!list.length) return null;
    let picked: HandoverPointConfig;
    if (dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng)) {
        picked = list.reduce((best, p) =>
            haversineMeters(dest, p) < haversineMeters(dest, best) ? p : best,
        );
    } else {
        picked = list.find(p => p.isDefault) ?? list[0];
    }
    return {
        name: picked.name,
        address: picked.address ?? undefined,
        phone: picked.phone ?? undefined,
        lat: Number(picked.lat),
        lng: Number(picked.lng),
    };
}

/** 该路线选中的交接点（未配置返回 null，由调用方报「未配置交接点」） */
export function resolveHandoverPoint(
    route: CampusRoute,
    cfg: RouteConfig,
    dest?: { lat: number; lng: number } | null,
): GeoPointLike | null {
    return selectHandoverPoint(route, cfg, dest);
}

/** 外部快递的收货点：R1/R2 打本路线交接点；R3 直送打用户地址；R4 无配送 */
export function resolveDropoff(
    route: CampusRoute,
    plan: RoutePlan,
    cfg: RouteConfig,
    userPoint: GeoPointLike,
    dest?: { lat: number; lng: number } | null,
): GeoPointLike | null {
    if (route === 'R1' || route === 'R2') return resolveHandoverPoint(route, cfg, dest);
    if (route === 'R4') return null;
    return userPoint;
}
