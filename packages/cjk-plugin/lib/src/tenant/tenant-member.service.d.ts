import { AdministratorService, AuthService, ChannelService, ID, RequestContext, RequestContextCacheService, RoleService, TransactionalConnection } from '@vendure/core';
import type { CjkPluginOptions } from '../types';
import { TenantMember } from './tenant-member.entity';
import { VirtualPhysicalStockService } from '../inventory/virtual-physical-stock.service';
import { ChannelProvisioningService } from './channel-provisioning.service';
export interface PermissionCatalogItem {
    code: string;
    label: string;
}
export interface PermissionCatalogGroup {
    key: string;
    label: string;
    items: PermissionCatalogItem[];
}
/**
 * 租户级业务权限目录（单一来源，前后端共用，避免双份硬编码）。
 * 不含超管专属权限；Vendure v3 已将 Variant/Fulfillment 等合并进 catalog/product/order 权限。
 * 前端角色管理页通过 permissionCatalog 查询动态渲染，BUSINESS_PERMISSIONS 由此扁平派生。
 */
export declare const PERMISSION_CATALOG: PermissionCatalogGroup[];
/** 租户级角色可用的业务权限白名单（由 PERMISSION_CATALOG 扁平派生，建模/校验统一使用） */
export declare const BUSINESS_PERMISSIONS: string[];
/** 全局角色 code 前缀：超管建的全局角色统一加此前缀，用于池查询与全局/本地判定（Vendure Role 无 customFields，用前缀区分） */
export declare const GLOBAL_ROLE_PREFIX = "g-";
/** 官方租户位数量：tenantNo 1..20 预留给官方自营租户（见 seedOfficialTenants） */
export declare const OFFICIAL_TENANT_SLOTS = 20;
/**
 * 租户编号起始位扩展点（不硬编码方案，留给部署决策）：
 * - 默认 0 = 沿用「当前最大 tenantNo + 1」，空库首个租户为 1（现有行为不变）；
 * - 若决定「官方自营先占 1..20、业务租户从 21 起」，设 TENANT_NO_START=20；
 * - 若决定「业务租户固定偏移」，填偏移上限即可。取值在调用时读取，避免构建期固化。
 */
export declare function tenantNoStart(): number;
/** 业务租户总数上限（不含官方自营租户）；创建时超限拒绝 */
export declare const BUSINESS_TENANT_CAPACITY = 100;
/** 全局角色 code 规范化：输入 code 自动统一为 `g-{code}`，避免手动误输入前缀产生重复 */
export declare function normalizeGlobalRoleCode(code: string): string;
export interface CreateTenantAdminInput {
    firstName?: string;
    lastName?: string;
    emailAddress: string;
    password?: string;
    roleIds: ID[];
    displayName?: string;
    remark?: string;
    phone?: string;
    enabled?: boolean;
    /** 强制首登改密（默认：未显式传 password 时为 true；显式传 password 时为 false） */
    forcePasswordChange?: boolean;
}
/** 生成随机强口令：≥10 位，保证大小写/数字/符号各类至少一个 */
export declare function randomStrongPassword(length?: number): string;
/** 一次性重置口令的有效期：24 小时。超期后必须由管理员重新重置，口令不可再用 */
export declare const RESET_PASSWORD_TTL_MS: number;
/** 可授判定：目标角色权限 ⊆ 操作者权限，且不含租户管理类权限（防链式提权）。
 *  Authenticated 为所有角色基础权限，不计入比较。 */
