import { Permission } from '@vendure/core';

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

export const OFFICIAL_ROLE_TEMPLATES: RoleTemplate[] = [
    {
        key: 'tenant-admin',
        busiPrefix: 'tenant-admin',
        description: '租户管理员',
        permissions: [
            Permission.ReadCatalog, Permission.CreateCatalog, Permission.UpdateCatalog, Permission.DeleteCatalog,
            Permission.ReadProduct, Permission.CreateProduct, Permission.UpdateProduct, Permission.DeleteProduct,
            Permission.ReadOrder, Permission.UpdateOrder, Permission.CreateOrder,
            Permission.ReadAsset, Permission.CreateAsset, Permission.UpdateAsset, Permission.DeleteAsset,
            Permission.ReadCollection, Permission.CreateCollection, Permission.UpdateCollection, Permission.DeleteCollection,
            Permission.ReadShippingMethod, Permission.CreateShippingMethod, Permission.UpdateShippingMethod, Permission.DeleteShippingMethod,
            'ShippingProfile',
            Permission.ReadPaymentMethod, Permission.CreatePaymentMethod, Permission.UpdatePaymentMethod, Permission.DeletePaymentMethod,
            // 租户物理网点管理（方案3）：仓库/网点增删改
            Permission.CreateStockLocation, Permission.UpdateStockLocation, Permission.DeleteStockLocation,
            // 自提点管理（pickup admin resolver 需专用权限）
            'PickupLocationRead', 'PickupLocationCreate', 'PickupLocationUpdate', 'PickupLocationDelete',
            // 收银/POS：租户管理员可操作到店自提核销收款，且可向下授权「收银员」角色
            'ManageOwnShop',
            'TenantRoleManage', 'TenantMemberManage',
            // 营销活动：flash-sale/团购/预售 admin 接口已收紧到 Promotion 权限，租户管理员仅保留只读
            Permission.ReadPromotion,
            // 多人协同盘库（规格 §9）：StocktakeCount/StocktakePost 为超管专属权限，
            // 授予租户角色会 FORBIDDEN_PERMISSION（每次启动补种 warn），移除——租户侧盘点由超管操作
        ],
    },
    {
        key: 'sales',
        busiPrefix: 'sales',
        description: '销售',
        permissions: [
            Permission.ReadCatalog,
            Permission.ReadProduct, Permission.CreateProduct, Permission.UpdateProduct,
            Permission.ReadOrder, Permission.UpdateOrder, Permission.CreateOrder,
            Permission.ReadAsset, Permission.CreateAsset,
            Permission.ReadCollection,
            // 到店核销（受限）：持有该权限即「受限核销员」，只能在人员管理配置的配送档案白名单范围内核销；
            // 白名单为空 = 一律拒绝（新租户销售员默认不可见，需店主显式配置后才放行）
            'VerifyOrder',
        ],
    },
    {
        key: 'stock',
        busiPrefix: 'stock',
        description: '库存',
        permissions: [
            Permission.ReadCatalog,
            Permission.ReadProduct,
            Permission.UpdateProduct,
            Permission.ReadOrder,
            // 多人协同盘库（规格 §9）：仓管/盘点员只「能盘」，不过账
            'StocktakeCount',
        ],
    },
    {
        key: 'cashier',
        busiPrefix: 'cashier',
        description: '收银员',
        permissions: [
            Permission.ReadOrder, Permission.UpdateOrder,
            'ManageOwnShop',
        ],
    },
    {
        key: 'campus-order-taker',
        busiPrefix: 'campus-order-taker',
        description: '外卖接单',
        // 校园外卖商家工作台的最小权限：仅接单/拒单/出餐/沽清/催单/售后与退款，全部挂在 CampusMerchant，
        // 不含目录/商品/订单等通用后台权限；能看到哪家店由角色绑定的 channel 决定。
        permissions: ['CampusMerchant'],
    },
];