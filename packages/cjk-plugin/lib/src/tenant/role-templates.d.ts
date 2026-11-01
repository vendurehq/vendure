/**
 * 租户内置角色模板（单一来源）。
 * 官方自营租户 seed 与后续新建租户均从该模板生成角色，避免权限清单多处漂移。
 * 数据仍落成每租户独立的 Role（符合 Vendure 按 channel 授权），
 * 仅角色「定义」收敛为一处，改一处全局生效。
 */
export interface RoleTemplate {
    key: 'tenant-admin' | 'sales' | 'stock' | 'cashier' | 'campus-order-taker';
    busiPrefix: string;
    description: string;
    permissions: string[];
}
export declare const OFFICIAL_ROLE_TEMPLATES: RoleTemplate[];
