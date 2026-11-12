import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    Administrator,
    AdministratorService,
    AuthService,
    Channel,
    ChannelService,
    GlobalSettings,
    ID,
    Logger,
    Permission,
    RequestContext,
    RequestContextCacheService,
    Role,
    RoleService,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';
import { CJK_PLUGIN_OPTIONS, loggerCtx } from '../constants';
import type { CjkPluginOptions } from '../types';
import { TenantMember } from './tenant-member.entity';
// 仅类型导入：ShippingProfile 实体装饰器在部分测试环境无法求值，运行期按实体名取仓库
import type { ShippingProfile } from '../shipping/shipping-profile.entity';
import { OFFICIAL_ROLE_TEMPLATES } from './role-templates';
import { TenantMemberManagePermission, TenantRoleManagePermission } from './tenant-permissions';
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
export const PERMISSION_CATALOG: PermissionCatalogGroup[] = [
    {
        key: 'catalog',
        label: '商品/目录',
        items: [
            { code: Permission.ReadCatalog, label: '目录·读' },
            { code: Permission.CreateCatalog, label: '目录·增' },
            { code: Permission.UpdateCatalog, label: '目录·改' },
            { code: Permission.DeleteCatalog, label: '目录·删' },
            { code: Permission.ReadProduct, label: '商品·读' },
            { code: Permission.CreateProduct, label: '商品·增' },
            { code: Permission.UpdateProduct, label: '商品·改' },
            { code: Permission.DeleteProduct, label: '商品·删' },
        ],
    },
    {
        key: 'collection',
        label: '分类',
        items: [
            { code: Permission.ReadCollection, label: '分类·读' },
            { code: Permission.CreateCollection, label: '分类·增' },
            { code: Permission.UpdateCollection, label: '分类·改' },
            { code: Permission.DeleteCollection, label: '分类·删' },
        ],
    },
    {
        key: 'order',
        label: '订单',
        items: [
            { code: Permission.ReadOrder, label: '订单·读' },
            { code: Permission.UpdateOrder, label: '订单·改' },
            { code: Permission.CreateOrder, label: '订单·建' },
            // 到店核销（受限）：勾选即「受限核销员」，仅能在人员管理配置的配送档案白名单内核销；
            // 不勾选者（店主/超管）不受档案限制，看本租户全量
            { code: 'VerifyOrder', label: '核销·按配送档案' },
        ],
    },
    {
        key: 'asset',
        label: '图片',
        items: [
            { code: Permission.ReadAsset, label: '图片·读' },
            { code: Permission.CreateAsset, label: '图片·传' },
            { code: Permission.UpdateAsset, label: '图片·改' },
            { code: Permission.DeleteAsset, label: '图片·删' },
        ],
    },
    {
        key: 'shipping',
        label: '配送',
        items: [
            { code: Permission.ReadShippingMethod, label: '配送·读' },
            { code: Permission.CreateShippingMethod, label: '配送·增' },
            { code: Permission.UpdateShippingMethod, label: '配送·改' },
            { code: Permission.DeleteShippingMethod, label: '配送·删' },
            { code: 'ShippingProfile', label: '配送·档案' },
        ],
    },
    {
        key: 'payment',
        label: '支付',
        items: [
            { code: Permission.ReadPaymentMethod, label: '支付·读' },
            { code: Permission.CreatePaymentMethod, label: '支付·增' },
            { code: Permission.UpdatePaymentMethod, label: '支付·改' },
            { code: Permission.DeletePaymentMethod, label: '支付·删' },
        ],
    },
    {
        key: 'tenant',
        label: '租户管理',
        items: [
            { code: 'TenantRoleManage', label: '角色·管理' },
            { code: 'TenantMemberManage', label: '人员·管理' },
        ],
    },
    {
        key: 'inventory',
        label: '库存/网点',
        items: [
            { code: Permission.CreateStockLocation, label: '网点·增' },
            { code: Permission.UpdateStockLocation, label: '网点·改' },
            { code: Permission.DeleteStockLocation, label: '网点·删' },
        ],
    },
    {
        key: 'pickup',
        label: '自提点',
        items: [
            { code: 'PickupLocationRead', label: '自提点·读' },
            { code: 'PickupLocationCreate', label: '自提点·增' },
            { code: 'PickupLocationUpdate', label: '自提点·改' },
            { code: 'PickupLocationDelete', label: '自提点·删' },
        ],
    },
    {
        key: 'dashboard',
        label: '数据看板',
        items: [
            { code: 'ViewDashboard', label: '数据看板·查看' },
        ],
    },
    {
        key: 'pos',
        label: '收银/POS',
        items: [
            { code: 'ManageOwnShop', label: 'POS 收银·操作' },
        ],
    },
    {
        key: 'campus',
        label: '拾光达配送',
        items: [
            { code: 'CampusConfig', label: '拾光达·履约配置' },
            { code: 'CampusMerchant', label: '拾光达·商家接单' },
            { code: 'CampusViewDispatch', label: '拾光达·调度中心' },
            { code: 'CampusAuditRider', label: '拾光达·骑手审核' },
        ],
    },
    {
        // t3 代买单工作台（bill-pay-plugin 自定义权限 BillPayManage）
        key: 'billpay',
        label: '代买单',
        items: [
            { code: 'BillPayManage', label: '代买单·工作台' },
        ],
    },
];

/** 租户级角色可用的业务权限白名单（由 PERMISSION_CATALOG 扁平派生，建模/校验统一使用） */
export const BUSINESS_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((g) =>
    g.items.map((i) => i.code),
);

/** 全局角色 code 前缀：超管建的全局角色统一加此前缀，用于池查询与全局/本地判定（Vendure Role 无 customFields，用前缀区分） */
export const GLOBAL_ROLE_PREFIX = 'g-';
/** 官方租户位数量：tenantNo 1..20 预留给官方自营租户（见 seedOfficialTenants） */
export const OFFICIAL_TENANT_SLOTS = 20;

/**
 * 租户编号起始位扩展点（不硬编码方案，留给部署决策）：
 * - 默认 0 = 沿用「当前最大 tenantNo + 1」，空库首个租户为 1（现有行为不变）；
 * - 若决定「官方自营先占 1..20、业务租户从 21 起」，设 TENANT_NO_START=20；
 * - 若决定「业务租户固定偏移」，填偏移上限即可。取值在调用时读取，避免构建期固化。
 */
export function tenantNoStart(): number {
    const raw = Number(process.env.TENANT_NO_START ?? 0);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}
/** 业务租户总数上限（不含官方自营租户）；创建时超限拒绝 */
export const BUSINESS_TENANT_CAPACITY = 100;
/** 全局角色 code 规范化：输入 code 自动统一为 `g-{code}`，避免手动误输入前缀产生重复 */
export function normalizeGlobalRoleCode(code: string): string {
    const c = code.trim();
    return c.startsWith(GLOBAL_ROLE_PREFIX) ? c : GLOBAL_ROLE_PREFIX + c;
}

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
export function randomStrongPassword(length = 12): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*_-+';
    const all = upper + lower + digits + symbols;
    const rand = (n: number) => Math.floor(Math.random() * n);
    const parts = [
        upper[rand(upper.length)],
        lower[rand(lower.length)],
        digits[rand(digits.length)],
        symbols[rand(symbols.length)],
    ];
    for (let i = parts.length; i < length; i++) parts.push(all[rand(all.length)]);
    for (let i = parts.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    return parts.join('');
}

/** 一次性重置口令的有效期：24 小时。超期后必须由管理员重新重置，口令不可再用 */
export const RESET_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

