import { PaymentMethodService, RequestContextService, ShippingMethodService, TransactionalConnection } from '@vendure/core';
import { PaymentProfileService } from '../payment/payment-profile.service';
import { ShippingProfileService } from '../shipping/shipping-profile.service';
import { ShippingTemplateService } from '../shipping/shipping-template.service';
import { PaymentTemplateService } from '../payment/payment-template.service';
import { OFFICIAL_ROLE_TEMPLATES, RoleTemplate } from '../tenant/role-templates';
export { OFFICIAL_ROLE_TEMPLATES, RoleTemplate };
/**
 * 插件默认数据初始化
 *
 * 商品级配送/支付方案（ShippingProfile/PaymentProfile）建表后为空。
 * 本服务在 onApplicationBootstrap 阶段幂等创建一套全局默认数据，便于快速投入使用：
 * - 自提点（门店）
 * - 门店自提配送方式 + 配送模板 + 配送档案
 * - 门店收银支付方式 + 支付档案
 *
 * 默认数据均为全局档案（isGlobal=true），所有租户共享。
 * 通过 CjkPlugin.options.seedDefaultData = false 可禁用。
 */
export declare class DefaultDataService {
    private connection;
    private requestContextService;
    private shippingMethodService;
    private paymentMethodService;
    private shippingTemplateService;
    private shippingProfileService;
    private paymentProfileService;
    private paymentTemplateService;
    constructor(connection: TransactionalConnection, requestContextService: RequestContextService, shippingMethodService: ShippingMethodService, paymentMethodService: PaymentMethodService, shippingTemplateService: ShippingTemplateService, shippingProfileService: ShippingProfileService, paymentProfileService: PaymentProfileService, paymentTemplateService: PaymentTemplateService);
    /**
     * 幂等创建默认数据。
     *
     * 每个步骤独立执行（见 runSeedSteps）：单步失败只记录步骤名与错误，继续执行后续步骤，
     * 最后汇总一条日志列出失败步骤。这样「全局配送档案」这类需要 SuperAdmin 的步骤失败时，
     * 不会再把官方租户播种等关键步骤一起作废。
     */
    seed(): Promise<void>;
    /**
     * 播种上下文：优先带「超管用户」，而不是裸 admin ctx。
     *
     * 原因：全局档案（isGlobal=true）的 create/update/delete 会被
     * assertProfileGlobalPermissions（shipping-profile.service.ts）要求 SuperAdmin 权限，
     * 而 RequestContextService.create({ apiType: 'admin' }) 不带 session user，
     * ctx.userHasPermissions([Permission.SuperAdmin]) 恒为 false —— 这正是本库
     * seedStorePickupProfile 抛「仅超级管理员可创建全局档案」、并连带阻断官方租户播种的根因。
     *
     * 找不到超管角色/用户时退回原行为（只警告，不阻断启动），后续步骤由 runSeedSteps 隔离。
     */
    private createSeedContext;
    /** 默认门店自提点 */
    private seedPickupLocation;
    /** 门店自提配送方式 */
    private seedStorePickupMethod;
    /** 门店自提配送模板 */
    private seedStorePickupTemplate;
    /** 门店自提配送档案（关联配送方式 + 自提点） */
    private seedStorePickupProfile;
    /** 门店收银支付方式（货到付款处理器） */
    private seedCashierPaymentMethod;
    /** 门店收银支付档案 */
    private seedCashierPaymentProfile;
    /** 自提点配送全局模板（固定运费，租户引用后在实例上配 shippingPrice） */
    private seedPickupPointTemplate;
    /** 职工单位自提配送全局模板（固定运费） */
    private seedEmployeePickupTemplate;
    /** 同城快递配送全局模板（固定运费） */
    private seedLocalDeliveryTemplate;
    /** 邮寄配送全局模板（阶梯重量/件数计费） */
    private seedMailTemplate;
    private shippingTemplateExists;
    /** 货到付款支付全局模板 */
    private seedCashOnDeliveryPaymentTemplate;
    /** 余额支付全局模板 */
    private seedBalancePayPaymentTemplate;
    private paymentTemplateExists;
    /** 聚合码支付全局模板（租户可在全局方案池「引用到本店」） */
    private seedAggregatePaymentTemplate;
    /** 固定聚合码收款支付全局模板（门店到店收银，租户可在全局方案池「引用到本店」） */
    private seedFixedAggregatePaymentTemplate;
    /**
     * 幂等创建前 20 个官方自营租户（tenantNo 1-20，isOfficial=true）。
     * 每个租户：3 个内置角色（租户管理员/销售/库存）+ 默认管理员 admin
     *            + 门店自提配送方式 + 门店收银支付方式（复用全局 handler）。
     * 已存在（按 channel.code 判重）则跳过。
     */
    private seedOfficialTenants;
    /**
     * 官方管理员账号完整建链：NativeAuthenticationMethod(user+auth) → User(绑定角色) → Administrator(挂 user) → TenantMember。
     * 直接 save Administrator 不会生成 vendure 认证链路（user/authentication_method），导致账号无法登录。
     */
    private createOfficialAdminWithAccount;
    /** 修复历史破损官方管理员：此前直存 Administrator 未建 user/auth，现补齐使其可登录。
     *  幂等：user 已存在则跳过；破损则删旧 Admin + 其 TenantMember，再用正确链路重建。 */
    private repairOfficialAdminAccounts;
    /** 为已存在的官方内置角色补齐 Authenticated 权限（历史种子直存 Role 遗漏该权限），否则过期账号登录被拒。幂等。 */
    private ensureOfficialRolesAuthenticated;
    /**
     * 按角色模板补齐存量角色权限：模板新增权限（如租户网点管理所需的 CreateStockLocation 等）时，
     * 已存在的租户角色自动同步。幂等且只增不减（不删除角色现有权限），避免覆盖租户定制。
     * 匹配范围：official-tenant-admin-N（官方 seed 角色）与 tN-tenant-admin / tN-sales / tN-stock（租户角色）。
     */
    private syncRolePermissionsFromTemplates;
    /** 延迟加载 Vendure 核心实体，避免 seed 阶段循环依赖 */
    private ensureCoreEntities;
    private createTenantRoleRecord;
    private hashPassword;
}
export declare const DEFAULT_STORE: {
    name: string;
    type: "store";
    address: string;
    phoneNumber: string;
    businessHours: string;
};
export declare const STORE_PICKUP_METHOD_CODE = "store-pickup";
export declare const STORE_PICKUP_TEMPLATE_CODE = "store-pickup-template";
export declare const PICKUP_POINT_TEMPLATE_CODE = "pickup-point-template";
export declare const EMPLOYEE_PICKUP_TEMPLATE_CODE = "employee-pickup-template";
export declare const LOCAL_DELIVERY_TEMPLATE_CODE = "local-delivery-template";
export declare const MAIL_TEMPLATE_CODE = "mail-template";
export declare const STORE_PICKUP_PROFILE_CODE = "store-pickup-profile";
export declare const CASHIER_PAYMENT_METHOD_CODE = "cash-on-delivery";
export declare const CASHIER_PAYMENT_PROFILE_CODE = "store-cashier-profile";
export declare const COD_PAYMENT_TEMPLATE_CODE = "cod-payment-template";
export declare const BALANCE_PAY_TEMPLATE_CODE = "balance-pay-template";
export declare const AGGREGATE_PAYMENT_TEMPLATE_CODE = "aggregate-pay";
export declare const FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE = "fixed-aggregate-collection";
