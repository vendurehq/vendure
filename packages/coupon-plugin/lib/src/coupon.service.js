"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CouponService = exports.CouponNotOwnedError = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const member_level_plugin_1 = require("@vendure/member-level-plugin");
const constants_1 = require("./constants");
const localize_1 = require("./localize");
const coupon_scope_1 = require("./coupon-scope");
const coupon_channel_1 = require("./coupon-channel");
const coupon_binding_service_1 = require("./coupon-binding.service");
const coupon_settlement_1 = require("./coupon-settlement");
const coupon_template_entity_1 = require("./coupon-template.entity");
const customer_coupon_entity_1 = require("./customer-coupon.entity");
const coupon_sale_order_entity_1 = require("./coupon-sale-order.entity");
const coupon_grant_batch_entity_1 = require("./coupon-grant-batch.entity");
const product_coupon_binding_entity_1 = require("./product-coupon-binding.entity");
const redeem_scope_1 = require("./redeem-scope");
/** 模板 update() 允许写入的字段白名单 */
const TEMPLATE_UPDATE_ALLOWED = [
    'name',
    'description',
    'type',
    'discountValue',
    'minSpend',
    'startsAt',
    'endsAt',
    'totalCount',
    'pointsPrice',
    'perUserLimit',
    'scope',
    'categoryId',
    'variantId',
    'enabled',
    'claimable',
    'claimCode',
    'validDays',
    'usageScene',
    'distributionChannels',
    'salePrice',
    'anchorPrice',
    'label',
    'studentPrice',
    'category',
    'activityImage',
    'memberLevel',
    'newCustomerOnly',
    'storeCoverage',
    'costBearer',
    'merchantCostRate',
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(prefix) {
    const seg = (n) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    return `${prefix}-${seg(4)}-${seg(4)}`;
}
/**
 * 属店权限不足错误。本版本 Vendure 的 ForbiddenError 构造器固定 message='error.forbidden'（code='FORBIDDEN'），
 * 无法注入自定义文案；故继承 I18nError，沿用 FORBIDDEN 错误码，以显式携带 COUPON_NOT_OWNED 语义消息。
 */
class CouponNotOwnedError extends core_1.I18nError {
    constructor() {
        super(constants_1.COUPON_NOT_OWNED, {}, 'FORBIDDEN', core_1.LogLevel.Warn);
    }
}
exports.CouponNotOwnedError = CouponNotOwnedError;
let CouponService = class CouponService {
    constructor(connection, listQueryBuilder, bindingService) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.bindingService = bindingService;
        this.codePrefix = 'C';
    }
    init(injector) {
        this.orderService = injector.get(core_1.OrderService);
        this.customerService = injector.get(core_1.CustomerService);
        try {
            this.memberLevelService = injector.get(member_level_plugin_1.MemberLevelService);
        }
        catch (_a) {
            // member-level-plugin 未注册则禁用积分兑换
            this.memberLevelService = null;
        }
        try {
            const opts = injector.get('COUPON_PLUGIN_OPTIONS');
            if (opts === null || opts === void 0 ? void 0 : opts.codePrefix) {
                this.codePrefix = opts.codePrefix;
            }
        }
        catch (_b) {
            // options not injected
        }
    }
    /* ------------------------- 会员等级限制（P2） ------------------------- */
    /**
     * 将模板上的 memberLevel 字符串解析为所需最低档位（1-5）。
     * 支持：纯数字（"3"→3）、英文档位码（gold→3）、中文档位名（金卡会员→3）。
     * 无法解析或空 → 返回 null（不设限，fail-open）。对未知文案保持宽容，避免误伤。
     */
    async resolveRequiredMemberLevel(memberLevel) {
        if (memberLevel == null)
            return null;
        const s = String(memberLevel).trim();
        if (!s)
            return null;
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            return n >= 1 && n <= 5 ? n : null;
        }
        const tierAliases = [
            { level: 1, keys: ['普通', '普通会员', 'bronze', 'bronze member'] },
            { level: 2, keys: ['银', '银卡', '银卡会员', 'silver', 'silver member'] },
            { level: 3, keys: ['金', '金卡', '金卡会员', 'gold', 'gold member'] },
            { level: 4, keys: ['白金', '白金会员', 'platinum', 'platinum member'] },
            { level: 5, keys: ['钻石', '钻石会员', 'diamond', 'diamond member'] },
        ];
        const lower = s.toLowerCase();
        for (const tier of tierAliases) {
            if (tier.keys.some(k => lower === k || lower.includes(k)))
                return tier.level;
        }
        return null;
    }
    /**
     * 会员等级门槛判定（非阻塞）。memberLevel 未设 / 解析失败 / 会员插件未注册 → 放行；
     * 否则要求顾客当前档位 >= 所需档位。
     */
    async couponMeetsMemberLevel(ctx, customerId, tpl) {
        var _a;
        const required = await this.resolveRequiredMemberLevel(tpl.memberLevel);
        if (required == null)
            return true;
        if (!this.memberLevelService)
            return true; // 会员插件未注册，fail-open
        const tier = await this.memberLevelService.resolveTierForCustomer(ctx, customerId);
        const level = (_a = tier === null || tier === void 0 ? void 0 : tier.tierLevel) !== null && _a !== void 0 ? _a : 1;
        return level >= required;
    }
    /** 会员等级门槛校验（抛错）。 */
    async assertCouponMemberLevel(ctx, customerId, tpl) {
        if (!(await this.couponMeetsMemberLevel(ctx, customerId, tpl))) {
            throw new core_1.UserInputError('Coupon requires a higher member level');
        }
    }
    /* ------------------------- 模板管理 ------------------------- */
    async findAllTemplates(ctx, options) {
        const qb = this.listQueryBuilder.build(coupon_template_entity_1.CouponTemplate, options, {
            ctx,
            channelId: ctx.channelId,
            relations: ['channels'],
        });
        // 属店隔离：店主管理员只能看到「平台级券（shopId 为空）」+「本店发的券」；
        // 超级管理员（无属店）→ 全量。
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        if (adminShopId != null) {
            qb.andWhere('(coupontemplate.shopId IS NULL OR coupontemplate.shopId = :adminShopId)', {
                adminShopId,
            });
        }
        return qb
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    async findOneTemplate(ctx, id) {
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const tpl = await repo.findOne({
            where: { id: id },
            relations: { channels: true },
        });
        if (tpl) {
            await this.assertManagedByShop(ctx, tpl.shopId);
        }
        return tpl !== null && tpl !== void 0 ? tpl : undefined;
    }
    /** 下线 CATEGORY scope（coupon.md §8 A1）：结算无分类匹配逻辑、无 UI/实体关系指向，
     *  使管理员误配「分类券」时静默全场可抵。create/update 一律拒绝该值。 */
    assertScopeSupported(scope) {
        if (scope === 'CATEGORY') {
            throw new core_1.UserInputError('Scope CATEGORY is not supported; use ALL or product binding (SKU) instead');
        }
    }
    async createTemplate(ctx, input) {
        this.assertScopeSupported(input === null || input === void 0 ? void 0 : input.scope);
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const tpl = new coupon_template_entity_1.CouponTemplate(input);
        await this.applyClaimCodeInput(repo, tpl, input);
        if (tpl.type === 'FULL') {
            tpl.minSpend = 0;
        }
        tpl.channels = [ctx.channel];
        tpl.claimedCount = 0;
        // 多语言入参（P5）：nameZh/nameEn/descZh/descEn 合并为 LocalizedText 对象。
        this.applyMultilingualInput(tpl, input);
        this.applyMarketingInput(tpl, input);
        this.applyStoreCoverageInput(tpl, input);
        this.applyCostBearerInput(tpl, input);
        if (tpl.name == null) {
            throw new core_1.UserInputError('CouponTemplate name (or nameZh) is required');
        }
        // 发行归属店铺（跨渠道范围用）：优先采用显式传入的 shopId，否则从当前管理员的店解析。
        // 若 Shop / Administrator 依赖插件未注册或无法解析，则保持 undefined（不阻断）。
        if (input.shopId != null) {
            tpl.shopId = Number(input.shopId);
        }
        else if (tpl.shopId == null) {
            const shopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
            if (shopId != null) {
                tpl.shopId = Number(shopId);
            }
        }
        return repo.save(tpl);
    }
    async updateTemplate(ctx, input) {
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const tpl = await repo.findOne({ where: { id: input.id } });
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate with id ${input.id} not found`);
        }
        await this.assertManagedByShop(ctx, tpl.shopId);
        if (input.scope != null)
            this.assertScopeSupported(input.scope);
        for (const key of TEMPLATE_UPDATE_ALLOWED) {
            if (!(key in input))
                continue;
            // claimable 为非空列：显式传 null 视为未修改，避免落库报错
            if (key === 'claimable' && input[key] == null)
                continue;
            tpl[key] = input[key];
        }
        await this.applyClaimCodeInput(repo, tpl, input);
        // 多语言入参（P5）：合并 nameZh/nameEn/descZh/descEn（保留既有其它语言文案）。
        this.applyMultilingualInput(tpl, input);
        this.applyMarketingInput(tpl, input);
        this.applyStoreCoverageInput(tpl, input);
        this.applyCostBearerInput(tpl, input);
        return repo.save(tpl);
    }
    /**
     * 兑换码入参规范化（create/update 共用）：
     * - 未传 → 不动；空串/空白 → 清空（null）
     * - 去首尾空白后全库唯一（兑换接口按 claimCode 定位模板，重复会导致归属歧义）
     */
    async applyClaimCodeInput(repo, tpl, input) {
        if (!(input && 'claimCode' in input))
            return;
        const raw = input.claimCode;
        const code = typeof raw === 'string' ? raw.trim() : '';
        if (!code) {
            tpl.claimCode = null;
            return;
        }
        const existing = await repo.findOne({ where: { claimCode: code } });
        if (existing && existing.id !== tpl.id) {
            throw new core_1.UserInputError(`兑换码「${code}」已被其他券模板占用`);
        }
        tpl.claimCode = code;
    }
    /**
     * 券成本承担入参规范化（create/update 共用）：
     * - costBearer 仅接受 PLATFORM|MERCHANT|SPLIT，非法值回退 PLATFORM（历史行为：平台承担）
     * - merchantCostRate 仅在 SPLIT 下生效（0-100，缺省 50）；PLATFORM 归 0、MERCHANT 归 100，
     *   保证结算侧只需按比例计算
     */
    applyCostBearerInput(tpl, input) {
        var _a, _b, _c, _d;
        const hasBearer = (input === null || input === void 0 ? void 0 : input.costBearer) !== undefined;
        const hasRate = (input === null || input === void 0 ? void 0 : input.merchantCostRate) !== undefined;
        if (!hasBearer && !hasRate && tpl.id != null) {
            // update 时两者都未传：保持既有配置
            return;
        }
        const bearer = String((_b = (_a = input === null || input === void 0 ? void 0 : input.costBearer) !== null && _a !== void 0 ? _a : tpl.costBearer) !== null && _b !== void 0 ? _b : 'PLATFORM')
            .trim()
            .toUpperCase();
        const normalized = bearer === 'MERCHANT' || bearer === 'SPLIT' ? bearer : 'PLATFORM';
        tpl.costBearer = normalized;
        if (normalized === 'PLATFORM') {
            tpl.merchantCostRate = 0;
        }
        else if (normalized === 'MERCHANT') {
            tpl.merchantCostRate = 100;
        }
        else {
            const raw = (_d = (_c = input === null || input === void 0 ? void 0 : input.merchantCostRate) !== null && _c !== void 0 ? _c : tpl.merchantCostRate) !== null && _d !== void 0 ? _d : 50;
            const n = Math.round(Number(raw));
            tpl.merchantCostRate = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
        }
    }
    /**
     * 门店覆盖范围入参规范化（create/update 共用）：仅接受 ALL|MERCHANT|STORE，
     * 非法值回退 ALL（不限门店，与历史券行为一致）。
     */
    applyStoreCoverageInput(tpl, input) {
        var _a;
        if ((input === null || input === void 0 ? void 0 : input.storeCoverage) === undefined)
            return;
        const v = String((_a = input.storeCoverage) !== null && _a !== void 0 ? _a : '').trim().toUpperCase();
        tpl.storeCoverage = v === 'MERCHANT' || v === 'STORE' ? v : 'ALL';
    }
    /**
     * 营销字段入参规范化（create/update 共用）：
     * anchorPrice 仅接受正整数（分），非法/<=0 归 null（不展示划线价）；
     * label 去首尾空白、限 30 字符，空串归 null（不展示标签）。
     */
    applyMarketingInput(tpl, input) {
        if (input.anchorPrice !== undefined) {
            const n = Math.floor(Number(input.anchorPrice));
            tpl.anchorPrice =
                input.anchorPrice == null || !Number.isFinite(n) || n <= 0 ? null : n;
        }
        if (input.label !== undefined) {
            const s = typeof input.label === 'string' ? input.label.trim() : '';
            tpl.label = s ? s.slice(0, 30) : null;
        }
        if (input.studentPrice !== undefined) {
            const n = Math.floor(Number(input.studentPrice));
            tpl.studentPrice =
                input.studentPrice == null || !Number.isFinite(n) || n <= 0 ? null : n;
        }
        // 业态分类键：去首尾空白、限 30 字符，空串归 null（未分类）
        if (input.category !== undefined) {
            const s = typeof input.category === 'string' ? input.category.trim() : '';
            tpl.category = s ? s.slice(0, 30) : null;
        }
    }
    /**
     * 多语言合并：nameZh/nameEn/descZh/descEn 按需写入，产出 LocalizedText 对象，
     * 并保留既有的其它语言文案。任一多语言字段均未提供时不改动。
     */
    applyMultilingualInput(tpl, input) {
        var _a, _b, _c, _d, _e;
        const hasName = input.nameZh != null || input.nameEn != null;
        const hasDesc = input.descZh != null || input.descEn != null;
        if (hasName) {
            tpl.name = this.mergeLocalized(tpl.name, (_a = input.nameZh) !== null && _a !== void 0 ? _a : null, (_b = input.nameEn) !== null && _b !== void 0 ? _b : null);
        }
        if (hasDesc) {
            tpl.description = this.mergeLocalized((_c = tpl.description) !== null && _c !== void 0 ? _c : null, (_d = input.descZh) !== null && _d !== void 0 ? _d : null, (_e = input.descEn) !== null && _e !== void 0 ? _e : null);
        }
    }
    /** 合并单条 LocalizedText：当前值（对象取其已有键，纯字符串视为 zh）叠加 zh_Hans/en 覆盖。 */
    mergeLocalized(current, zh, en) {
        const obj = {};
        if (typeof current === 'object' && current != null) {
            Object.assign(obj, current);
        }
        else if (typeof current === 'string' && current) {
            obj.zh_Hans = current;
        }
        if (zh != null)
            obj.zh_Hans = zh;
        if (en != null)
            obj.en = en;
        return obj;
    }
    async deleteTemplate(ctx, id) {
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const tpl = await repo.findOne({ where: { id: id } });
        if (tpl) {
            await this.assertManagedByShop(ctx, tpl.shopId);
        }
        // 模板删除保护：已被商品绑定（ProductCouponBinding）引用时禁止删除，须先解绑
        const bindingCount = await this.connection
            .getRepository(ctx, product_coupon_binding_entity_1.ProductCouponBinding)
            .count({ where: { couponTemplateId: id } });
        if (bindingCount > 0) {
            throw new core_1.UserInputError('Template has product bindings, unbind them first');
        }
        // A2：已发放券（customer_coupon 引用）保护——存在则抛可读错误，避免底层裸外键报错
        const issued = await this.connection
            .getRepository(ctx, customer_coupon_entity_1.CustomerCoupon)
            .createQueryBuilder('cc')
            .where('cc.template = :id', { id: String(id) })
            .getCount();
        if (issued > 0) {
            throw new core_1.UserInputError(`Template has ${issued} issued coupon(s); revoke or delete the customer coupons first`);
        }
        await repo.delete(id);
    }
    /* ------------------------- 领券中心 / 券包 ------------------------- */
    /**
     * 领券中心。scene 口径：ONLINE（默认，历史行为）| IN_STORE（到店券，C 端到店券 tab）| ALL（全部）。
     * 匹配规则见 matchesScene：ALL 场景券在 ONLINE 与 IN_STORE 口径下均会返回。
     */
    async couponCentre(ctx, scene) {
        const effectiveScene = (scene !== null && scene !== void 0 ? scene : 'ONLINE');
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const now = new Date();
        // 粗筛：显式配置了渠道集合的券不再要求 claimable=true（显式优先）；
        // 未配置的历史券仍按老字段 claimable 过滤，保证行为不变。
        const own = await repo
            .createQueryBuilder('tpl')
            .innerJoin('tpl.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('tpl.enabled = :enabled', { enabled: true })
            .andWhere(new typeorm_1.Brackets(qb => qb
            .where('tpl.distributionChannels IS NOT NULL')
            .andWhere("tpl.distributionChannels <> ''")
            .orWhere('tpl.claimable = :claimable', { claimable: true })))
            .andWhere('(tpl.startsAt IS NULL OR tpl.startsAt <= :now)', { now })
            .andWhere('(tpl.endsAt IS NULL OR tpl.endsAt >= :now)', { now })
            .getMany();
        // 非默认商城维持现状：仅列出本渠道券。
        if (!(0, coupon_scope_1.isDefaultMallChannel)(ctx)) {
            return this.filterByMemberLevelVisibility(ctx, (0, coupon_channel_1.filterTemplatesByChannelAndScene)(own, 'CENTRE', effectiveScene));
        }
        // 默认商城：除本渠道券外，追加列出「其 shopId 对应商品出现在本商城」的租户券。
        const shopIds = await this.shopIdsPresentInChannel(ctx);
        if (shopIds.size === 0) {
            return this.filterByMemberLevelVisibility(ctx, (0, coupon_channel_1.filterTemplatesByChannelAndScene)(own, 'CENTRE', effectiveScene));
        }
        const extra = await repo
            .createQueryBuilder('tpl')
            .where('tpl.shopId IN (:...shopIds)', { shopIds: [...shopIds] })
            .andWhere('tpl.enabled = :enabled', { enabled: true })
            .andWhere(new typeorm_1.Brackets(qb => qb
            .where('tpl.distributionChannels IS NOT NULL')
            .andWhere("tpl.distributionChannels <> ''")
            .orWhere('tpl.claimable = :claimable', { claimable: true })))
            .andWhere('(tpl.startsAt IS NULL OR tpl.startsAt <= :now)', { now })
            .andWhere('(tpl.endsAt IS NULL OR tpl.endsAt >= :now)', { now })
            .getMany();
        const ownIds = new Set(own.map(t => String(t.id)));
        const merged = [...own, ...extra.filter(t => !ownIds.has(String(t.id)))];
        return this.filterByMemberLevelVisibility(ctx, (0, coupon_channel_1.filterTemplatesByChannelAndScene)(merged, 'CENTRE', effectiveScene));
    }
    /** 领券中心「即将开始」：enabled 且 startsAt 在未来的券模板（与 couponCentre 同渠道/scene 口径） */
    async couponCentreUpcoming(ctx, scene) {
        const effectiveScene = (scene !== null && scene !== void 0 ? scene : 'ONLINE');
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const now = new Date();
        const own = await repo
            .createQueryBuilder('tpl')
            .innerJoin('tpl.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('tpl.enabled = :enabled', { enabled: true })
            .andWhere('tpl.startsAt > :now', { now })
            .getMany();
        return this.filterByMemberLevelVisibility(ctx, (0, coupon_channel_1.filterTemplatesByChannelAndScene)(own, 'CENTRE', effectiveScene));
    }
    /** 默认商城渠道下，本商城商品（Product.customFields.shopId）中出现过的店铺 id 集合。 */
    async shopIdsPresentInChannel(ctx) {
        var _a, _b;
        const set = new Set();
        try {
            const productRepo = this.connection.getRepository(ctx, core_1.Product);
            const products = await productRepo.find({ relations: { channels: true } });
            for (const p of products) {
                const inChannel = ((_a = p.channels) !== null && _a !== void 0 ? _a : []).some((c) => String(c.id) === String(ctx.channelId));
                if (!inChannel)
                    continue;
                const sid = Number(((_b = p.customFields) !== null && _b !== void 0 ? _b : {}).shopId);
                if (sid && !Number.isNaN(sid))
                    set.add(sid);
            }
        }
        catch (_c) {
            // Product 不可用等场景忽略，仅返回本渠道券
        }
        return set;
    }
    async listMyCoupons(ctx, status) {
        const customerId = await this.currentCustomerId(ctx);
        if (!customerId)
            return [];
        // 先收敛过期券：把本用户已越界的 UNUSED/RETURNED 落为 EXPIRED，其后 status 过滤即命中
        await this.expireDueCoupons(ctx, customerId);
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const qb = repo
            .createQueryBuilder('cc')
            .leftJoinAndSelect('cc.template', 'template')
            .where('cc.customerId = :customerId', { customerId });
        if (status) {
            qb.andWhere('cc.status = :status', { status });
        }
        return qb.getMany();
    }
    /**
     * C 端：按券码精准查当前登录用户自己的单张券（券码页轮询核销状态用）。
     * 只匹配本人名下的券，非本人或不存在一律返回 null，避免越权探测券码。
     */
    async getMyCouponByCode(ctx, code) {
        const customerId = await this.currentCustomerId(ctx);
        if (!customerId)
            return null;
        // 与 listMyCoupons 一致：先收敛过期状态，轮询方能立刻看到 EXPIRED
        await this.expireDueCoupons(ctx, customerId);
        const normalized = (code || '').trim().toUpperCase();
        if (!normalized)
            return null;
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const cc = await repo.findOne({
            where: { customerId, code: normalized },
            relations: { template: true },
        });
        return cc !== null && cc !== void 0 ? cc : null;
    }
    /**
     * 到店收银：列出某顾客在当前渠道「可到店核销」的券（未使用 / 未过期 / 场景含 IN_STORE）。
     * 仅到店场景过滤，不做渠道集合判定（券可由任意渠道获得，到店核销只看场景与归属）。
     */
    async listInStoreCoupons(ctx, customerId) {
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const list = await repo.find({
            where: { customerId },
            relations: { template: { channels: true } },
            order: { id: 'DESC' },
        });
        const now = Date.now();
        // 属店隔离：店主管理员只看本店券 + 平台级券（与 assertManagedByShop 同法）。
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        const base = list.filter(cc => {
            const tpl = cc.template;
            if (!tpl || !tpl.enabled)
                return false;
            if (cc.status !== 'UNUSED' && cc.status !== 'RETURNED')
                return false;
            if (cc.expiredAt && new Date(cc.expiredAt).getTime() <= now)
                return false;
            if (!(0, coupon_channel_1.matchesScene)(tpl.usageScene, 'IN_STORE'))
                return false;
            if (adminShopId != null && tpl.shopId != null && Number(tpl.shopId) !== adminShopId)
                return false;
            return this.templateBelongsToChannel(ctx, tpl);
        });
        // 受限核销员（持有 VerifyOrder）：只保留「券模板全部关联商品档案命中白名单」的券，通用券一律不返回。
        const scope = await (0, redeem_scope_1.resolveRedeemScope)(ctx);
        if (!scope.restricted) {
            return base;
        }
        const out = [];
        for (const cc of base) {
            if (cc.template && (await (0, redeem_scope_1.couponTemplateInScope)(ctx, cc.template.id, scope))) {
                out.push(cc);
            }
        }
        return out;
    }
    async listAllCoupons(ctx, options) {
        const qb = this.listQueryBuilder.build(customer_coupon_entity_1.CustomerCoupon, options, { ctx });
        qb.leftJoinAndSelect('customercoupon.template', 'tpl');
        // 属店隔离：店主管理员只看「本店券实例 + 平台级券实例」（与 assertManagedByShop 同法）；
        // 超级管理员（无属店）→ 全量。
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        if (adminShopId != null) {
            qb.andWhere('(tpl.shopId IS NULL OR tpl.shopId = :adminShopId)', { adminShopId });
        }
        return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
    }
    /* ------------------------- 核销看板（FR-A3，t1 营销补齐 PRD） ------------------------- */
    /**
     * 核销看板四指标：按模板聚合领券记录状态（仅状态计数，不新增埋点）。
     * 口径：claimed=领取量（记录条数，CustomerCoupon 每行一张券实例）；used=核销量；
     * redemptionRate=核销率=used/claimed；expiredRate=过期率=expired/claimed（百分比 0-100）。
     * 时间筛选按领取时间（createdAt）闭区间；templateId 可选；属店隔离与 listAllCoupons 同法。
     */
    async couponRedemptionStats(ctx, options) {
        const qb = this.connection
            .getRepository(ctx, customer_coupon_entity_1.CustomerCoupon)
            .createQueryBuilder('cc')
            .leftJoin(coupon_template_entity_1.CouponTemplate, 'tpl', 'tpl.id = cc.templateId')
            .select('cc.templateId', 'templateId')
            .addSelect('tpl.name', 'name')
            .addSelect('COUNT(*)', 'total')
            .addSelect("SUM(CASE WHEN cc.status = 'USED' THEN 1 ELSE 0 END)", 'used')
            .addSelect("SUM(CASE WHEN cc.status = 'EXPIRED' THEN 1 ELSE 0 END)", 'expired')
            .addSelect("SUM(CASE WHEN cc.status = 'UNUSED' THEN 1 ELSE 0 END)", 'unused')
            .addSelect("SUM(CASE WHEN cc.status = 'RETURNED' THEN 1 ELSE 0 END)", 'returned')
            .addSelect("SUM(CASE WHEN cc.status = 'INVALID' THEN 1 ELSE 0 END)", 'invalid')
            .groupBy('cc.templateId')
            .addGroupBy('tpl.name');
        if ((options === null || options === void 0 ? void 0 : options.templateId) != null) {
            qb.andWhere('cc.templateId = :templateId', { templateId: options.templateId });
        }
        if ((options === null || options === void 0 ? void 0 : options.from) != null) {
            qb.andWhere('cc.createdAt >= :from', { from: options.from });
        }
        if ((options === null || options === void 0 ? void 0 : options.to) != null) {
            qb.andWhere('cc.createdAt <= :to', { to: options.to });
        }
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        if (adminShopId != null) {
            qb.andWhere('(tpl.shopId IS NULL OR tpl.shopId = :adminShopId)', { adminShopId });
        }
        const rows = await qb.getRawMany();
        return rows.map((r) => {
            var _a, _b, _c, _d, _e, _f;
            const claimed = Number((_a = r.total) !== null && _a !== void 0 ? _a : 0);
            const used = Number((_b = r.used) !== null && _b !== void 0 ? _b : 0);
            const expired = Number((_c = r.expired) !== null && _c !== void 0 ? _c : 0);
            const rate = (n) => (claimed > 0 ? Math.round((n / claimed) * 10000) / 100 : 0);
            return {
                templateId: Number(r.templateId),
                name: typeof r.name === 'string' ? r.name : null,
                claimed,
                used,
                expired,
                unused: Number((_d = r.unused) !== null && _d !== void 0 ? _d : 0),
                returned: Number((_e = r.returned) !== null && _e !== void 0 ? _e : 0),
                invalid: Number((_f = r.invalid) !== null && _f !== void 0 ? _f : 0),
                redemptionRate: rate(used),
                expiredRate: rate(expired),
            };
        });
    }
    /* ------------------------- 积分兑换商城 ------------------------- */
    async pointsMallTemplates(ctx) {
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const now = new Date();
        // 粗筛：显式配置渠道的券不再要求 pointsPrice>0；历史券仍按 pointsPrice>0 过滤。
        const rows = await repo
            .createQueryBuilder('tpl')
            .innerJoin('tpl.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('tpl.enabled = :enabled', { enabled: true })
            .andWhere(new typeorm_1.Brackets(qb => qb
            .where('tpl.distributionChannels IS NOT NULL')
            .andWhere("tpl.distributionChannels <> ''")
            .orWhere('tpl.pointsPrice > 0')))
            .andWhere('(tpl.startsAt IS NULL OR tpl.startsAt <= :now)', { now })
            .andWhere('(tpl.endsAt IS NULL OR tpl.endsAt >= :now)', { now })
            .orderBy('tpl.pointsPrice', 'ASC')
            .getMany();
        return this.filterByMemberLevelVisibility(ctx, (0, coupon_channel_1.filterTemplatesByChannelAndScene)(rows, 'POINTS', 'ONLINE'));
    }
    async exchangeWithPoints(ctx, templateId) {
        if (!this.memberLevelService) {
            throw new core_1.UserInputError('Points service is not enabled');
        }
        const customerId = await this.currentCustomerId(ctx);
        if (!customerId) {
            throw new core_1.UserInputError('No customer for the current user');
        }
        // 兑换前收敛过期券（与限兑/计数语义一致）
        await this.expireDueCoupons(ctx, customerId);
        const tpl = await this.findOneTemplate(ctx, templateId);
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate ${templateId} not found`);
        }
        if (tpl.pointsPrice <= 0) {
            throw new core_1.UserInputError('This coupon is not exchangeable with points');
        }
        const now = new Date();
        if (!tpl.enabled) {
            throw new core_1.UserInputError('Coupon template is disabled');
        }
        if (tpl.startsAt && now < tpl.startsAt) {
            throw new core_1.UserInputError('Not yet started');
        }
        if (tpl.endsAt && now > tpl.endsAt) {
            throw new core_1.UserInputError('Coupon redeemed');
        }
        // 限兑校验
        if (tpl.perUserLimit > 0) {
            const owned = await this.countHeld(customerId, tpl.id);
            if (owned >= tpl.perUserLimit) {
                throw new core_1.UserInputError('Per-user redemption limit reached');
            }
        }
        // E2 会员等级门槛：配置等级门槛的券不达标不可兑换
        await this.assertCouponMemberLevel(ctx, customerId, tpl);
        // 扣积分（原子 + SPEND 流水；不足抛 Insufficient；Transaction 保证与发券同回滚）
        await this.memberLevelService.spendPoints(ctx, customerId, tpl.pointsPrice, null, `积分兑换优惠券:${(0, localize_1.localizeText)(tpl.name, ctx.languageCode, '')}`);
        // 原子扣发行余量（防超发）
        const ok = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
        if (!ok) {
            throw new core_1.UserInputError('Coupon sold out');
        }
        const coupon = await this.createUserCoupon(ctx, customerId, tpl, 'EXCHANGE');
        return { coupon, spentPoints: tpl.pointsPrice };
    }
    /* ------------------------- 领券 / 定向发券 ------------------------- */
    async claimCoupon(ctx, templateId) {
        const customerId = await this.currentCustomerId(ctx);
        if (!customerId) {
            throw new core_1.UserInputError('No customer for the current user');
        }
        // 领券前收敛过期券（与限领/计数语义一致：过期券不计持有）
        await this.expireDueCoupons(ctx, customerId);
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const tpl = await repo.findOne({
            where: { id: templateId },
            relations: { channels: true },
        });
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate ${templateId} not found`);
        }
        const now = new Date();
        if (!tpl.enabled) {
            throw new core_1.UserInputError('Coupon template is disabled');
        }
        if (tpl.startsAt && now < tpl.startsAt) {
            throw new core_1.UserInputError('Coupon not yet started');
        }
        if (tpl.endsAt && now > tpl.endsAt) {
            throw new core_1.UserInputError('Coupon has expired');
        }
        // 限领并发防护：在事务连接上对 Customer 行 FOR UPDATE，串行化同一用户的并发领券竞态
        // （countHeld 检查-后-写入窗口；必须在事务 repo 上执行——autocommit 连接的行锁随语句结束即释放）。
        // Shop API 三个领券入口均带 @Transaction()，锁持续到外层事务提交/回滚。
        // FOR UPDATE 为 PostgreSQL 语法；e2e 等单进程 SQLite 环境不支持，跳过行锁（无并发竞态）。
        if (this.connection.rawConnection.options.type === 'postgres') {
            await this.connection.getRepository(ctx, core_1.Customer).query('SELECT id FROM customer WHERE id = $1 FOR UPDATE', [customerId]);
        }
        // 限领校验
        if (tpl.perUserLimit > 0) {
            const owned = await this.countHeld(customerId, tpl.id);
            if (owned >= tpl.perUserLimit) {
                throw new core_1.UserInputError('Per-user coupon limit reached');
            }
        }
        // 仅限新客：本租户历史有效订单数 > 0 则不可领
        if (tpl.newCustomerOnly) {
            const placed = await this.hasPlacedOrder(ctx, customerId);
            if (placed)
                throw new core_1.UserInputError('Coupon is for new customers only');
        }
        // 会员等级门槛（P2）
        await this.assertCouponMemberLevel(ctx, customerId, tpl);
        // 原子扣减发行余量（防超发）
        const claim = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
        if (!claim) {
            throw new core_1.UserInputError('Coupon sold out');
        }
        return this.createUserCoupon(ctx, customerId, tpl, 'CENTRE');
    }
    /* ------------------------- 商品详情页领券 / 凭码兑换（租户指定商品优惠券） ------------------------- */
    /** 详情页可领券：binding.enabled && 模板 enabled && claimable + 渠道匹配（listByProduct 已过滤） */
    async listProductCoupons(ctx, productId) {
        return this.bindingService.listByProduct(ctx, Number(productId));
    }
    /** 详情页领券：按 bindingId 找到模板后复用 claimCoupon（限领/余量/newCustomerOnly 校验都在其中） */
    async claimProductCoupon(ctx, bindingId) {
        var _a;
        const binding = await this.connection
            .getRepository(ctx, product_coupon_binding_entity_1.ProductCouponBinding)
            .findOne({ where: { id: bindingId }, relations: { template: true } });
        if (!binding || !binding.enabled) {
            throw new core_1.UserInputError('Binding not found');
        }
        if (binding.channelId != null && Number(binding.channelId) !== Number((_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.id)) {
            throw new core_1.UserInputError('Binding not found');
        }
        if (!binding.template ||
            !(0, coupon_channel_1.hasChannel)(binding.template, true, 'PRODUCT') ||
            // 领取动作与使用场景无关：线上券领取后线上结算，到店券领取后到店核销
            !((0, coupon_channel_1.matchesScene)(binding.template.usageScene, 'ONLINE') ||
                (0, coupon_channel_1.matchesScene)(binding.template.usageScene, 'IN_STORE'))) {
            throw new core_1.UserInputError('Coupon is not claimable');
        }
        return this.claimCoupon(ctx, binding.couponTemplateId);
    }
    /** 凭码兑换：同租户内 claimCode 唯一匹配模板 → 复用 claimCoupon */
    async redeemByClaimCode(ctx, claimCode) {
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const candidates = await repo.find({
            where: { claimCode },
            relations: { channels: true },
        });
        const hit = candidates.find(t => t.claimCode &&
            this.templateBelongsToChannel(ctx, t) &&
            (0, coupon_channel_1.hasChannel)(t, false, 'CODE') &&
            (0, coupon_channel_1.matchesScene)(t.usageScene, 'ONLINE'));
        if (!hit) {
            if (candidates.length === 0) {
                throw new core_1.UserInputError('Invalid claim code');
            }
            throw new core_1.UserInputError('Claim code not available in this shop');
        }
        return this.claimCoupon(ctx, hit.id);
    }
    /** 模板渠道归属校验：channels 为空（不限渠道）→ true；否则要求包含当前渠道（供到店买单复用） */
    templateBelongsToChannel(ctx, tpl) {
        if (!tpl.channels || tpl.channels.length === 0) {
            return true;
        }
        return tpl.channels.some(c => String(c.id) === String(ctx.channelId));
    }
    async grantCoupon(ctx, templateId, customerIds) {
        const tpl = await this.findOneTemplate(ctx, templateId);
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate ${templateId} not found`);
        }
        const codes = [];
        for (const customerId of customerIds) {
            const ok = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
            if (!ok) {
                throw new core_1.UserInputError('Coupon sold out');
            }
            const cc = await this.createUserCoupon(ctx, customerId, tpl, 'ADMIN');
            codes.push(cc.code);
        }
        return codes;
    }
    /* ------------------------- 定向发券（批量 + 通知） ------------------------- */
    async listChannelCustomers(ctx, query, take = 20, skip = 0) {
        const repo = this.connection.getRepository(ctx, core_1.Customer);
        const qb = repo
            .createQueryBuilder('c')
            .distinct(true)
            .select([
            'c.id',
            'c.emailAddress',
            'c.firstName',
            'c.lastName',
            'c.phoneNumber',
            'c.createdAt',
        ])
            .innerJoin('c.channels', 'channel', 'channel.id = :cid', { cid: ctx.channelId });
        // 属店隔离：店主管理员只看「本店顾客」——在本渠道内下过「含本店商品」订单（已下单，orderPlacedAt 非空）的顾客，
        // 与 shop-plugin myShopOrders 的归属口径一致（行商品 Product.customFields.shopId === 本店）。
        // 超级管理员（无属店）→ 渠道全量，行为不变。
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        if (adminShopId != null) {
            const shopProductIds = await this.findShopProductIds(ctx, adminShopId);
            if (shopProductIds.length === 0) {
                return { items: [], totalItems: 0 };
            }
            qb.innerJoin('c.orders', 'o')
                .innerJoin('o.channels', 'oChannel', 'oChannel.id = :cid')
                .innerJoin('o.lines', 'ol')
                .innerJoin('ol.productVariant', 'pv')
                .andWhere('o.orderPlacedAt IS NOT NULL')
                .andWhere('pv.productId IN (:...shopProductIds)', { shopProductIds });
        }
        if (query) {
            const q = `%${query.trim().toLowerCase()}%`;
            qb.andWhere('(LOWER(c.emailAddress) LIKE :q OR LOWER(c.firstName) LIKE :q OR LOWER(c.lastName) LIKE :q OR LOWER(c.phoneNumber) LIKE :q)', { q });
        }
        qb.orderBy('c.id', 'DESC').skip(skip).take(take);
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    /** 本店商品 id 列表（Product.customFields.shopId === shopId），供「本店顾客」归属过滤。 */
    async findShopProductIds(ctx, shopId) {
        try {
            const products = await this.connection.getRepository(ctx, core_1.Product).find({
                where: { customFields: { shopId } },
                select: { id: true },
            });
            return products.map(p => Number(p.id));
        }
        catch (_a) {
            // Product.customFields 不可用（shop-plugin 未加载）→ 无本店商品，返回空
            return [];
        }
    }
    async customerInChannel(ctx, customerId) {
        const repo = this.connection.getRepository(ctx, core_1.Customer);
        const count = await repo
            .createQueryBuilder('c')
            .innerJoin('c.channels', 'channel', 'channel.id = :cid', { cid: ctx.channelId })
            .where('c.id = :id', { id: customerId })
            .getCount();
        return count > 0;
    }
    async notifyCouponIssued(ctx, customerId, tpl, code) {
        // 复用 message-plugin 的 Message/MessageDelivery（invoice-plugin 已落地范式）；
        // 未装 message-plugin 时实体不存在，抛错由调用方捕获、不阻塞发券。
        const msgRepo = this.connection.getRepository(ctx, 'Message');
        const delRepo = this.connection.getRepository(ctx, 'MessageDelivery');
        const name = (0, localize_1.localizeText)(tpl.name, ctx.languageCode, '优惠券');
        const title = `优惠券到账：${name}`;
        const body = `您获得本店定向赠送优惠券，券码 ${code}，可在结算时抵扣。`;
        const message = await msgRepo.save(msgRepo.create({
            title,
            body,
            deliveryChannel: 'inapp',
            audienceType: 'all',
            status: 'sent',
            totalTarget: 1,
            totalSent: 1,
            channels: [ctx.channel],
        }));
        await delRepo.save(delRepo.create({
            messageId: message.id,
            customerId: Number(customerId),
            deliveryStatus: 'sent',
            channels: [ctx.channel],
        }));
    }
    async grantCouponIssue(ctx, templateId, customerIds, notify, opts) {
        var _a, _b, _c;
        const tpl = await this.findOneTemplate(ctx, templateId);
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate ${templateId} not found`);
        }
        if (!(0, coupon_channel_1.hasChannel)(tpl, false, 'GRANT')) {
            throw new core_1.UserInputError('Coupon is not available for targeted grant');
        }
        const customerRepo = this.connection.getRepository(ctx, core_1.Customer);
        const results = [];
        for (const customerId of customerIds) {
            try {
                const cust = await customerRepo.findOne({
                    where: { id: customerId },
                    relations: { user: true },
                });
                if (!cust) {
                    results.push({ customerId, ok: false, code: null, reason: 'CUSTOMER_NOT_FOUND' });
                    continue;
                }
                if (!(await this.customerInChannel(ctx, customerId))) {
                    results.push({ customerId, ok: false, code: null, reason: 'CUSTOMER_NOT_IN_CHANNEL' });
                    continue;
                }
                if (tpl.perUserLimit > 0) {
                    const owned = await this.countHeld(Number(customerId), tpl.id);
                    if (owned >= tpl.perUserLimit) {
                        results.push({ customerId, ok: false, code: null, reason: 'PER_USER_LIMIT' });
                        continue;
                    }
                }
                // 会员等级门槛（P2）：不满足则本单不发券，单结果标记拦截，不抛错中断整批
                if (!(await this.couponMeetsMemberLevel(ctx, Number(customerId), tpl))) {
                    results.push({ customerId, ok: false, code: null, reason: 'MEMBER_LEVEL_BLOCKED' });
                    continue;
                }
                // R4 防骚扰（E1 召回复用）：同渠道同模板同渠道标记 N 天内已发过则跳过
                if (opts === null || opts === void 0 ? void 0 : opts.recentIssuedDays) {
                    const since = new Date(Date.now() - opts.recentIssuedDays * 86400000);
                    const recent = await this.connection
                        .getRepository(ctx, customer_coupon_entity_1.CustomerCoupon)
                        .createQueryBuilder('cc')
                        .innerJoin('cc.template', 'tplRef')
                        .where('cc.customerId = :customerId', { customerId })
                        .andWhere('tplRef.id = :templateId', { templateId: tpl.id })
                        .andWhere('cc.issuedBy = :issuedBy', { issuedBy: (_a = opts.issuedBy) !== null && _a !== void 0 ? _a : 'ADMIN' })
                        .andWhere('cc.createdAt >= :since', { since })
                        .getCount();
                    if (recent > 0) {
                        results.push({ customerId, ok: false, code: null, reason: 'RECENTLY_GRANTED' });
                        continue;
                    }
                }
                const ok = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
                if (!ok) {
                    results.push({ customerId, ok: false, code: null, reason: 'SOLD_OUT' });
                    continue;
                }
                const cc = await this.createUserCoupon(ctx, Number(customerId), tpl, (_b = opts === null || opts === void 0 ? void 0 : opts.issuedBy) !== null && _b !== void 0 ? _b : 'ADMIN');
                results.push({ customerId, ok: true, code: cc.code, reason: null });
                if (notify) {
                    try {
                        await this.notifyCouponIssued(ctx, customerId, tpl, cc.code);
                    }
                    catch (e) {
                        core_1.Logger.warn(`notifyCouponIssued failed for ${customerId}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, constants_1.loggerCtx);
                    }
                }
            }
            catch (e) {
                results.push({ customerId, ok: false, code: null, reason: 'ERROR' });
            }
        }
        return results;
    }
    /* ------------------------- E1 沉睡召回批量发放 ------------------------- */
    /**
     * 圈选「N 天未消费」客户（E1）：本渠道内，近期（cutoff 之后）在本渠道无任何有效下单记录的客户。
     * 两步法（先查近期消费者集合，再差集）避免跨库 NOT EXISTS 方言差异；上限 take 防失控。
     */
    async findSleepingCustomerIds(ctx, days, take = 500) {
        var _a;
        const cutoff = new Date(Date.now() - Math.max(1, days) * 86400000);
        const recentConsumerIds = new Set();
        try {
            const orderRepo = this.connection.getRepository(ctx, 'Order');
            const recent = await orderRepo
                .createQueryBuilder('o')
                .innerJoin('o.channels', 'oChannel', 'oChannel.id = :channelId', { channelId: ctx.channelId })
                .select('DISTINCT o.customerId', 'cid')
                .where('o.orderPlacedAt IS NOT NULL')
                .andWhere('o.orderPlacedAt >= :cutoff', { cutoff })
                .getRawMany();
            for (const r of recent) {
                const n = Number(r === null || r === void 0 ? void 0 : r.cid);
                if (Number.isFinite(n))
                    recentConsumerIds.add(n);
            }
        }
        catch (e) {
            core_1.Logger.warn(`findSleepingCustomerIds recent-consumer query failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
        }
        const customerRepo = this.connection.getRepository(ctx, core_1.Customer);
        const rows = await customerRepo
            .createQueryBuilder('c')
            .innerJoin('c.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .select('c.id', 'id')
            .orderBy('c.id', 'ASC')
            .getRawMany();
        return rows
            .map(r => Number(r.id))
            .filter(id => Number.isFinite(id) && !recentConsumerIds.has(id))
            .slice(0, take);
    }
    /** E1 圈人预览：只数不发。 */
    async winBackPreviewCount(ctx, days) {
        return (await this.findSleepingCustomerIds(ctx, days, 5000)).length;
    }
    /**
     * E1 批量发放：圈人 → 逐人走 grantCouponIssue（RECALL 渠道留痕 + R4 七日防骚扰）→ 落批次留痕。
     * 单人失败不中断整批；结果逐人记录在批次 resultsJson，可查询。
     */
    async winBackGrant(ctx, templateId, days, notify) {
        const tpl = await this.findOneTemplate(ctx, templateId);
        if (!tpl) {
            throw new core_1.UserInputError(`CouponTemplate ${templateId} not found`);
        }
        if (!(0, coupon_channel_1.hasChannel)(tpl, false, 'GRANT')) {
            throw new core_1.UserInputError('Coupon is not available for targeted grant');
        }
        const ids = await this.findSleepingCustomerIds(ctx, days, 500);
        const results = await this.grantCouponIssue(ctx, templateId, ids, notify, {
            issuedBy: 'RECALL',
            recentIssuedDays: 7,
        });
        const issuedCount = results.filter(r => r.ok).length;
        const batch = await this.connection.getRepository(ctx, coupon_grant_batch_entity_1.CouponGrantBatch).save(new coupon_grant_batch_entity_1.CouponGrantBatch({
            channelId: ctx.channelId,
            templateId: tpl.id,
            days: Math.max(1, days),
            totalSelected: ids.length,
            issuedCount,
            skippedCount: results.length - issuedCount,
            resultsJson: JSON.stringify(results),
            operator: ctx.activeUserId ? String(ctx.activeUserId) : null,
            notified: notify,
        }));
        core_1.Logger.info(`winBackGrant: batch#${batch.id} template=${templateId} days=${days} selected=${ids.length} issued=${issuedCount}`, constants_1.loggerCtx);
        return batch;
    }
    /** E1 批次查询（结果可查询）：本渠道倒序。 */
    async listGrantBatches(ctx, take = 20) {
        return this.connection
            .getRepository(ctx, coupon_grant_batch_entity_1.CouponGrantBatch)
            .createQueryBuilder('b')
            .where('b.channelId = :channelId', { channelId: ctx.channelId })
            .orderBy('b.id', 'DESC')
            .take(take)
            .getMany();
    }
    async revokeCoupon(ctx, id) {
        var _a;
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const cc = await repo.findOne({ where: { id: id }, relations: { template: true } });
        if (!cc) {
            throw new core_1.UserInputError(`CustomerCoupon ${id} not found`);
        }
        // 属店隔离：revoke 针对券实例，按其所关联券模板的发行店校验归属。
        await this.assertManagedByShop(ctx, (_a = cc.template) === null || _a === void 0 ? void 0 : _a.shopId);
        // INVALID = admin 撤销作废（未用券）：USED 券已参与核销/结算，不能静默忽略，直接明确拒绝；
        // UNUSED/RETURNED/EXPIRED 可作废（与出售单退款回收券的 invalidateCoupons 口径一致）。
        if (cc.status === 'USED') {
            throw new core_1.UserInputError('Coupon has been used and cannot be revoked');
        }
        if (cc.status !== 'INVALID') {
            cc.status = 'INVALID';
            await repo.save(cc);
        }
        return cc;
    }
    /* ------------------------- 过期落库（EXPIRED） ------------------------- */
    /**
     * 惰性 EXPIRED 落库：把已越界（expiredAt <= now）但仍为 UNUSED/RETURNED 的券置为 EXPIRED。
     * 单语句条件 UPDATE，原子且幂等：条件含 `status IN ('UNUSED','RETURNED')` → 天然不会覆盖
     * USED/INVALID；已 EXPIRED 不在条件内 → 多次执行不受影响。返回受影响行数（便于观测/测试）。
     * customerId 省略时全量（供定时清扫），否则仅转化该用户（用户路径）。
     */
    async expireDueCoupons(ctx, customerId) {
        var _a;
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const qb = repo
            .createQueryBuilder()
            .update()
            .set({ status: 'EXPIRED' })
            .where("status IN ('UNUSED','RETURNED')")
            .andWhere('expiredAt IS NOT NULL')
            .andWhere('expiredAt <= :now', { now: new Date() });
        if (customerId != null) {
            qb.andWhere('customerId = :customerId', { customerId });
        }
        const result = await qb.execute();
        return (_a = result.affected) !== null && _a !== void 0 ? _a : 0;
    }
    /** 全量清扫（定时任务用）：rawConnection + 无 ctx，Replica 直连；幂等。 */
    async expireDueCouponsAll() {
        var _a;
        const repo = this.connection.rawConnection.getRepository(customer_coupon_entity_1.CustomerCoupon);
        const result = await repo
            .createQueryBuilder()
            .update()
            .set({ status: 'EXPIRED' })
            .where("status IN ('UNUSED','RETURNED')")
            .andWhere('expiredAt IS NOT NULL')
            .andWhere('expiredAt <= :now', { now: new Date() })
            .execute();
        return (_a = result.affected) !== null && _a !== void 0 ? _a : 0;
    }
    /* ------------------------- 结算选券 / 清券 ------------------------- */
    async applyCouponToOrder(ctx, orderId, code) {
        var _a, _b, _c, _d, _e;
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'customer.user',
            'lines',
            'lines.productVariant',
            'lines.productVariant.product',
        ]);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        // 归属校验：order.customer.user.id === ctx.activeUserId（勿用 customer.id）
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== ctx.activeUserId) {
            throw new core_1.UserInputError('You can only apply coupons to your own order');
        }
        const customerId = (_c = order === null || order === void 0 ? void 0 : order.customer) === null || _c === void 0 ? void 0 : _c.id;
        if (!customerId) {
            throw new core_1.UserInputError('Order has no customer');
        }
        const ccRepo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const cc = await ccRepo.findOne({
            where: { code },
            relations: { template: true },
        });
        if (!cc || cc.customerId !== customerId) {
            throw new core_1.UserInputError('Coupon not found or does not belong to you');
        }
        // 实例级过期：过期（expiredAt）先落库 EXPIRED 再拒绝。
        // 注意：模板 endsAt 可能晚于实例 expiredAt（validDays 券），故须单独校验实例快照。
        const nowCc = new Date();
        if (cc.expiredAt && nowCc > cc.expiredAt) {
            if (cc.status === 'UNUSED' || cc.status === 'RETURNED') {
                cc.status = 'EXPIRED';
                await ccRepo.save(cc);
            }
            throw new core_1.UserInputError('Coupon has expired');
        }
        // UNUSED / RETURNED（取消回退后可复用）可被选定
        if (cc.status !== 'UNUSED' && cc.status !== 'RETURNED') {
            throw new core_1.UserInputError('Coupon is not in a usable state');
        }
        const tpl = cc.template;
        if (!tpl) {
            throw new core_1.UserInputError('Coupon template not found');
        }
        const now = new Date();
        if (!tpl.enabled) {
            throw new core_1.UserInputError('Coupon template is disabled');
        }
        if (tpl.startsAt && now < tpl.startsAt) {
            throw new core_1.UserInputError('Coupon not yet active');
        }
        if (tpl.endsAt && now > tpl.endsAt) {
            throw new core_1.UserInputError('Coupon has expired');
        }
        // 跨渠道范围校验 + 本店商品行基数（默认商城：仅本店行参与门槛/折扣；非默认商城整单）。
        const tplShopId = tpl.shopId;
        // 会员等级门槛（P2）
        await this.assertCouponMemberLevel(ctx, customerId, tpl);
        const lines = ((_d = order === null || order === void 0 ? void 0 : order.lines) !== null && _d !== void 0 ? _d : []);
        const eligibleLines = (0, coupon_scope_1.isDefaultMallChannel)(ctx)
            ? lines.filter(l => (0, coupon_scope_1.lineHasShopId)(l, tplShopId))
            : lines;
        if ((0, coupon_scope_1.isDefaultMallChannel)(ctx) && eligibleLines.length === 0) {
            throw new core_1.UserInputError('COUPON_SCOPE_MISMATCH');
        }
        const base = (ctx.channel.pricesIncludeTax
            ? eligibleLines.reduce((s, l) => { var _a; return s + ((_a = l.linePriceWithTax) !== null && _a !== void 0 ? _a : 0); }, 0)
            : eligibleLines.reduce((s, l) => { var _a; return s + ((_a = l.linePrice) !== null && _a !== void 0 ? _a : 0); }, 0));
        if (tpl.minSpend > base) {
            throw new core_1.UserInputError(`Order total below minimum spend of ${tpl.minSpend} for this coupon`);
        }
        // 一单一券：先清旧再覆写，随后重算 promotions
        const updatedOrder = await this.orderService.updateCustomFields(ctx, orderId, {
            couponCode: cc.code,
            couponId: cc.id,
        });
        // 确保传给 promotions 重算的订单在其 OrderLine 上带 productVariant.product，
        // 以便 coupon_applied 条件读取 Product.customFields.shopId 做行级范围判定。
        for (const line of (_e = updatedOrder === null || updatedOrder === void 0 ? void 0 : updatedOrder.lines) !== null && _e !== void 0 ? _e : []) {
            const matched = (lines !== null && lines !== void 0 ? lines : []).find(l => String(l.id) === String(line.id));
            if (matched && (line.productVariant == null || !line.productVariant.product)) {
                line.productVariant = matched.productVariant;
            }
        }
        return this.orderService.applyPriceAdjustments(ctx, updatedOrder);
    }
    async clearCouponFromOrder(ctx, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== ctx.activeUserId) {
            throw new core_1.UserInputError('You can only clear coupons on your own order');
        }
        const updatedOrder = await this.orderService.updateCustomFields(ctx, orderId, {
            couponCode: null,
            couponId: null,
        });
        return this.orderService.applyPriceAdjustments(ctx, updatedOrder);
    }
    /* ------------------------- 销核 / 回退（事件触发） ------------------------- */
    /** 支付成功后核销券 */
    async bindAsUsed(ctx, orderId) {
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const code = await this.orderCode(ctx, orderId);
        if (!code)
            return;
        const cc = await repo.findOne({ where: { code } });
        if (!cc || cc.status !== 'UNUSED')
            return;
        cc.status = 'USED';
        cc.usedOrderId = orderId;
        cc.usedAt = new Date();
        await repo.save(cc);
        core_1.Logger.info(`Coupon ${code} marked as USED on order ${orderId}`, constants_1.loggerCtx);
    }
    /** 订单取消回退券（可复用） */
    async returnCoupon(ctx, orderId) {
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        const code = await this.orderCode(ctx, orderId);
        if (!code)
            return;
        const cc = await repo.findOne({ where: { code } });
        if (!cc || cc.status !== 'USED')
            return;
        if (String(cc.usedOrderId) !== String(orderId))
            return; // 幂等
        cc.status = 'RETURNED';
        // TypeORM 对 undefined 不作为变更持久化，清理可空列必须显式置 null
        cc.usedOrderId = null;
        cc.usedAt = null;
        await repo.save(cc);
        core_1.Logger.info(`Coupon ${code} returned on order ${orderId} cancellation`, constants_1.loggerCtx);
    }
    /**
     * A3（coupon.md §8 A1/A3）：整单全额退款后回退券。
     * Vendure 订单无 "Refunded" 态，退款由 Refund 实体走独立状态机到 "Settled"；
     * 故按「该订单累计已 Settled 的退款额 >= 应付总额（totalWithTax）」判定为整单退完，
     * 触发 returnCoupon 回退。部分退（未达全额）不触发。幂等由 returnCoupon 保证。
     */
    async returnCouponOnFullRefund(ctx, refundId) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, core_1.Refund);
        // Refund 仅关联 Payment，订单经 Payment.order 中转
        const refund = await repo
            .createQueryBuilder('r')
            .leftJoinAndSelect('r.payment', 'p')
            .leftJoinAndSelect('p.order', 'o')
            .where('r.id = :id', { id: String(refundId) })
            .getOne();
        const order = (_a = refund === null || refund === void 0 ? void 0 : refund.payment) === null || _a === void 0 ? void 0 : _a.order;
        if (!order)
            return;
        const settled = await repo
            .createQueryBuilder('r')
            .innerJoin('r.payment', 'p')
            .innerJoin('p.order', 'o')
            .where('o.id = :oid', { oid: String(order.id) })
            .andWhere('r.state = :st', { st: 'Settled' })
            .getMany();
        const totalRefunded = (settled !== null && settled !== void 0 ? settled : []).reduce((s, r) => { var _a; return s + Number((_a = r.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        if (Number((_b = order.totalWithTax) !== null && _b !== void 0 ? _b : 0) <= totalRefunded) {
            await this.returnCoupon(ctx, order.id);
        }
    }
    /* ------------------------- 私有工具 ------------------------- */
    /**
     * 归属解析：activeUserId → Administrator.user → Shop.administratorId（与 shop-plugin 同法，不依赖 ctx.channelId）。
     * 若连接未注册 Shop 实体（shop-plugin 未加载）或 admin 无法解析，则回退为 undefined（不阻断）。
     *
     * 公开（public）：供 CouponAdminResolver 等鉴权调用点复用，避免在 service 内重复实现。
     * 保持签名兼容，Task B 既有的私有调用不受影响。
     */
    async resolveShopIdFromActiveUser(ctx, userId) {
        try {
            if (userId == null)
                return undefined;
            const adminRepo = this.connection.getRepository(ctx, core_1.Administrator);
            const admin = await adminRepo.findOne({
                where: { user: { id: userId } },
                select: { id: true },
            });
            if (!admin || admin.id == null)
                return undefined;
            const ShopClass = this.findEntityClass('Shop');
            if (!ShopClass)
                return undefined;
            const shopRepo = this.connection.getRepository(ctx, ShopClass);
            const shop = await shopRepo.findOne({ where: { administratorId: admin.id } });
            return shop === null || shop === void 0 ? void 0 : shop.id;
        }
        catch (_a) {
            // Shop / Administrator 等可选依赖未注册或查询失败 → 保持未设 shopId
            return undefined;
        }
    }
    /**
     * 原则：超级管理员（无属店 Shop）可管理全部券；属店管理员只能管理「平台级券（shopId 为空）
     * + 本店发行的券」，其余一率抛 ForbiddenError(COUPON_NOT_OWNED)。
     * 供 resolver 与列表过滤复用。
     */
    async assertManagedByShop(ctx, targetShopId) {
        const adminShopId = await this.resolveShopIdFromActiveUser(ctx, ctx.activeUserId);
        // 当前管理员无属店（超级管理员）→ 全量允许
        if (adminShopId == null)
            return;
        const target = targetShopId != null ? Number(targetShopId) : undefined;
        // 目标券无属店（平台级券）→ 允许本地化运营管理；本店券 → 允许；他店券 → 拒绝。
        if (target != null && target !== adminShopId) {
            throw new CouponNotOwnedError();
        }
    }
    /** 按实体名称从连接元数据中取回实体类（用于在插件未直接依赖 Shop 时安全解析）。 */
    findEntityClass(name) {
        try {
            const meta = this.connection.rawConnection.entityMetadatas.find(m => m.name === name);
            return meta ? meta.target : undefined;
        }
        catch (_a) {
            return undefined;
        }
    }
    async orderCode(_ctx, orderId) {
        var _a, _b;
        // 用户券销核/回退时，从订单 customFields 读券码
        const order = await this.orderService.findOne(_ctx, orderId);
        return (_b = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.couponCode) !== null && _b !== void 0 ? _b : undefined;
    }
    async currentCustomerId(ctx) {
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer === null || customer === void 0 ? void 0 : customer.id;
    }
    async countHeld(customerId, templateId, now = new Date()) {
        // 未跑在具体 ctx 内，用原始连接
        const nowISO = now.toISOString();
        const countRepo = this.connection.rawConnection.getRepository(customer_coupon_entity_1.CustomerCoupon);
        return countRepo
            .createQueryBuilder('cc')
            .where('cc.customerId = :customerId', { customerId })
            .andWhere('cc.templateId = :templateId', { templateId: templateId })
            .andWhere("cc.status IN ('UNUSED','RETURNED')")
            .andWhere('(cc.expiredAt IS NULL OR cc.expiredAt > :now)', { now: nowISO })
            .getCount();
    }
    /** 原子扣减发行余量；受影响数大于 0 表示成功 */
    async atomicIncrementClaimed(ctx, templateId, tpl) {
        var _a;
        const repo = this.connection.getRepository(ctx, coupon_template_entity_1.CouponTemplate);
        const result = await repo
            .createQueryBuilder()
            .update()
            .set({ claimedCount: () => 'claimedCount + 1' })
            .where('id = :id AND (totalCount = 0 OR claimedCount < totalCount)', { id: templateId })
            .execute();
        return ((_a = result.affected) !== null && _a !== void 0 ? _a : 0) > 0;
    }
    /** 新客判定：本租户是否已有历史有效订单（排除创建/购物车/待支付/修改/取消等未完成态） */
    async hasPlacedOrder(ctx, customerId) {
        return !(await (0, coupon_settlement_1.isNewCustomerWithinChannel)(ctx, customerId));
    }
    /* ---------------- FR-C 裂变 / FR-D 新客购 / E2 等级券 共用判定 ---------------- */
    /**
     * 新客综合判定（FR-D/FR-C 口径）：本租户无历史有效订单 且 未持有过新客券
     * （UNUSED/RETURNED/USED 任一状态的新客券均计「已持」，防 1 元购复购绕过）。
     */
    async isCampaignNewCustomer(ctx, customerId) {
        if (await this.hasPlacedOrder(ctx, customerId))
            return false;
        return !(await this.holdsNewCustomerCoupon(ctx, customerId));
    }
    /** 是否持有过新客券（newCustomerOnly 模板发放的券，未作废即计）。 */
    async holdsNewCustomerCoupon(ctx, customerId) {
        const count = await this.connection
            .getRepository(ctx, customer_coupon_entity_1.CustomerCoupon)
            .createQueryBuilder('cc')
            .innerJoin('cc.template', 'tpl')
            .where('cc.customerId = :customerId', { customerId })
            .andWhere('tpl.newCustomerOnly = :nco', { nco: true })
            .andWhere("cc.status IN ('UNUSED','RETURNED','USED')")
            .getCount();
        return count > 0;
    }
    /**
     * 购买/加价购侧硬拦（FR-D）：新客券要求「综合新客 + 每人限购 1 张（PAID 出售单计）」；
     * E2：配置会员等级门槛的券，不达标不可购（可见性过滤之外的第二道防线）。
     */
    async assertCustomerCanBuy(ctx, customerId, tpl) {
        if (tpl.newCustomerOnly) {
            if (!(await this.isCampaignNewCustomer(ctx, customerId))) {
                throw new core_1.UserInputError('Coupon is for new customers only');
            }
            const bought = await this.connection
                .getRepository(ctx, coupon_sale_order_entity_1.CouponSaleOrder)
                .createQueryBuilder('s')
                .where('s.customerId = :customerId', { customerId })
                .andWhere('s.templateId = :templateId', { templateId: tpl.id })
                .andWhere("s.status IN ('PAID','PENDING')")
                .getCount();
            if (bought > 0) {
                throw new core_1.UserInputError('Per-user purchase limit reached');
            }
        }
        await this.assertCouponMemberLevel(ctx, customerId, tpl);
    }
    /**
     * FR-F 通用领取前校门面（每日领券/神券日/支付有礼共用）：
     * 模板 perUserLimit（持有有效张数口径）+ 会员等级门槛（E2）。
     * 返回拦截原因（PER_USER_LIMIT / MEMBER_LEVEL_BLOCKED）或 null（可领）。
     */
    async assertCustomerCanClaim(ctx, customerId, tpl) {
        if (tpl.perUserLimit > 0) {
            const owned = await this.countHeld(customerId, tpl.id);
            if (owned >= tpl.perUserLimit) {
                return 'PER_USER_LIMIT';
            }
        }
        if (!(await this.couponMeetsMemberLevel(ctx, customerId, tpl))) {
            return 'MEMBER_LEVEL_BLOCKED';
        }
        return null;
    }
    /** 程序化发放公共入口（FR-C 裂变）：原子扣发行余量 + 建券（R2 计入限量 / R1 issuedBy 渠道留痕）。 */
    async issueForProgram(ctx, customerId, tpl, issuedBy) {
        const ok = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
        if (!ok) {
            throw new core_1.UserInputError('Coupon sold out');
        }
        return this.createUserCoupon(ctx, customerId, tpl, issuedBy);
    }
    /**
     * E2 会员等级可见性过滤：配置等级门槛的券仅该等级及以上可见；无等级数据按 1 档（非会员）。
     * 全部模板无门槛（或仅 1 档）时跳过等级查询，零额外 IO。
     * （saleCatalogue 等目录服务也会调用，故 public。）
     */
    async filterByMemberLevelVisibility(ctx, list) {
        var _a;
        const required = await Promise.all(list.map(async (t) => ({ t, lv: await this.resolveRequiredMemberLevel(t.memberLevel) })));
        const maxRequired = required.reduce((m, r) => { var _a; return Math.max(m, (_a = r.lv) !== null && _a !== void 0 ? _a : 0); }, 0);
        if (maxRequired <= 1)
            return list;
        const customerId = await this.currentCustomerId(ctx);
        let level = 1; // 匿名 / 无等级数据 → 非会员
        if (customerId && this.memberLevelService) {
            const tier = await this.memberLevelService.resolveTierForCustomer(ctx, customerId);
            level = (_a = tier === null || tier === void 0 ? void 0 : tier.tierLevel) !== null && _a !== void 0 ? _a : 1;
        }
        return required.filter(r => { var _a; return ((_a = r.lv) !== null && _a !== void 0 ? _a : 0) <= level; }).map(r => r.t);
    }
    /**
     * 出售发券桥接：复用发券不变量（原子扣余量 → 建券并记录出售单溯源）。
     * 券包逐张调用本方法，任一张售罄即抛错，由调用方事务回滚整包。
     */
    async issueForSale(ctx, customerId, tpl, saleOrderId) {
        const ok = await this.atomicIncrementClaimed(ctx, tpl.id, tpl);
        if (!ok) {
            throw new core_1.UserInputError('Coupon sold out');
        }
        return this.createUserCoupon(ctx, customerId, tpl, 'SALE', saleOrderId);
    }
    async createUserCoupon(ctx, customerId, tpl, issuedBy, saleOrderId) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, customer_coupon_entity_1.CustomerCoupon);
        // 重试兜底唯一码冲突（碰撞概率极低）
        for (let attempt = 0; attempt < 3; attempt++) {
            const code = generateCode(this.codePrefix);
            const cc = new customer_coupon_entity_1.CustomerCoupon({
                customerId,
                templateId: tpl.id,
                code,
                status: 'UNUSED',
                issuedBy,
                issuedAt: new Date(),
                // validDays 券按领取时刻起算过期时间；否则快照模板固定 endsAt
                expiredAt: tpl.validDays ? new Date(Date.now() + tpl.validDays * 86400000) : ((_a = tpl.endsAt) !== null && _a !== void 0 ? _a : undefined),
                saleOrderId: saleOrderId !== null && saleOrderId !== void 0 ? saleOrderId : null,
            });
            try {
                return await repo.save(cc);
            }
            catch (e) {
                if (String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : '').includes('unique'))
                    continue;
                throw e;
            }
        }
        throw new core_1.UserInputError('Failed to generate a unique coupon code');
    }
};
exports.CouponService = CouponService;
exports.CouponService = CouponService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder,
        coupon_binding_service_1.CouponBindingService])
], CouponService);
//# sourceMappingURL=coupon.service.js.map