/** 可授判定：目标角色权限 ⊆ 操作者权限，且不含租户管理类权限（防链式提权）。
 *  Authenticated 为所有角色基础权限，不计入比较。 */
export function canGrantRole(operatorPerms: Set<string>, rolePermissions: string[]): boolean {
    const perms = rolePermissions.filter((p) => p !== 'Authenticated');
    return (
        perms.every((p) => operatorPerms.has(p)) &&
        !perms.some((p) => p === TenantMemberManagePermission || p === TenantRoleManagePermission)
    );
}

/** 角色去重：按展示名（description || code）合并，同名时本地角色（code 非 g- 前缀）优先于全局角色 */
export function dedupeRolesByLabel(roles: any[]): any[] {
    const seen = new Map<string, any>();
    for (const r of roles) {
        // 展示名：description 非空用之；为空退回 code（去掉 g-/t{no}- 常规前缀后再比较，
        // 使 t1-sales 与 g-sales 视为同名业务角色，避免因前缀不同而漏去重）
        const key = String(r.description || r.code).replace(/^(g-|t\d+-)/, '');
        const cur = seen.get(key);
        if (!cur) {
            seen.set(key, r);
            continue;
        }
        const curGlobal = String(cur.code).startsWith(GLOBAL_ROLE_PREFIX);
        const rGlobal = String(r.code).startsWith(GLOBAL_ROLE_PREFIX);
        if (curGlobal && !rGlobal) seen.set(key, r);
    }
    return [...seen.values()];
}

@Injectable()
export class TenantMemberService {
    constructor(
        private connection: TransactionalConnection,
        private administratorService: AdministratorService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private authService: AuthService,
        private requestContextCache: RequestContextCacheService,
        private virtualPhysicalStockService: VirtualPhysicalStockService,
        private channelProvisioningService: ChannelProvisioningService,
        @Optional() @Inject(CJK_PLUGIN_OPTIONS) private pluginOptions?: CjkPluginOptions,
    ) {}

    /** 校验角色权限全部在业务权限白名单内（超管专属权限不入租户角色）。Authenticated 为基础权限不计入 */
    assertBusinessPermissions(permissions: string[]): void {
        const invalid = permissions.filter((p) => p !== 'Authenticated' && !BUSINESS_PERMISSIONS.includes(p));
        if (invalid.length > 0) {
            throw new Error(`FORBIDDEN_PERMISSION: ${invalid.join(',')} 为超管专属权限`);
        }
    }

    /** 校验请求方是该 channel 的租户管理员（或超管） */
    assertChannelMember(ctx: RequestContext, channelId?: ID): void {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        const target = channelId != null ? String(channelId) : String(ctx.channelId);
        const perms = (ctx as any).session?.user?.channelPermissions || [];
        const ok = perms.some((c: any) => String(c.id) === target);
        if (!ok) throw new Error('CHANNEL_FORBIDDEN');
    }

    /** 安全加固：校验目标角色必须属于指定 channel，防止跨租户改/删任意角色（横向越权） */
    async assertRoleInChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void> {
        const roleRepo = this.connection.getRepository(ctx, Role);
        const role = await roleRepo.findOne({ where: { id: roleId } as any, relations: ['channels'] });
        if (!role) throw new Error('ROLE_NOT_FOUND');
        const belongs = (role.channels || []).some((c) => String((c as any).id) === String(channelId));
        if (!belongs) throw new Error('CHANNEL_FORBIDDEN');
    }

    /** 安全加固：校验待绑定角色全部属于指定 channel，防止租户管理员绑定别店角色提权 */
    async assertRolesInChannel(ctx: RequestContext, roleIds: ID[], channelId: ID): Promise<void> {
        for (const roleId of roleIds) {
            await this.assertRoleInChannel(ctx, roleId, channelId);
        }
    }

    /** 当前登录者在本租户（ctx.channelId）的业务权限并集。
     *  Vendure 缓存 session 用户用 channelPermissions（UserChannelPermissions[] = { id, token, code, permissions }）。 */
    private channelOperatorPerms(ctx: RequestContext): Set<string> {
        const channels: any[] = (ctx as any).session?.user?.channelPermissions || [];
        const cur = channels.find((c: any) => String(c.id) === String(ctx.channelId));
        const perms: string[] = cur?.permissions || [];
        return new Set(perms.filter((p) => p !== 'Authenticated' && p !== Permission.SuperAdmin));
    }

    /** 权限门禁（权威）：非超管授予的角色必须 canGrantRole 通过，否则抛错。调用点须已过 assertRolesInChannel。 */
    async assertCanGrant(ctx: RequestContext, roleIds: ID[]): Promise<void> {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        if (!roleIds || roleIds.length === 0) return;
        const operatorPerms = this.channelOperatorPerms(ctx);
        const roleRepo = this.connection.getRepository(ctx, Role);
        for (const roleId of roleIds) {
            const role = await roleRepo.findOne({ where: { id: String(roleId) } } as any);
            if (!role) throw new Error('ROLE_NOT_FOUND');
            if (!canGrantRole(operatorPerms, (role.permissions || []) as string[])) {
                throw new Error('PERMISSION_EXCEEDS_OPERATOR');
            }
        }
    }

    /**
     * Vendure 要求 Channel.defaultLanguageCode 必须在 GlobalSettings.availableLanguages 中，
     * 否则 channelService.create 返回 LanguageNotAvailableError（无 id），渠道也不会落库。
     * 新建租户时按需把语言补进全局启用列表，避免租户创建依赖部署侧的 languages 配置。
     */
    private async ensureLanguageEnabled(ctx: RequestContext, languageCode: string): Promise<void> {
        const repo = this.connection.getRepository(ctx, GlobalSettings);
        const [settings] = await repo.find({ take: 1, order: { createdAt: 'ASC' } as any });
        if (!settings) return;
        const enabled = (settings.availableLanguages ?? []) as string[];
        if (enabled.includes(languageCode)) return;
        settings.availableLanguages = [...enabled, languageCode] as any;
        await repo.save(settings);
        // 同一请求内 channelService.create 的语言校验读的是 GlobalSettingsService 的请求级缓存，同步为最新值
        this.requestContextCache.set(ctx, 'GlobalSettings', settings);
        Logger.info(`已自动启用语言 ${languageCode}（原启用：${enabled.join(',') || '无'}）`, loggerCtx);
    }

