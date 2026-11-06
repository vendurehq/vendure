import { RequestContext, ChannelService, TransactionalConnection, ProductService } from '@vendure/core';
import { TenantMemberService } from './tenant-member.service';
import { TenantMember } from './tenant-member.entity';
/** 租户位容量：预留前 20 个官方租户位（tenantNo 1-20，见 seedOfficialTenants） */
export declare const TENANT_SLOT_CAPACITY = 20;
export declare class TenantAdminResolver {
    private channelService;
    private connection;
    private tenantMemberService;
    private productService;
    constructor(channelService: ChannelService, connection: TransactionalConnection, tenantMemberService: TenantMemberService, productService: ProductService);
    /** 租户位总览：capacity=20，slots 按 tenantNo 1-20 列出每格的占用情况 */
    tenantSlots(ctx: RequestContext): Promise<{
        capacity: number;
        used: number;
        slots: any[];
    }>;
    /** 清空指定租户名下全部商品（从零开始）：对该租户 channel 关联的每个商品做软删（softDelete）。不触碰配送/支付/账户等。 */
    clearTenantProducts(ctx: RequestContext, channelId: string): Promise<number>;
    tenants(ctx: RequestContext, args: {
        options: {
            skip?: number;
            take?: number;
            filter?: any;
        };
    }): Promise<{
        items: any[];
        totalItems: number;
    }>;
    tenant(ctx: RequestContext, id: string): Promise<any>;
    createTenant(ctx: RequestContext, args: {
        input: {
            name: string;
            token?: string;
            isOfficial?: boolean;
        };
    }): Promise<any>;
    updateTenant(ctx: RequestContext, args: {
        id: string;
        input: {
            name?: string;
            tenantNo?: number;
            isOfficial?: boolean;
            domain?: string;
            industryType?: string;
            storefrontMode?: string;
            storefrontHomeLayout?: string;
            couponFloorGroups?: string;
            firstBuyDiscount?: number;
            couponCampaign?: string;
            billpayMaxSalePrice?: number;
            billpayMaxFaceValue?: number;
            billpayMaxBundleTotal?: number;
            billpayMinValidDays?: number;
            billpayExpireRefundPolicy?: string;
        };
    }): Promise<any>;
    setTenantEnabled(ctx: RequestContext, args: {
        id: string;
        enabled: boolean;
    }): Promise<any>;
    /** 软删：标记停用，不做物理删除 */
    deleteTenant(ctx: RequestContext, id: string): Promise<boolean>;
    tenantAdministrators(ctx: RequestContext, channelId: string): Promise<TenantMember[]>;
    createTenantAdministrator(ctx: RequestContext, args: {
        channelId: string;
        input: any;
    }): Promise<TenantMember>;
    setTenantAdministratorEnabled(ctx: RequestContext, args: {
        id: string;
        enabled: boolean;
    }): Promise<TenantMember>;
    deleteTenantAdministrator(ctx: RequestContext, id: string): Promise<boolean>;
    /** 重置租户管理人密码（管理员 Tab 某成员）：随机一次性口令，返回明文供本次转交（仅超管） */
    resetTenantAdministratorPassword(ctx: RequestContext, memberId: string): Promise<string>;
    tenantRoles(ctx: RequestContext, channelId: string): Promise<any[]>;
    createTenantRole(ctx: RequestContext, args: {
        channelId: string;
        input: {
            code: string;
            description: string;
            permissions: string[];
        };
    }): Promise<any>;
    updateTenantRole(ctx: RequestContext, args: {
        roleId: string;
        input: {
            code?: string;
            description?: string;
            permissions?: string[];
        };
    }): Promise<any>;
    deleteTenantRole(ctx: RequestContext, roleId: string): Promise<boolean>;
    updateTenantMemberRoles(ctx: RequestContext, args: {
        id: string;
        channelId: string;
        roleIds: string[];
    }): Promise<boolean>;
    setTenantMemberRedeemProfiles(ctx: RequestContext, args: {
        id: string;
        shippingProfileIds: string[];
    }): Promise<any>;
    tenantSearchAdmins(ctx: RequestContext, args: {
        channelId: string;
        keyword?: string;
    }): Promise<any[]>;
    tenantLinkMember(ctx: RequestContext, args: {
        channelId: string;
        administratorId: string;
        roleIds?: string[];
        displayName?: string;
        phone?: string;
        remark?: string;
    }): Promise<any>;
    importDefaultRoles(ctx: RequestContext, channelId: string): Promise<any[]>;
    globalRoles(ctx: RequestContext): Promise<any[]>;
    globalRoleTemplates(ctx: RequestContext): Promise<any[]>;
    createGlobalRole(ctx: RequestContext, args: {
        channelIds: string[];
        input: {
            code: string;
            description: string;
            permissions: string[];
        };
    }): Promise<any[]>;
    referGlobalRoleToChannel(ctx: RequestContext, args: {
        roleId: string;
        channelId: string;
    }): Promise<boolean>;
    unreferGlobalRoleFromChannel(ctx: RequestContext, args: {
        roleId: string;
        channelId: string;
    }): Promise<boolean>;
}
