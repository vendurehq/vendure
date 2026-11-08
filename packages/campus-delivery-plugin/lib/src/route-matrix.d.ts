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
export declare const CAMPUS_ROUTES: readonly ["R1", "R2", "R3", "R4", "R5"];
export type CampusRoute = (typeof CAMPUS_ROUTES)[number];
export type DeliveryPlan = 'campus_rider' | 'external_courier' | 'owned' | 'merchant' | 'self_pickup';
export type HandoverMode = 'to_campus_rider' | 'direct_to_user';
export type RouteFirstLeg = 'merchant' | 'owned' | 'campus' | 'external';
export type ExternalProviderCode = 'dada' | 'meituan';
/** 派单策略：调用方据此分流到不同处理器 */
export type DispatchStrategy = 'merchant_pool' | 'external_push' | 'hall_grab' | 'pickup' | 'errand';
/** 各路线允许的第一段承运方 */
export declare const ROUTE_FIRST_LEG_OPTIONS: Record<CampusRoute, readonly string[]>;
/** 默认第一段：R1 商户，R3 传信者 */
export declare const ROUTE_FIRST_LEG_DEFAULTS: Partial<Record<CampusRoute, RouteFirstLeg>>;
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
export declare function normalizeRouteFirstLeg(route: string, value: string | null | undefined): RouteFirstLeg | null;
export declare function resolveRoutePlan(route: string, cfg: RouteConfig, externalProvider?: ExternalProviderCode | null): RoutePlan | null;
/** 取货点：店铺经纬度（档口/门店）；缺坐标返回 null，禁止用 (0,0) 派单 */
export declare function resolvePickup(_route: CampusRoute, cfg: RouteConfig): GeoPointLike | null;
/** 归一某路线的交接点列表：兼容历史「单点对象」写法，剔除缺名称/坐标的脏数据 */
export declare function listHandoverPoints(route: CampusRoute, cfg: RouteConfig): HandoverPointConfig[];
/**
 * 路线是否可交付（A1）：
 * 「可用交接点」判定条件（前后端唯一定义）：
 *   1) 配置中存在该路线的交接点（数组或历史单点对象均可）；
 *   2) name 去空格后非空；
 *   3) lat / lng 均非空且可转换为有限数字（排除脏数据/空坐标，避免用无效点派单）。
 * R1/R2 必须有至少一个可用交接点；其余路线不依赖交接点，恒为可交付。
 * C 端 waimaiStoreList.r1Available、下单闸门 order-gate 共用此函数，避免口径漂移。
 */
export declare function isRouteDeliverable(route: CampusRoute, cfg: RouteConfig | null | undefined): boolean;
/** 两点间球面距离（米），用于按收货楼栋挑最近交接点 */
export declare function haversineMeters(a: {
    lat: number;
    lng: number;
}, b: {
    lat: number;
    lng: number;
}): number;
/**
 * 选交接点：有收货坐标取最近；否则取默认点；再否则取第一个。
 * 都缺返回 null（调用方按「未配置交接点」降级处理，禁止用 (0,0) 派单）。
 */
export declare function selectHandoverPoint(route: CampusRoute, cfg: RouteConfig, dest?: {
    lat: number;
    lng: number;
} | null): GeoPointLike | null;
/** 该路线选中的交接点（未配置返回 null，由调用方报「未配置交接点」） */
export declare function resolveHandoverPoint(route: CampusRoute, cfg: RouteConfig, dest?: {
    lat: number;
    lng: number;
} | null): GeoPointLike | null;
/** 外部快递的收货点：R1/R2 打本路线交接点；R3 直送打用户地址；R4 无配送 */
export declare function resolveDropoff(route: CampusRoute, plan: RoutePlan, cfg: RouteConfig, userPoint: GeoPointLike, dest?: {
    lat: number;
    lng: number;
} | null): GeoPointLike | null;