    /** 新建租户：自动分配 tenantNo（当前最大+1），code 由 tenantNo 派生 `t{tenantNo}`，避免手输冲突 */
    async createChannel(
        ctx: RequestContext,
        input: {
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
        },
    ): Promise<any> {
        // 业务租户容量：官方位 1-20（isOfficial=true）不计入；超限直接拒绝，避免无限扩张
        const businessCount = await this.countBusinessTenants(ctx);
        if (businessCount >= BUSINESS_TENANT_CAPACITY) {
            throw new Error(
                `TENANT_CAPACITY_EXCEEDED: 业务租户数量已达上限 ${BUSINESS_TENANT_CAPACITY}，无法继续创建`,
            );
        }
        const tenantNo = await this.nextTenantNo(ctx);
        const code = `t${tenantNo}`;
        const defaultDomain = this.pluginOptions?.tenant?.defaultPublicDomain;
        const defaultLanguageCode = (input.defaultLanguageCode ?? 'zh_Hans') as any;
        await this.ensureLanguageEnabled(ctx, defaultLanguageCode);
        // B-01：新渠道默认继承默认渠道的税区/配送区。ChannelService.create 不会自动继承，
        // 缺税区会让 hydratePriceFields 报「tax zone 无法确定」，缺配送区会让运费/资格判定异常。
        const inheritedZones = await this.channelProvisioningService.getDefaultChannelZones(ctx);
        const channel = await this.channelService.create(ctx, {
            code,
            token: input.token,
            defaultLanguageCode,
            currencyCode: (input.currencyCode ?? 'CNY') as any,
            pricesIncludeTax: true,
            ...(inheritedZones.defaultTaxZoneId
                ? { defaultTaxZoneId: inheritedZones.defaultTaxZoneId }
                : {}),
            ...(inheritedZones.defaultShippingZoneId
                ? { defaultShippingZoneId: inheritedZones.defaultShippingZoneId }
                : {}),
            customFields: {
                ...(input.extraCustomFields ?? {}),
                ...(input.customDomains?.length ? { customDomains: input.customDomains } : {}),
                tenantNo,
                isOfficial: input.isOfficial ?? false,
                enabled: true,
                shopName: input.name,
                // 默认对外访问地址：主域 + 路径后缀（如 www.youshop.cn/t1），不占用子域
                ...(defaultDomain ? { domain: `${defaultDomain}/${code}` } : {}),
                ...(input.domain ? { domain: input.domain } : {}),
            },
        } as any);
        // createChannel 的返回是 ErrorResultUnion：LanguageNotAvailableError 等错误对象没有 id，
        // 直接返回会被 GraphQL 非空 Channel 序列化成 "Cannot return null for non-nullable field Channel.id"
        if ((channel as any)?.errorCode) {
            throw new Error(
                `TENANT_CHANNEL_CREATE_FAILED: ${(channel as any).message ?? (channel as any).errorCode}`,
            );
        }
        // 自动创建 3 个默认角色（租户管理员/销售/库存），保证人员可即时绑定角色
        const channelId = String((channel as any).id);
        // 新渠道必须挂上 __customer_role__：否则该渠道的登录会员拿不到 Authenticated 权限，
        // C 端所有 @Allow(Permission.Authenticated) 的查询（me/orderSummary/myOrders 等）都会 403
        try {
            const customerRole = await this.connection
                .getRepository(ctx, Role)
                .findOne({ where: { code: '__customer_role__' } });
            if (customerRole) {
                await this.roleService.assignRoleToChannel(ctx, customerRole.id, channelId);
            }
        } catch (e: any) {
            Logger.warn(`租户 ${code} 绑定客户角色失败: ${e.message}`, loggerCtx);
        }
        try {
            await Promise.all(
                OFFICIAL_ROLE_TEMPLATES.map((tpl) =>
                    this.createTenantRole(ctx, channelId, {
                        code: `t${tenantNo}-${tpl.busiPrefix}`,
                        description: tpl.description,
                        permissions: tpl.permissions,
                    }),
                ),
            );
        } catch (e: any) {
            Logger.warn(`租户 ${code} 默认角色创建失败（可手动补建）: ${e.message}`, loggerCtx);
        }
        // B-01/B-02：补齐配送方式 / 支付方式 / 租户默认配送档案，避免新租户「配置全要二次手工补」
        // 导致 price null → 无法下单 → 订单卡 `not all lines have shipping`。
        try {
            await this.channelProvisioningService.provision(ctx, channel as any);
        } catch (e: any) {
            Logger.warn(`租户 ${code} 兜底配置失败（可手动补配）: ${e.message}`, loggerCtx);
        }
        this.syncChannelToSso(code, input.name);
        Logger.info(`已创建租户 ${code}（tenantNo=${tenantNo}）`, loggerCtx);
        return channel;
    }