export declare function canGrantRole(operatorPerms: Set<string>, rolePermissions: string[]): boolean;
/** 角色去重：按展示名（description || code）合并，同名时本地角色（code 非 g- 前缀）优先于全局角色 */
export declare function dedupeRolesByLabel(roles: any[]): any[];
export declare class TenantMemberService {
    private connection;
    private administratorService;
    private roleService;
    private channelService;
    private authService;
    private requestContextCache;
    private virtualPhysicalStockService;
    private channelProvisioningService;
    private pluginOptions?;
    constructor(connection: TransactionalConnection, administratorService: AdministratorService, roleService: RoleService, channelService: ChannelService, authService: AuthService, requestContextCache: RequestContextCacheService, virtualPhysicalStockService: VirtualPhysicalStockService, channelProvisioningService: ChannelProvisioningService, pluginOptions?: CjkPluginOptions | undefined);
    /** 校验角色权限全部在业务权限白名单内（超管专属权限不入租户角色）。Authenticated 为基础权限不计入 */
    assertBusinessPermissions(permissions: string[]): void;
    /** 校验请求方是该 channel 的租户管理员（或超管） */
    assertChannelMember(ctx: RequestContext, channelId?: ID): void;
    /** 安全加固：校验目标角色必须属于指定 channel，防止跨租户改/删任意角色（横向越权） */
    assertRoleInChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void>;
    /** 安全加固：校验待绑定角色全部属于指定 channel，防止租户管理员绑定别店角色提权 */
    assertRolesInChannel(ctx: RequestContext, roleIds: ID[], channelId: ID): Promise<void>;
    /** 当前登录者在本租户（ctx.channelId）的业务权限并集。
     *  Vendure 缓存 session 用户用 channelPermissions（UserChannelPermissions[] = { id, token, code, permissions }）。 */
    private channelOperatorPerms;
    /** 权限门禁（权威）：非超管授予的角色必须 canGrantRole 通过，否则抛错。调用点须已过 assertRolesInChannel。 */
    assertCanGrant(ctx: RequestContext, roleIds: ID[]): Promise<void>;
    /**
     * Vendure 要求 Channel.defaultLanguageCode 必须在 GlobalSettings.availableLanguages 中，
     * 否则 channelService.create 返回 LanguageNotAvailableError（无 id），渠道也不会落库。
     * 新建租户时按需把语言补进全局启用列表，避免租户创建依赖部署侧的 languages 配置。
     */
    private ensureLanguageEnabled;
    /** 新建租户：自动分配 tenantNo（当前最大+1），code 由 tenantNo 派生 `t{tenantNo}`，避免手输冲突 */
    createChannel(ctx: RequestContext, input: {
        name: string;
        token?: string;
        isOfficial?: boolean;
        /** 可选：默认语言（默认 zh_Hans，跨境渠道传 ko） */
        defaultLanguageCode?: string;
        /** 可选：默认币种（默认 CNY，跨境渠道传 KRW） */
        currencyCode?: string;
        /** 可选：渠道自定义字段（如 ONE BRIDGE 的 onebridgeEnabled / 频道配置） */
        extraCustomFields?: Record<string, unknown>;
        /** 可选：多域名（域名解析只读 customDomains，必须与 nginx proxy_set_header Host 一致） */
        customDomains?: string[];
        /** 可选：对外访问地址（默认按主域 + /t{tenantNo} 生成） */
        domain?: string;
    }): Promise<any>;
    /** 渠道创建成功后同步到 SSO 渠道表 sso_channels（fire-and-forget，失败仅告警不阻塞租户创建）。
     *  保证渠道报表/点击追踪不因渠道缺失而丢数据。需配置 SSO_CHANNEL_SYNC_URL 与
     *  SSO_CHANNEL_SYNC_TOKEN 环境变量（shared secret），未配置则跳过。 */
    private syncChannelToSso;
    /** 统计业务租户数（不含官方自营）：isOfficial !== true 且 tenantNo 在官方位之后。
     *  与 nextTenantNo 一样用 repo.find() 绕开 channelService.findAll 的 take≤1000 限制。 */
    private countBusinessTenants;
    /** 取「当前最大 tenantNo」与「可配置起始位」的较大者，自增 1；无数据时默认第 1 个租户得到 1。
     *  用 TypeORM 原生 read 绕开 channelService.findAll 的 take≤1000 限制（否则新建租户必报「查询结果大于1000」）。 */
    private nextTenantNo;
    /**
     * 租户启停（仅超管）；停用时同步释放该渠道的门店认领并重算商户认领状态。
     * 产品语义：停用可逆 —— 自提点与渠道的 channels 关联刻意保留，重新启用后原关联继续可用；
     * 如需解除关联请走 pickup 管理接口（removePickupLocationsFromChannel 等）。
     */
    setChannelEnabled(ctx: RequestContext, channelId: ID, enabled: boolean): Promise<void>;
    /**
     * 租户停用后释放其门店认领：merchant_store_channel → REVOKED，并重算受影响商户的 claimStatus。
     * 用原生 SQL 避免 cjk-plugin 反向依赖 merchant-plugin；相关表不存在时（未装载 merchant-plugin）直接跳过。
     */
    private revokeChannelClaims;
    /** 更新租户基础信息（仅超管）：name → shopName；domain → 默认外网域名。合并既有 customFields，仅覆盖传入字段。 */
    updateChannel(ctx: RequestContext, channelId: ID, input: {
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
    }): Promise<void>;
    /** 租户级角色创建（限定 channelIds=[channelId]；权限白名单校验） */
    createTenantRole(ctx: RequestContext, channelId: ID, input: {
        code: string;
        description: string;
        permissions: string[];
    }): Promise<any>;
    /** 判断指定 channel 是否已存在该 code 的关联角色（幂等判定）。 */
    private roleExistsInChannel;
    /** 按 channelId 直查该租户全部角色：同名去重（本地优先全局），并按操作者权限标注 grantable（超管全 true）。 */
    rolesForChannel(ctx: RequestContext, channelId: ID): Promise<any[]>;
    /** 系统直建租户级角色（绕过 roleService.create 的权限校验，仅用于启动补种子/一键导入这类系统操作）。
     *  幂等：仅当该 code 在本 channel 不存在时才创建。 */
    private createTenantRoleDirect;
    /** 建全局角色并批量分发到店：code 自动加 `g-` 前缀；channelIds 为空 → channels=[]（全局可用），非空 → channels=[勾选店]（全局默认）。
     *  统一幂等：code 已存在则仅追加缺失店，绝不重复关联同一店。所有加店路径（创建时勾选/分发/引用）均应收敛到此核心语义。 */
    createGlobalRoleWithChannels(ctx: RequestContext, channelIds: ID[], input: {
        code: string;
        description: string;
        permissions: string[];
    }): Promise<any[]>;
    /** 直建全局可用角色（channels=[]）。空 channelIds 走 createGlobalRoleWithChannels；保持幂等语义。 */
    createGlobalRoleDirect(ctx: RequestContext, input: {
        code: string;
        description: string;
        permissions: string[];
    }): Promise<any>;
    /** 把全局角色引用到某店（幂等：已含该店则 no-op；仅 g- 前缀全局角色允许被引用，租户本地角色不可引）。
     *  超管从池继续分发也已含本方法，故去掉原「channels 必须为空」限制，允许多店分发。 */
    referGlobalRoleToChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void>;
    /** 取消某店对该全局角色的引用（移除该店；channels 变空则回到全局池）。 */
    unreferGlobalRoleFromChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void>;
    /** 租户自助：引用全局角色到当前 ctx.channelId。仅允许引用「未绑定任何店」的 g- 角色（channels=[]），
     *  防止租户引用已被他店绑定（channels 非空）的角色造成跨店共享越权。 */
    myReferGlobalRole(ctx: RequestContext, roleId: ID): Promise<void>;
    /** 租户自助可引用列表：仅返回「未绑定任何店」的 g- 角色（channels=[]，可引用）。 */
    globalRolesAvailable(ctx: RequestContext): Promise<any[]>;
    /** 租户自助：从当前 ctx.channelId 取消引用。 */
    myUnreferGlobalRole(ctx: RequestContext, roleId: ID): Promise<void>;
    /** 查全部全局角色（code 以 g- 开头；channels 可为空=全局可用，非空=已分发到店）。 */
    globalRoles(ctx: RequestContext): Promise<any[]>;
    /** 全局默认角色模板（不落库为 Role）：租户"导入到本店"时复制独立副本，各租户权限互不影响 */
    globalRoleTemplates(ctx: RequestContext): Promise<any[]>;
    /** 单租户按模板补齐缺失的默认角色（幂等）。逐个 code 判存，模板新增角色时存量租户也能补齐。 */
    importDefaultRoles(ctx: RequestContext, channelId: ID): Promise<any[]>;
    /** 租户自助：从全局默认模板复制独立副本到当前 ctx.channelId（幂等，复用 importDefaultRoles） */
    myImportDefaultRoles(ctx: RequestContext): Promise<any[]>;
    /** 启动补种子：扫描所有 Channel，缺默认角色则幂等补建；异常仅打日志不阻塞启动。 */
    ensureDefaultRolesForAllChannels(ctx: RequestContext): Promise<void>;
    /** 收银/POS 启动补种（幂等）：① 确保已存在租户「收银员」角色；② 补齐租户管理员角色的 ManageOwnShop（可收银 + 可授收银员）。 */
    private ensurePOSRolesForChannel;
    /** 把指定渠道关联到超管角色（幂等）——超管全局豁免渠道校验的核心：superadmin 角色须覆盖所有渠道，
     *  否则超管切到未绑定角色渠道时 Vendure 权限守卫无任何权限，无法在租户内发商品/提审等操作。 */
    ensureSuperAdminRoleCoversChannel(ctx: RequestContext, channelId: ID): Promise<void>;
    /** 把所有存量渠道补关联到超管角色（幂等；失败仅打日志不阻塞启动） */
    ensureSuperAdminRoleCoversAllChannels(ctx: RequestContext): Promise<void>;
    /** 把指定渠道列表关联到超管角色（幂等：已含则 no-op）。superadmin 角色自带 SuperAdmin 权限，
     *  一旦覆盖某渠道，userHasPermissions(Permission.SuperAdmin) 在该渠道即返回 true，实现超管全局豁免。 */
    private ensureSuperAdminRoleCoversChannels;
    /** 租户级角色更新（权限白名单校验；channelId 非空时校验角色归属，防横向越权） */
    updateTenantRole(ctx: RequestContext, roleId: ID, input: {
        code?: string;
        description?: string;
        permissions?: string[];
    }, channelId?: ID): Promise<any>;
    /** 租户级角色删除（channelId 非空时校验角色归属，防横向越权） */
    deleteTenantRole(ctx: RequestContext, roleId: ID, channelId?: ID): Promise<void>;
    /** 更换某人员在该租户内的角色：归属 + 白名单 + 横向越权三重校验 */
    updateTenantMemberRoles(ctx: RequestContext, channelId: ID, memberId: ID, roleIds: ID[]): Promise<void>;
    /**
     * 设置某人员的「可核销配送档案」白名单（受限核销员）。
     * 归属校验：成员须属于该租户；档案须存在且为全局档案或本租户档案。
     * 空白名单 = 默认拒绝（该人员将看不到/核销不了任何单据）。
     */
    setMemberRedeemProfiles(ctx: RequestContext, channelId: ID, memberId: ID, shippingProfileIds: ID[]): Promise<any>;
    /** 校验档案 id 均存在且对当前租户可见（全局档案 或 本租户档案） */
    private assertShippingProfilesVisible;
    /** 以「合并」语义同步某管理员在本 channel 的角色：仅替换本租户角色，保留其在其它租户的角色（跨店任职互不影响） */
    syncMemberRolesInChannel(ctx: RequestContext, administratorId: ID, channelId: ID, roleIds: ID[]): Promise<void>;
    /** 返回人员在当前租户内的角色 id（用于改角色弹层回显勾选） */
    memberRoleIdsInChannel(ctx: RequestContext, member: TenantMember): Promise<ID[]>;
    /** 将 TenantMember 组装为含 roleIds / canResetPassword / emailAddress 的视图对象 */
    memberToView(ctx: RequestContext, member: TenantMember): Promise<any>;
    /** 超管为租户建管理员账号并绑定角色，同时写入 TenantMember */
    createTenantAdministrator(ctx: RequestContext, channelId: ID, input: CreateTenantAdminInput): Promise<TenantMember>;
    /** 当前登录者修改自身密码：主动改密必须校验旧密码；仅首登强改密（mustChangePassword=true）允许跳过旧密码校验。更新后清除本租户首登强改密标志 */
    changeMyPassword(ctx: RequestContext, oldPassword: string | null, newPassword: string): Promise<void>;
    /** 租户人员启停 */
    setMemberEnabled(ctx: RequestContext, channelId: ID, memberId: ID, enabled: boolean): Promise<void>;
    /** 租户人员移除（仅删 TenantMember 关联，Administrator 本体保留） */
    removeMember(ctx: RequestContext, channelId: ID, memberId: ID): Promise<void>;
    /**
     * 超管重置租户管理人密码：生成随机一次性口令，保留首登强改密并写入 24 小时有效期。
     * 明文仅经返回值（initialPassword）交给操作者，不落日志、不落库。
     */
    resetAdminPassword(ctx: RequestContext, memberId: ID): Promise<TenantMember>;
    /** 租户自助：重置本租户成员密码（随机一次性口令 + 强改密 + 有效期；目标权限必须低于操作者） */
    resetMyMemberPassword(ctx: RequestContext, memberId: ID): Promise<TenantMember>;
    /** 搜索后台账号（按邮箱/姓氏模糊匹配），返回各账号在租户内的关联统计，供「关联已有账号进租户」选择 */
    searchAdmins(ctx: RequestContext, channelId: ID, keyword?: string, take?: number): Promise<any[]>;
    /** 将既有后台账号关联进某租户（写入 TenantMember 并合并绑定本租户角色）；若已在该租户则报错 */
    linkMember(ctx: RequestContext, channelId: ID, input: {
        administratorId: ID;
        roleIds?: ID[];
        enabled?: boolean;
        displayName?: string;
        phone?: string;
        remark?: string;
    }): Promise<any>;
    /** 租户管理员更新「本 channel」装修类 customFields（仅覆盖传入字段，禁止触碰安全字段） */
    updateMyChannelCustomFields(ctx: RequestContext, input?: Record<string, any>): Promise<any>;
}
