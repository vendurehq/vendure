"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_ROLE_TEMPLATES = void 0;
const core_1 = require("@vendure/core");
exports.OFFICIAL_ROLE_TEMPLATES = [
    {
        key: 'tenant-admin',
        busiPrefix: 'tenant-admin',
        description: '租户管理员',
        permissions: [
            core_1.Permission.ReadCatalog, core_1.Permission.CreateCatalog, core_1.Permission.UpdateCatalog, core_1.Permission.DeleteCatalog,
            core_1.Permission.ReadProduct, core_1.Permission.CreateProduct, core_1.Permission.UpdateProduct, core_1.Permission.DeleteProduct,
            core_1.Permission.ReadOrder, core_1.Permission.UpdateOrder, core_1.Permission.CreateOrder,
            core_1.Permission.ReadAsset, core_1.Permission.CreateAsset, core_1.Permission.UpdateAsset, core_1.Permission.DeleteAsset,
            core_1.Permission.ReadCollection, core_1.Permission.CreateCollection, core_1.Permission.UpdateCollection, core_1.Permission.DeleteCollection,
            core_1.Permission.ReadShippingMethod, core_1.Permission.CreateShippingMethod, core_1.Permission.UpdateShippingMethod, core_1.Permission.DeleteShippingMethod,
            'ShippingProfile',
            core_1.Permission.ReadPaymentMethod, core_1.Permission.CreatePaymentMethod, core_1.Permission.UpdatePaymentMethod, core_1.Permission.DeletePaymentMethod,
            // 租户物理网点管理（方案3）：仓库/网点增删改
            core_1.Permission.CreateStockLocation, core_1.Permission.UpdateStockLocation, core_1.Permission.DeleteStockLocation,
            // 自提点管理（pickup admin resolver 需专用权限）
            'PickupLocationRead', 'PickupLocationCreate', 'PickupLocationUpdate', 'PickupLocationDelete',
            // 收银/POS：租户管理员可操作到店自提核销收款，且可向下授权「收银员」角色
            'ManageOwnShop',
            'TenantRoleManage', 'TenantMemberManage',
            // TenantSettingsManage / ReadPromotion / TenantPromotionManage 为超管专属权限，
            // 授予租户角色会 FORBIDDEN_PERMISSION 并导致默认角色创建失败，故不纳入模板；
            // 租户配置与营销活动写入改由超管操作
            // 多人协同盘库（规格 §9）：StocktakeCount/StocktakePost 为超管专属权限，
            // 授予租户角色会 FORBIDDEN_PERMISSION（每次启动补种 warn），移除——租户侧盘点由超管操作
        ],
    },
    {
        key: 'sales',
        busiPrefix: 'sales',
        description: '销售',
        permissions: [
            core_1.Permission.ReadCatalog,
            core_1.Permission.ReadProduct, core_1.Permission.CreateProduct, core_1.Permission.UpdateProduct,
            core_1.Permission.ReadOrder, core_1.Permission.UpdateOrder, core_1.Permission.CreateOrder,
            core_1.Permission.ReadAsset, core_1.Permission.CreateAsset,
            core_1.Permission.ReadCollection,
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
            core_1.Permission.ReadCatalog,
            core_1.Permission.ReadProduct,
            core_1.Permission.UpdateProduct,
            core_1.Permission.ReadOrder,
            // 多人协同盘库（规格 §9）：StocktakeCount/StocktakePost 为超管专属权限，
            // 授予租户角色会 FORBIDDEN_PERMISSION，故不纳入模板——租户侧盘点由超管操作
        ],
    },
    {
        key: 'cashier',
        busiPrefix: 'cashier',
        description: '收银员',
        permissions: [
            core_1.Permission.ReadOrder, core_1.Permission.UpdateOrder,
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
//# sourceMappingURL=role-templates.js.map