    /** 渠道创建成功后同步到 SSO 渠道表 sso_channels（fire-and-forget，失败仅告警不阻塞租户创建）。
     *  保证渠道报表/点击追踪不因渠道缺失而丢数据。需配置 SSO_CHANNEL_SYNC_URL 与
     *  SSO_CHANNEL_SYNC_TOKEN 环境变量（shared secret），未配置则跳过。 */
    private syncChannelToSso(code: string, name: string): void {
        const url = process.env.SSO_CHANNEL_SYNC_URL;
        const token = process.env.SSO_CHANNEL_SYNC_TOKEN;
        if (!url || !token) {
            Logger.warn(`租户 ${code} 未配置 SSO_CHANNEL_SYNC_URL/SSO_CHANNEL_SYNC_TOKEN，跳过渠道同步`, loggerCtx);
            return;
        }
        void (async () => {
            try {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-sso-sync-token': token },
                    body: JSON.stringify({ channel_code: code, channel_name: name, channel_type: 'vendure' }),
                });
                if (!resp.ok) {
                    const text = await resp.text().catch(() => '');
                    Logger.warn(`租户 ${code} 同步到 SSO 渠道表失败: HTTP ${resp.status} ${text}`, loggerCtx);
                } else {
                    Logger.info(`租户 ${code} 已同步到 SSO 渠道表`, loggerCtx);
                }
            } catch (e: any) {
                Logger.warn(`租户 ${code} 同步到 SSO 渠道表异常: ${e.message}`, loggerCtx);
            }
        })();
    }

    /** 统计业务租户数（不含官方自营）：isOfficial !== true 且 tenantNo 在官方位之后。
     *  与 nextTenantNo 一样用 repo.find() 绕开 channelService.findAll 的 take≤1000 限制。 */
    private async countBusinessTenants(ctx: RequestContext): Promise<number> {
        const channels = (await this.connection.getRepository(ctx, Channel).find()) as any[];
        return channels.filter((c) => {
            const no = Number(c?.customFields?.tenantNo);
            if (!Number.isFinite(no) || no <= OFFICIAL_TENANT_SLOTS) return false;
            return c?.customFields?.isOfficial !== true;
        }).length;
    }

    /** 取「当前最大 tenantNo」与「可配置起始位」的较大者，自增 1；无数据时默认第 1 个租户得到 1。
     *  用 TypeORM 原生 read 绕开 channelService.findAll 的 take≤1000 限制（否则新建租户必报「查询结果大于1000」）。 */
    private async nextTenantNo(ctx: RequestContext): Promise<number> {
        const repo = this.connection.getRepository(ctx, Channel);
        const channels = await repo.find();
        const nos = (channels as any[])
            .map((c: any) => Number(c?.customFields?.tenantNo))
            .filter((n: number) => Number.isFinite(n));
        const currentMax = nos.length ? Math.max(...nos) : 0;
        return Math.max(currentMax, tenantNoStart()) + 1;
    }

    /**
     * 租户启停（仅超管）；停用时同步释放该渠道的门店认领并重算商户认领状态。
     * 产品语义：停用可逆 —— 自提点与渠道的 channels 关联刻意保留，重新启用后原关联继续可用；
     * 如需解除关联请走 pickup 管理接口（removePickupLocationsFromChannel 等）。
     */
    async setChannelEnabled(ctx: RequestContext, channelId: ID, enabled: boolean): Promise<void> {
        await this.channelService.update(ctx, {
            id: channelId,
            customFields: { enabled },
        } as any);
        if (!enabled) {
            await this.revokeChannelClaims(channelId);
        }
    }

    /**
     * 租户停用后释放其门店认领：merchant_store_channel → REVOKED，并重算受影响商户的 claimStatus。
     * 用原生 SQL 避免 cjk-plugin 反向依赖 merchant-plugin；相关表不存在时（未装载 merchant-plugin）直接跳过。
     */
    private async revokeChannelClaims(channelId: ID): Promise<void> {
        const qr = this.connection.rawConnection.createQueryRunner();
        const isPostgres = (this.connection.rawConnection.options as any).type === 'postgres';
        const ph = (n: number) => (isPostgres ? `$${n}` : '?');
        try {
            if (!(await qr.hasTable('merchant_store_channel'))) {
                return;
            }
            const rows = await qr.query(
                `SELECT DISTINCT s."merchantId" AS merchant_id
                 FROM merchant_store_channel c
                 JOIN merchant_store s ON s.id = c."storeId"
                 WHERE c."channelId" = ${ph(1)}`,
                [Number(channelId)],
            );
            await qr.query(
                `UPDATE merchant_store_channel
                 SET status = 'REVOKED', "updatedAt" = now()
                 WHERE "channelId" = ${ph(1)} AND status = 'ACTIVE'`,
                [Number(channelId)],
            );
            if (!(await qr.hasTable('merchant'))) {
                return;
            }
            for (const row of Array.isArray(rows) ? rows : []) {
                const merchantId = Number(row?.merchant_id);
                if (!Number.isFinite(merchantId)) continue;
                await qr.query(
                    `UPDATE merchant
                     SET "claimStatus" = CASE WHEN EXISTS (
                            SELECT 1 FROM merchant_store_channel c
                            JOIN merchant_store s ON s.id = c."storeId"
                            WHERE s."merchantId" = ${ph(1)} AND s."deletedAt" IS NULL AND c.status = 'ACTIVE'
                         ) THEN 'CLAIMED' ELSE 'UNCLAIMED' END,
                         "updatedAt" = now()
                     WHERE id = ${ph(1)}`,
                    [merchantId],
                );
            }
            Logger.info(`租户 ${channelId} 停用：门店认领已释放`, loggerCtx);
        } catch (e: any) {
            Logger.warn(`租户 ${channelId} 停用释放认领失败：${String(e?.message ?? e)}`, loggerCtx);
        } finally {
            await qr.release();
        }
    }

    /** 更新租户基础信息（仅超管）：name → shopName；domain → 默认外网域名。合并既有 customFields，仅覆盖传入字段。 */
    async updateChannel(
        ctx: RequestContext,
        channelId: ID,
        input: { name?: string; tenantNo?: number; isOfficial?: boolean; domain?: string; industryType?: string; storefrontMode?: string; storefrontHomeLayout?: string; couponFloorGroups?: string; firstBuyDiscount?: number; couponCampaign?: string; billpayMaxSalePrice?: number; billpayMaxFaceValue?: number; billpayMaxBundleTotal?: number; billpayMinValidDays?: number; billpayExpireRefundPolicy?: string },
    ): Promise<void> {
        const repo = this.connection.getRepository(ctx, Channel);
        const existing = await repo.findOne({ where: { id: String(channelId) } } as any);
        const cf = new Map(Object.entries(((existing as any)?.customFields || {})));
        if (input.tenantNo !== undefined) cf.set('tenantNo', input.tenantNo);
        if (input.isOfficial !== undefined) cf.set('isOfficial', input.isOfficial);
        if (input.name !== undefined && input.name !== null) cf.set('shopName', input.name);
        if (input.domain !== undefined && input.domain !== null) cf.set('domain', input.domain);
        if (input.industryType !== undefined && input.industryType !== null) cf.set('industryType', input.industryType);
        if (input.storefrontMode !== undefined && input.storefrontMode !== null) cf.set('storefrontMode', input.storefrontMode);
        if (input.storefrontHomeLayout !== undefined && input.storefrontHomeLayout !== null) cf.set('storefrontHomeLayout', input.storefrontHomeLayout);
        if (input.couponFloorGroups !== undefined) cf.set('couponFloorGroups', input.couponFloorGroups);
        if (input.firstBuyDiscount !== undefined) cf.set('firstBuyDiscount', input.firstBuyDiscount);
        if (input.couponCampaign !== undefined) cf.set('couponCampaign', input.couponCampaign);
        // 买单券监管参数组（T4）：0/null 清除限制（宽松默认），>0 配置后生效
        if (input.billpayMaxSalePrice !== undefined) cf.set('billpayMaxSalePrice', input.billpayMaxSalePrice || null);
        if (input.billpayMaxFaceValue !== undefined) cf.set('billpayMaxFaceValue', input.billpayMaxFaceValue || null);
        if (input.billpayMaxBundleTotal !== undefined) cf.set('billpayMaxBundleTotal', input.billpayMaxBundleTotal || null);
        if (input.billpayMinValidDays !== undefined) cf.set('billpayMinValidDays', input.billpayMinValidDays || null);
        if (input.billpayExpireRefundPolicy !== undefined) cf.set('billpayExpireRefundPolicy', input.billpayExpireRefundPolicy || null);
        await this.channelService.update(ctx, {
            id: channelId,
            customFields: Object.fromEntries(cf),
        } as any);
    }

    /** 租户级角色创建（限定 channelIds=[channelId]；权限白名单校验） */
    async createTenantRole(ctx: RequestContext, channelId: ID, input: { code: string; description: string; permissions: string[] }): Promise<any> {
        this.assertBusinessPermissions(input.permissions);
        return this.roleService.create(ctx, {
            code: input.code,
            description: input.description,
            permissions: input.permissions as Permission[],
            channelIds: [channelId],
        });
    }

    /** 判断指定 channel 是否已存在该 code 的关联角色（幂等判定）。 */
    private async roleExistsInChannel(ctx: RequestContext, channelId: string, code: string): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, Role);
        const rows = await repo
            .createQueryBuilder('role')
            .leftJoinAndSelect('role.channels', 'ch')
            .where('role.code = :code', { code })
            .getMany();
        return (rows as any[]).some((r) => (r.channels || []).some((c: any) => String(c.id) === channelId));
    }

    /** 按 channelId 直查该租户全部角色：同名去重（本地优先全局），并按操作者权限标注 grantable（超管全 true）。 */
    async rolesForChannel(ctx: RequestContext, channelId: ID): Promise<any[]> {
        const repo = this.connection.getRepository(ctx, Role);
        const all = await repo.find({ relations: ['channels'] });
        const chId = String(channelId);
        const roles = (all as any[]).filter((r) => (r.channels || []).some((c: any) => String(c.id) === chId));
        const deduped = dedupeRolesByLabel(roles);
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return deduped.map((r) => ({ ...r, grantable: true }));
        }
        const operatorPerms = this.channelOperatorPerms(ctx);
        return deduped.map((r) => ({
            ...r,
            grantable: canGrantRole(operatorPerms, (r.permissions || []) as string[]),
        }));
    }

    /** 系统直建租户级角色（绕过 roleService.create 的权限校验，仅用于启动补种子/一键导入这类系统操作）。
     *  幂等：仅当该 code 在本 channel 不存在时才创建。 */
    private async createTenantRoleDirect(
        ctx: RequestContext,
        channelId: ID,
        input: { code: string; description: string; permissions: string[] },
    ): Promise<any> {
        this.assertBusinessPermissions(input.permissions);
        const chId = String(channelId);
        if (await this.roleExistsInChannel(ctx, chId, input.code)) return null;
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: chId } } as any);
        if (!channel) throw new Error('CHANNEL_NOT_FOUND');
        const roleRepo = this.connection.getRepository(ctx, Role);
        const role = new Role({
            code: input.code,
            description: input.description,
            permissions: [`Authenticated`, ...input.permissions] as any,
        });
        role.channels = [channel];
        await roleRepo.save(role);
        return role;
    }

    /** 建全局角色并批量分发到店：code 自动加 `g-` 前缀；channelIds 为空 → channels=[]（全局可用），非空 → channels=[勾选店]（全局默认）。
     *  统一幂等：code 已存在则仅追加缺失店，绝不重复关联同一店。所有加店路径（创建时勾选/分发/引用）均应收敛到此核心语义。 */
    async createGlobalRoleWithChannels(
        ctx: RequestContext,
        channelIds: ID[],
        input: { code: string; description: string; permissions: string[] },
    ): Promise<any[]> {
        this.assertBusinessPermissions(input.permissions);
        const code = normalizeGlobalRoleCode(input.code);
        const targetChannels: Channel[] = [];
        for (const id of channelIds || []) {
            const ch = await this.connection
                .getRepository(ctx, Channel)
                .findOne({ where: { id: String(id) } } as any);
            if (ch) targetChannels.push(ch);
        }
        const roleRepo = this.connection.getRepository(ctx, Role);
        const existing = await roleRepo.findOne({
            where: { code } as any,
            relations: ['channels'],
        });
        if (existing) {
            // 已存在：仅追加缺少的分发店（幂等）
            const curIds = (existing.channels || []).map((c: any) => String(c.id));
            existing.channels = [...(existing.channels || [])];
            for (const ch of targetChannels) {
                if (!curIds.includes(String(ch.id))) existing.channels.push(ch);
            }
            await roleRepo.save(existing);
            return [existing];
        }
        const role = new Role({
            code,
            description: input.description,
            permissions: [`Authenticated`, ...input.permissions] as any,
        });
        role.channels = targetChannels;
        await roleRepo.save(role);
        return [role];
    }

    /** 直建全局可用角色（channels=[]）。空 channelIds 走 createGlobalRoleWithChannels；保持幂等语义。 */
    async createGlobalRoleDirect(
        ctx: RequestContext,
        input: { code: string; description: string; permissions: string[] },
    ): Promise<any> {
        const [role] = await this.createGlobalRoleWithChannels(ctx, [], input);
        return role;
    }

    /** 把全局角色引用到某店（幂等：已含该店则 no-op；仅 g- 前缀全局角色允许被引用，租户本地角色不可引）。
     *  超管从池继续分发也已含本方法，故去掉原「channels 必须为空」限制，允许多店分发。 */
    async referGlobalRoleToChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void> {
        const roleRepo = this.connection.getRepository(ctx, Role);
        const role = await roleRepo.findOne({
            where: { id: String(roleId) },
            relations: ['channels'],
        } as any);
        if (!role) throw new Error('ROLE_NOT_FOUND');
        if (!String(role.code).startsWith(GLOBAL_ROLE_PREFIX)) throw new Error('NOT_GLOBAL_ROLE');
        const chId = String(channelId);
        const curIds = (role.channels || []).map((c: any) => String(c.id));
        if (!curIds.includes(chId)) {
            const ch = await this.connection
                .getRepository(ctx, Channel)
                .findOne({ where: { id: chId } } as any);
            if (!ch) throw new Error('CHANNEL_NOT_FOUND');
            role.channels = [...(role.channels || []), ch];
            await roleRepo.save(role);
        }
    }

    /** 取消某店对该全局角色的引用（移除该店；channels 变空则回到全局池）。 */
    async unreferGlobalRoleFromChannel(ctx: RequestContext, roleId: ID, channelId: ID): Promise<void> {
        const roleRepo = this.connection.getRepository(ctx, Role);
        const role = await roleRepo.findOne({
            where: { id: String(roleId) },
            relations: ['channels'],
        } as any);
        if (!role) throw new Error('ROLE_NOT_FOUND');
        const chId = String(channelId);
        role.channels = (role.channels || []).filter((c: any) => String(c.id) !== chId);
        await roleRepo.save(role);
    }

    /** 租户自助：引用全局角色到当前 ctx.channelId。仅允许引用「未绑定任何店」的 g- 角色（channels=[]），
     *  防止租户引用已被他店绑定（channels 非空）的角色造成跨店共享越权。 */
    async myReferGlobalRole(ctx: RequestContext, roleId: ID): Promise<void> {
        const roleRepo = this.connection.getRepository(ctx, Role);
        const role = await roleRepo.findOne({
            where: { id: String(roleId) },
            relations: ['channels'],
        } as any);
        if (!role) throw new Error('ROLE_NOT_FOUND');
        if (!String(role.code).startsWith(GLOBAL_ROLE_PREFIX)) throw new Error('NOT_GLOBAL_ROLE');
        if ((role.channels || []).length > 0) throw new Error('ROLE_ALREADY_REFERENCED');
        await this.referGlobalRoleToChannel(ctx, roleId, ctx.channelId);
    }

    /** 租户自助可引用列表：仅返回「未绑定任何店」的 g- 角色（channels=[]，可引用）。 */
    async globalRolesAvailable(ctx: RequestContext): Promise<any[]> {
        const repo = this.connection.getRepository(ctx, Role);
        const all = await repo.find({ relations: ['channels'] });
        return (all as any[]).filter(
            (r) => String(r.code).startsWith(GLOBAL_ROLE_PREFIX) && !(r.channels || []).length,
        );
    }

    /** 租户自助：从当前 ctx.channelId 取消引用。 */
    async myUnreferGlobalRole(ctx: RequestContext, roleId: ID): Promise<void> {
        await this.unreferGlobalRoleFromChannel(ctx, roleId, ctx.channelId);
    }

    /** 查全部全局角色（code 以 g- 开头；channels 可为空=全局可用，非空=已分发到店）。 */
    async globalRoles(ctx: RequestContext): Promise<any[]> {
        const repo = this.connection.getRepository(ctx, Role);
        const all = await repo.find({ relations: ['channels'] });
        return (all as any[]).filter((r) => String(r.code).startsWith(GLOBAL_ROLE_PREFIX));
    }

    /** 全局默认角色模板（不落库为 Role）：租户"导入到本店"时复制独立副本，各租户权限互不影响 */
    async globalRoleTemplates(ctx: RequestContext): Promise<any[]> {
        return OFFICIAL_ROLE_TEMPLATES.map((tpl) => ({
            key: tpl.key,
            busiPrefix: tpl.busiPrefix,
            description: tpl.description,
            permissions: tpl.permissions,
        }));
    }

    /** 单租户按模板补齐缺失的默认角色（幂等）。逐个 code 判存，模板新增角色时存量租户也能补齐。 */
    async importDefaultRoles(ctx: RequestContext, channelId: ID): Promise<any[]> {
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: String(channelId) } } as any);
        if (!channel) throw new Error('CHANNEL_NOT_FOUND');
        const tenantNo = Number((channel as any).customFields?.tenantNo);
        // 空值/0 视为未分配租户号：Number(null) === 0、Number('') === 0，会被误当成 t0 而写出重复角色
        if (!Number.isFinite(tenantNo) || tenantNo <= 0) throw new Error('TENANT_NO_MISSING');
        const created: any[] = [];
        for (const tpl of OFFICIAL_ROLE_TEMPLATES) {
            // 单个模板失败（如模板含已被收紧为超管专属的权限）不应阻塞其余模板补齐
            try {
                const role = await this.createTenantRoleDirect(ctx, channelId, {
                    code: `t${tenantNo}-${tpl.busiPrefix}`,
                    description: tpl.description,
                    permissions: tpl.permissions,
                });
                if (role) created.push(role);
            } catch (e: any) {
                Logger.warn(`租户 ${channelId} 角色模板 ${tpl.key} 补齐失败: ${e.message}`, loggerCtx);
            }
        }
        return created;
    }

    /** 租户自助：从全局默认模板复制独立副本到当前 ctx.channelId（幂等，复用 importDefaultRoles） */
    async myImportDefaultRoles(ctx: RequestContext): Promise<any[]> {
        return this.importDefaultRoles(ctx, ctx.channelId);
    }

    /** 启动补种子：扫描所有 Channel，缺默认角色则幂等补建；异常仅打日志不阻塞启动。 */
    async ensureDefaultRolesForAllChannels(ctx: RequestContext): Promise<void> {
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const channels = await channelRepo.find();
        let added = 0;
        for (const c of channels as any[]) {
            const tenantNo = Number(c?.customFields?.tenantNo);
            if (!Number.isFinite(tenantNo)) continue;
            const chId = String(c.id);
            try {
                added += (await this.importDefaultRoles(ctx, chId)).length;
                await this.ensurePOSRolesForChannel(ctx, chId, tenantNo);
            } catch (e: any) {
                Logger.warn(`租户 ${chId} 默认角色补种失败: ${e.message}`, loggerCtx);
            }
        }
        Logger.info(`默认角色补种完成，共补建 ${added} 个角色`, loggerCtx);
    }

    /** 收银/POS 启动补种（幂等）：① 确保已存在租户「收银员」角色；② 补齐租户管理员角色的 ManageOwnShop（可收银 + 可授收银员）。 */
    private async ensurePOSRolesForChannel(ctx: RequestContext, channelId: ID, tenantNo: number): Promise<void> {
        const chId = String(channelId);
        const roleRepo = this.connection.getRepository(ctx, Role);
        // ① 租户管理员补 POS 收银权限（使管理员可用收银功能，且可向下授权收银员）
        const adminRole = await roleRepo
            .createQueryBuilder('role')
            .leftJoinAndSelect('role.channels', 'ch')
            .where('role.code = :code', { code: `t${tenantNo}-tenant-admin` })
            .andWhere('ch.id = :chId', { chId })
            .getOne();
        if (adminRole && !(adminRole.permissions as any[]).includes('ManageOwnShop')) {
            adminRole.permissions = [...(adminRole.permissions || []), 'ManageOwnShop'] as any;
            await roleRepo.save(adminRole);
        }
        // ② 补建「收银员」角色（createTenantRoleDirect 幂等；权限在白名单内由 assertBusinessPermissions 把关）
        const tpl = OFFICIAL_ROLE_TEMPLATES.find((t) => t.key === 'cashier');
        if (tpl) {
            await this.createTenantRoleDirect(ctx, channelId, {
                code: `t${tenantNo}-cashier`,
                description: tpl.description,
                permissions: tpl.permissions,
            });
        }
    }

    /** 把指定渠道关联到超管角色（幂等）——超管全局豁免渠道校验的核心：superadmin 角色须覆盖所有渠道，
     *  否则超管切到未绑定角色渠道时 Vendure 权限守卫无任何权限，无法在租户内发商品/提审等操作。 */
    async ensureSuperAdminRoleCoversChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        await this.ensureSuperAdminRoleCoversChannels(ctx, [String(channelId)]);
    }

    /** 把所有存量渠道补关联到超管角色（幂等；失败仅打日志不阻塞启动） */
    async ensureSuperAdminRoleCoversAllChannels(ctx: RequestContext): Promise<void> {
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const channels = await channelRepo.find();
        await this.ensureSuperAdminRoleCoversChannels(ctx, channels.map((c) => String(c.id)));
    }

    /** 把指定渠道列表关联到超管角色（幂等：已含则 no-op）。superadmin 角色自带 SuperAdmin 权限，
     *  一旦覆盖某渠道，userHasPermissions(Permission.SuperAdmin) 在该渠道即返回 true，实现超管全局豁免。 */
    private async ensureSuperAdminRoleCoversChannels(ctx: RequestContext, channelIds: string[]): Promise<void> {
        const roleRepo = this.connection.getRepository(ctx, Role);
        const superAdminRole = await roleRepo
            .createQueryBuilder('role')
            .leftJoinAndSelect('role.channels', 'ch')
            .where('role.code = :code', { code: '__super_admin_role__' })
            .getOne();
        if (!superAdminRole) {
            Logger.warn('超管角色 __super_admin_role__ 不存在，跳过渠道覆盖', loggerCtx);
            return;
        }
        let changed = false;
        const curIds = (superAdminRole.channels || []).map((c: any) => String(c.id));
        for (const chId of channelIds) {
            if (curIds.includes(String(chId))) continue;
            const ch = await this.connection.getRepository(ctx, Channel).findOne({ where: { id: String(chId) } as any });
            if (ch) {
                superAdminRole.channels = [...(superAdminRole.channels || []), ch as any];
                changed = true;
            }
        }
        if (changed) {
            await roleRepo.save(superAdminRole);
            Logger.info(`超管角色渠道覆盖完成：新增渠道 ${channelIds.filter((id) => !curIds.includes(String(id))).join(', ')}`, loggerCtx);
        }
    }

    /** 租户级角色更新（权限白名单校验；channelId 非空时校验角色归属，防横向越权） */
    async updateTenantRole(
        ctx: RequestContext,
        roleId: ID,
        input: { code?: string; description?: string; permissions?: string[] },
        channelId?: ID,
    ): Promise<any> {
        if (channelId != null) await this.assertRoleInChannel(ctx, roleId, channelId);
        if (input.permissions) this.assertBusinessPermissions(input.permissions);
        return this.roleService.update(ctx, {
            id: roleId,
            code: input.code,
            description: input.description,
            permissions: input.permissions as Permission[],
        });
    }

    /** 租户级角色删除（channelId 非空时校验角色归属，防横向越权） */
    async deleteTenantRole(ctx: RequestContext, roleId: ID, channelId?: ID): Promise<void> {
        if (channelId != null) await this.assertRoleInChannel(ctx, roleId, channelId);
        await this.roleService.delete(ctx, roleId);
    }

    /** 更换某人员在该租户内的角色：归属 + 白名单 + 横向越权三重校验 */
    async updateTenantMemberRoles(
        ctx: RequestContext,
        channelId: ID,
        memberId: ID,
        roleIds: ID[],
    ): Promise<void> {
        await this.assertChannelMember(ctx);
        if (roleIds && roleIds.length > 0) {
            await this.assertRolesInChannel(ctx, roleIds, channelId);
        }
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: String(memberId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        const memberChannelId = String(member.channelId);
        const targetChannelId = String(channelId);
        if (memberChannelId !== targetChannelId) throw new Error('MEMBER_NOT_IN_CHANNEL');
        await this.syncMemberRolesInChannel(ctx, member.administratorId as any, channelId, roleIds || []);
    }

    /**
     * 设置某人员的「可核销配送档案」白名单（受限核销员）。
     * 归属校验：成员须属于该租户；档案须存在且为全局档案或本租户档案。
     * 空白名单 = 默认拒绝（该人员将看不到/核销不了任何单据）。
     */
    async setMemberRedeemProfiles(
        ctx: RequestContext,
        channelId: ID,
        memberId: ID,
        shippingProfileIds: ID[],
    ): Promise<any> {
        await this.assertChannelMember(ctx);
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: String(memberId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        if (String(member.channelId) !== String(channelId)) throw new Error('MEMBER_NOT_IN_CHANNEL');
        const ids = Array.from(new Set((shippingProfileIds ?? []).map(String).filter(Boolean)));
        await this.assertShippingProfilesVisible(ctx, ids, channelId);
        member.shippingProfileIds = ids;
        await repo.save(member);
        return this.memberToView(ctx, member);
    }

    /** 校验档案 id 均存在且对当前租户可见（全局档案 或 本租户档案） */
    private async assertShippingProfilesVisible(
        ctx: RequestContext,
        profileIds: string[],
        channelId: ID,
    ): Promise<void> {
        if (profileIds.length === 0) return;
        const profiles = await this.connection
            .getRepository(ctx, 'ShippingProfile' as any)
            .find({ where: { id: In(profileIds.map(Number)) } as any });
        const byId = new Map<string, ShippingProfile>(
            (profiles as ShippingProfile[]).map(p => [String(p.id), p]),
        );
        for (const id of profileIds) {
            const profile = byId.get(id);
            if (!profile) throw new Error('SHIPPING_PROFILE_NOT_FOUND');
            const visible = profile.isGlobal || String(profile.ownerChannelId) === String(channelId);
            if (!visible) throw new Error('SHIPPING_PROFILE_NOT_VISIBLE');
        }
    }

    /** 以「合并」语义同步某管理员在本 channel 的角色：仅替换本租户角色，保留其在其它租户的角色（跨店任职互不影响） */
    async syncMemberRolesInChannel(
        ctx: RequestContext,
        administratorId: ID,
        channelId: ID,
        roleIds: ID[],
    ): Promise<void> {
        if (roleIds && roleIds.length > 0) {
            await this.assertRolesInChannel(ctx, roleIds, channelId);
        }
        await this.assertCanGrant(ctx, roleIds);
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const admin = await adminRepo.findOne({
            where: { id: String(administratorId) },
            relations: ['user', 'user.roles'],
        });
        if (!admin) throw new Error('ADMIN_NOT_FOUND');
        const chId = String(channelId);
        const own = ((admin.user?.roles as any[] | undefined) ?? []);
        const keep = own
            .filter((r: any) => !(r.channels || []).some((c: any) => String(c.id) === chId))
            .map((r: any) => String(r.id));
        const merged = Array.from(new Set([...keep, ...(roleIds || []).map(String)]));
        await this.administratorService.update(ctx, {
            id: String(administratorId),
            roleIds: merged,
        } as any);
    }

    /** 返回人员在当前租户内的角色 id（用于改角色弹层回显勾选） */
    async memberRoleIdsInChannel(ctx: RequestContext, member: TenantMember): Promise<ID[]> {
        if (!member?.administratorId) return [];
        const repo = this.connection.getRepository(ctx, Administrator);
        const admin = await repo.findOne({
            where: { id: member.administratorId },
            relations: ['user', 'user.roles'],
        });
        if (!admin?.user?.roles) return [];
        const channelId = String(member.channelId);
        return (admin.user.roles as any[])
            .filter((r: any) => (r.channels || []).some((c: any) => String(c.id) === channelId))
            .map((r: any) => String(r.id));
    }

    /** 将 TenantMember 组装为含 roleIds / canResetPassword / emailAddress 的视图对象 */
    async memberToView(ctx: RequestContext, member: TenantMember): Promise<any> {
        const roleIds = await this.memberRoleIdsInChannel(ctx, member);
        const view: any = {
            ...member,
            roleIds,
            shippingProfileIds: (member.shippingProfileIds ?? []).map(String),
        };
        const activeUserId = ctx.activeUserId;
        let emailAddress: string | null = null;
        let myAdmin: Administrator | null | undefined = null;
        if (activeUserId != null) {
            myAdmin = await this.administratorService
                .findOneByUserId(ctx, activeUserId)
                .catch(() => null);
            if (myAdmin && String(myAdmin.id) === String(member.administratorId)) {
                emailAddress = myAdmin.emailAddress;
            }
        }
        if (emailAddress == null) {
            const admin = await this.administratorService
                .findOne(ctx, String(member.administratorId))
                .catch(() => null);
            emailAddress = admin?.emailAddress ?? null;
        }
        view.emailAddress = emailAddress;
        if (activeUserId != null) {
            if (myAdmin && String(myAdmin.id) === String(member.administratorId)) {
                view.canResetPassword = false; // 不允许重置自己的密码
                return view;
            }
        }
        if ((ctx as any).session?.user?.superAdmin === true || ctx.userHasPermissions([Permission.SuperAdmin])) {
            view.canResetPassword = true;
        } else {
            const roleRepo = this.connection.getRepository(ctx, Role);
            const roles = roleIds.length
                ? await roleRepo.findByIds(roleIds.map(String) as any)
                : [];
            const perms = (roles as any[]).flatMap((r) => (r.permissions || []) as string[]);
            view.canResetPassword = canGrantRole(this.channelOperatorPerms(ctx), perms);
        }
        return view;
    }

    /** 超管为租户建管理员账号并绑定角色，同时写入 TenantMember */
    async createTenantAdministrator(ctx: RequestContext, channelId: ID, input: CreateTenantAdminInput): Promise<TenantMember> {
        if (input.roleIds && input.roleIds.length > 0) {
            await this.assertRolesInChannel(ctx, input.roleIds, channelId);
        }
        await this.assertCanGrant(ctx, input.roleIds);
        // 未显式提供密码 → 生成随机强口令，并默认标记首登强改密
        const generated = !input.password;
        const password = input.password ?? randomStrongPassword();
        const mustChangePassword = input.forcePasswordChange === true || generated;
        const admin = await this.administratorService.create(ctx, {
            firstName: input.firstName ?? '',
            lastName: input.lastName ?? input.emailAddress,
            emailAddress: input.emailAddress,
            password,
            roleIds: input.roleIds,
        } as any);
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = new TenantMember();
        member.administratorId = String(admin.id);
        member.channelId = String(channelId);
        member.enabled = input.enabled ?? true;
        member.mustChangePassword = mustChangePassword;
        member.displayName = input.displayName ?? input.emailAddress;
        member.remark = input.remark ?? null;
        member.phone = input.phone ?? null;
        await repo.save(member);
        if (generated) {
            // 一次性初始口令：仅本属性运行时回传展示，不落库
            (member as any).initialPassword = password;
        }
        return member;
    }

    /** 当前登录者修改自身密码：主动改密必须校验旧密码；仅首登强改密（mustChangePassword=true）允许跳过旧密码校验。更新后清除本租户首登强改密标志 */
    async changeMyPassword(ctx: RequestContext, oldPassword: string | null, newPassword: string): Promise<void> {
        if (!newPassword || newPassword.length < 8) throw new Error('WEAK_PASSWORD');
        const activeUserId = ctx.activeUserId;
        if (!activeUserId) throw new Error('NOT_AUTHENTICATED');
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const admin = await adminRepo.findOne({ where: { user: { id: String(activeUserId) } }, relations: ['user'] });
        if (!admin) throw new Error('ADMIN_NOT_FOUND');
        const adminId = String(admin.id);
        const memberRepo = this.connection.getRepository(ctx, TenantMember);
        const members = await memberRepo.find({ where: { administratorId: adminId } });
        const mustChange = members.some((m) => m.mustChangePassword);
        if (mustChange) {
            // 一次性重置口令超期后不可再用于改密，必须由管理员重新重置
            const expired = members.some(
                (m) =>
                    m.mustChangePassword &&
                    m.resetPasswordExpiresAt != null &&
                    new Date(m.resetPasswordExpiresAt).getTime() < Date.now(),
            );
            if (expired) throw new Error('RESET_PASSWORD_EXPIRED');
        }
        if (!mustChange) {
            // 主动改密：未传旧密码直接拒绝，防止已登录会话（XSS/共享电脑）绕过旧密码验证改密
            if (!oldPassword) throw new Error('OLD_PASSWORD_REQUIRED');
            const ok = await this.authService.verifyUserPassword(ctx, (admin as any).user?.id, oldPassword);
            if (ok !== true) throw new Error('WRONG_OLD_PASSWORD');
        }
        await this.administratorService.update(ctx, { id: adminId as any, password: newPassword } as any);
        for (const m of members) {
            if (m.mustChangePassword) {
                m.mustChangePassword = false;
                m.resetPasswordExpiresAt = null;
                await memberRepo.save(m);
            }
        }
    }

    /** 租户人员启停 */
    async setMemberEnabled(ctx: RequestContext, channelId: ID, memberId: ID, enabled: boolean): Promise<void> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: memberId, channelId: String(channelId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        member.enabled = enabled;
        await repo.save(member);
    }

    /** 租户人员移除（仅删 TenantMember 关联，Administrator 本体保留） */
    async removeMember(ctx: RequestContext, channelId: ID, memberId: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: memberId, channelId: String(channelId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        await repo.remove(member);
    }

    /**
     * 超管重置租户管理人密码：生成随机一次性口令，保留首登强改密并写入 24 小时有效期。
     * 明文仅经返回值（initialPassword）交给操作者，不落日志、不落库。
     */
    async resetAdminPassword(ctx: RequestContext, memberId: ID): Promise<TenantMember> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: String(memberId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        const password = randomStrongPassword();
        await this.administratorService.update(ctx, {
            id: String(member.administratorId) as any,
            password,
        } as any);
        member.mustChangePassword = true;
        member.resetPasswordExpiresAt = new Date(Date.now() + RESET_PASSWORD_TTL_MS);
        await repo.save(member);
        // 一次性口令：仅本次调用回传，不持久化
        (member as any).initialPassword = password;
        return member;
    }

    /** 租户自助：重置本租户成员密码（随机一次性口令 + 强改密 + 有效期；目标权限必须低于操作者） */
    async resetMyMemberPassword(ctx: RequestContext, memberId: ID): Promise<TenantMember> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: String(memberId) } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        if (String(member.channelId) !== String(ctx.channelId)) throw new Error('MEMBER_NOT_IN_CHANNEL');
        const view = await this.memberToView(ctx, member);
        if (!view.canResetPassword) throw new Error('PERMISSION_EXCEEDS_OPERATOR');
        const password = randomStrongPassword();
        await this.administratorService.update(ctx, {
            id: String(member.administratorId) as any,
            password,
        } as any);
        member.mustChangePassword = true;
        member.resetPasswordExpiresAt = new Date(Date.now() + RESET_PASSWORD_TTL_MS);
        await repo.save(member);
        (member as any).initialPassword = password;
        return member;
    }

    /** 搜索后台账号（按邮箱/姓氏模糊匹配），返回各账号在租户内的关联统计，供「关联已有账号进租户」选择 */
    async searchAdmins(ctx: RequestContext, channelId: ID, keyword?: string, take = 10): Promise<any[]> {
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const admins = await adminRepo.find({ take: 500 });
        const kw = (keyword || '').toString().toLowerCase().trim();
        const memberRepo = this.connection.getRepository(ctx, TenantMember);
        const members = await memberRepo.find();
        const chId = channelId != null ? String(channelId) : null;
        return admins
            .filter((a: any) => {
                if (!kw) return true;
                const email = String(a.emailAddress || '').toLowerCase();
                const lastName = String(a.lastName || '').toLowerCase();
                return email.includes(kw) || lastName.includes(kw);
            })
            .slice(0, take)
            .map((a: any) => {
                const linked = members.filter((m) => String(m.administratorId) === String(a.id));
                return {
                    id: String(a.id),
                    emailAddress: a.emailAddress,
                    displayName: a.lastName ?? a.emailAddress,
                    linkedCount: linked.length,
                    linkedChannelIds: linked.map((m) => String(m.channelId)),
                    alreadyLinked: chId != null ? linked.some((m) => String(m.channelId) === chId) : false,
                };
            });
    }

    /** 将既有后台账号关联进某租户（写入 TenantMember 并合并绑定本租户角色）；若已在该租户则报错 */
    async linkMember(
        ctx: RequestContext,
        channelId: ID,
        input: {
            administratorId: ID;
            roleIds?: ID[];
            enabled?: boolean;
            displayName?: string;
            phone?: string;
            remark?: string;
        },
    ): Promise<any> {
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const admin = await adminRepo.findOne({ where: { id: String(input.administratorId) } });
        if (!admin) throw new Error('ADMIN_NOT_FOUND');
        const repo = this.connection.getRepository(ctx, TenantMember);
        const chId = String(channelId);
        const existing = await repo.findOne({
            where: { administratorId: String(input.administratorId), channelId: chId },
        });
        if (existing) throw new Error('ALREADY_IN_CHANNEL');
        const member = new TenantMember();
        member.administratorId = String(input.administratorId);
        member.channelId = chId;
        member.enabled = input.enabled ?? true;
        member.mustChangePassword = false;
        member.displayName = input.displayName ?? (admin as any)?.lastName ?? (admin as any)?.emailAddress;
        member.phone = input.phone ?? null;
        member.remark = input.remark ?? null;
        await repo.save(member);
        await this.syncMemberRolesInChannel(ctx, member.administratorId, chId, input.roleIds || []);
        return this.memberToView(ctx, member);
    }

    /** 租户管理员更新「本 channel」装修类 customFields（仅覆盖传入字段，禁止触碰安全字段） */
    async updateMyChannelCustomFields(ctx: RequestContext, input: Record<string, any> = {}): Promise<any> {
        const channelId = String(ctx.channelId);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const channel = await channelRepo.findOne({ where: { id: channelId } as any });
        if (!channel) throw new Error('CHANNEL_NOT_FOUND');
        // 安全字段禁止租户端越权修改：启停/租户号/官营标记/行业、店面模式仅超管可改；
        // 支付、登录、地图、企微通知为加密存储的敏感配置，必须走 tenantConfig 专用通道（含加密与审计），
        // 不能经本装修接口直写（否则会绕过加密/脱敏并可能被任意后台角色改写）。
        const protectedKeys = [
            'enabled',
            'tenantNo',
            'isOfficial',
            'industryType',
            'storefrontMode',
            'payConfig',
            'authConfig',
            'mapConfig',
            'serviceNotifyConfig',
            'customDomains',
            'domain',
        ];
        const merged = {
            ...((channel as any).customFields || {}),
            ...Object.fromEntries(Object.entries(input).filter(([k]) => !protectedKeys.includes(k))),
        };
        await this.channelService.update(ctx, { id: channelId, customFields: merged } as any);
        const updated = await this.channelService.findOne(ctx, channelId as any);
        // 开启物理库存即需落地默认物理仓：此处同步补建（幂等），避免出现「开关已开但无默认仓」
        // 而商品无法绑定物理仓、物理库存口径失效。补建失败不阻断配置保存（仍可在库存网点页一键初始化）。
        if (merged.physicalStockEnabled === true) {
            try {
                await this.virtualPhysicalStockService.ensureTenantInventoryLocations(ctx, updated as any);
            } catch (e: any) {
                Logger.warn(`默认物理仓补建失败: ${e?.message ?? e}`, loggerCtx);
            }
        }
        return updated;
    }
}
