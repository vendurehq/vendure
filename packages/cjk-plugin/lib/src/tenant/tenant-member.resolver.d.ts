import { RequestContext, TransactionalConnection, ID } from '@vendure/core';
import { TenantMemberService, PermissionCatalogGroup } from './tenant-member.service';
import { TenantMember } from './tenant-member.entity';
/**
 * 租户管理员 API：所有操作强制限定在 ctx.channelId（当前请求租户）。
 */
export declare class TenantMemberResolver {
    private connection;
    private tenantMemberService;
    constructor(connection: TransactionalConnection, tenantMemberService: TenantMemberService);
    tenantMembers(ctx: RequestContext): Promise<TenantMember[]>;
    createTenantMember(ctx: RequestContext, args: {
        input: any;
    }): Promise<TenantMember>;
    setTenantMemberEnabled(ctx: RequestContext, args: {
        id: string;
        enabled: boolean;
    }): Promise<TenantMember>;
    deleteTenantMember(ctx: RequestContext, id: string): Promise<boolean>;
    permissionCatalog(): Promise<PermissionCatalogGroup[]>;
    myTenantRoles(ctx: RequestContext): Promise<any[]>;
    myGlobalRolesAvailable(ctx: RequestContext): Promise<any[]>;
    myImportDefaultRoles(ctx: RequestContext): Promise<any[]>;
    myReferGlobalRole(ctx: RequestContext, roleId: ID): Promise<boolean>;
    myUnreferGlobalRole(ctx: RequestContext, roleId: ID): Promise<boolean>;
    myUpdateChannelCustomFields(ctx: RequestContext, input: Record<string, any>): Promise<any>;
    myCreateTenantRole(ctx: RequestContext, args: {
        input: {
            code: string;
            description: string;
            permissions: string[];
        };
    }): Promise<any>;
    myUpdateTenantRole(ctx: RequestContext, args: {
        roleId: string;
        input: any;
    }): Promise<any>;
    myDeleteTenantRole(ctx: RequestContext, roleId: string): Promise<boolean>;
    /** 设置当前租户某人员的可核销配送档案白名单（受限核销员） */
    mySetTenantMemberRedeemProfiles(ctx: RequestContext, args: {
        id: string;
        shippingProfileIds: string[];
    }): Promise<any>;
    /** 更换当前租户某人员的角色 */
    myUpdateTenantMemberRoles(ctx: RequestContext, args: {
        id: string;
        roleIds: string[];
    }): Promise<boolean>;
    mySearchAdmins(ctx: RequestContext, keyword?: string): Promise<any[]>;
    myLinkMember(ctx: RequestContext, args: {
        administratorId: string;
        roleIds?: string[];
        displayName?: string;
        phone?: string;
        remark?: string;
    }): Promise<any>;
    roleIds(member: TenantMember, ctx: RequestContext): Promise<ID[]>;
    /** 租户自助重置本租户成员密码：随机一次性口令，返回明文供本次转交（权限门禁见 service） */
    myResetTenantMemberPassword(ctx: RequestContext, id: string): Promise<string>;
    /** 当前登录者修改自身密码（主动改密传旧密码校验；首登强改密 oldPassword 传 null 跳过校验） */
    tenantChangeMyPassword(ctx: RequestContext, oldPassword: string | null, newPassword: string): Promise<boolean>;
}
