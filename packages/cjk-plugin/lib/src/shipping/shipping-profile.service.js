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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShippingProfileService = void 0;
exports.assertProfileGlobalPermissions = assertProfileGlobalPermissions;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const shipping_profile_entity_1 = require("./shipping-profile.entity");
const shipping_profile_method_entity_1 = require("./shipping-profile-method.entity");
const delivery_capability_1 = require("./delivery-capability");
const pickup_location_entity_1 = require("../pickup/pickup-location.entity");
const pickup_location_service_1 = require("../pickup/pickup-location.service");
const payment_profile_service_1 = require("../payment/payment-profile.service");
const list_sort_1 = require("../common/list-sort");
let ShippingProfileService = class ShippingProfileService {
    constructor(connection, pickupLocationService, paymentProfileService) {
        this.connection = connection;
        this.pickupLocationService = pickupLocationService;
        this.paymentProfileService = paymentProfileService;
    }
    async findAll(ctx, options) {
        var _a, _b;
        const qb = this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.shippingMethods', 'sm')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('(sp.isGlobal = :isGlobal OR sp.ownerChannelId = :channelId)', {
            isGlobal: true,
            channelId: ctx.channelId,
        });
        if ((_b = (_a = options === null || options === void 0 ? void 0 : options.filter) === null || _a === void 0 ? void 0 : _a.name) === null || _b === void 0 ? void 0 : _b.contains) {
            qb.andWhere('sp.name LIKE :name', { name: `%${options.filter.name.contains}%` });
        }
        (0, list_sort_1.applyListSort)(qb, 'sp', options === null || options === void 0 ? void 0 : options.sort, ['name', 'createdAt', 'updatedAt']);
        const skip = (options === null || options === void 0 ? void 0 : options.skip) || 0;
        const take = (options === null || options === void 0 ? void 0 : options.take) || 10;
        qb.skip(skip).take(take);
        const [items, totalItems] = await qb.getManyAndCount();
        await this.attachMethodConfigs(ctx, items);
        await this.attachBoundPickupLocations(ctx, items);
        return { items, totalItems };
    }
    async findOne(ctx, id) {
        const result = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .findOne({ where: { id: id }, relations: ['shippingMethods', 'pickupLocations'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod)
                .find({ where: { profileId: String(result.id) } });
            result.methodConfigs = methodConfigs;
            await this.attachBoundPickupLocations(ctx, [result]);
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    async findByCode(ctx, code) {
        const result = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .findOne({ where: { code }, relations: ['shippingMethods', 'pickupLocations'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod)
                .find({ where: { profileId: String(result.id) } });
            result.methodConfigs = methodConfigs;
            await this.attachBoundPickupLocations(ctx, [result]);
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    async create(ctx, input) {
        var _a, _b, _c, _d, _e;
        if (!((_a = input.shippingMethodIds) === null || _a === void 0 ? void 0 : _a.length)) {
            throw new core_1.UserInputError('配送档案至少需要选择一种配送方式');
        }
        assertProfileGlobalPermissions(ctx, 'create', undefined, input, { isGlobal: input.isGlobal === true });
        const repo = this.connection.getRepository(ctx, shipping_profile_entity_1.ShippingProfile);
        const profile = new shipping_profile_entity_1.ShippingProfile(input);
        profile.channels = [ctx.channel];
        profile.ownerChannelId = input.isGlobal ? null : ctx.channelId;
        profile.isGlobal = (_b = input.isGlobal) !== null && _b !== void 0 ? _b : false;
        if ((_c = input.shippingMethodIds) === null || _c === void 0 ? void 0 : _c.length) {
            profile.shippingMethods = input.shippingMethodIds.map((id) => ({ id }));
        }
        // pickupLocations: undefined=不变, []=清空, [ids]=设置
        if (input.pickupLocationIds !== undefined) {
            profile.pickupLocations = input.pickupLocationIds.map((id) => ({ id }));
        }
        // paymentProfileId: 可为空，允许不绑定（回退租户默认支付档案）
        if (input.paymentProfileId !== undefined) {
            profile.paymentProfileId = (_d = input.paymentProfileId) !== null && _d !== void 0 ? _d : null;
        }
        await repo.save(profile);
        if ((_e = input.methodConfigs) === null || _e === void 0 ? void 0 : _e.length) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        // 走 findOne 返回：它只额外挂 methodConfigs / boundPickupLocations，
        // 这两个字段在 SDL 是非空，直接返回裸实体会让整个 mutation 报错（data: null）
        return (await this.findOne(ctx, profile.id));
    }
    async update(ctx, input) {
        var _a;
        const repo = this.connection.getRepository(ctx, shipping_profile_entity_1.ShippingProfile);
        const profile = await repo.findOne({
            where: { id: input.id },
            relations: ['shippingMethods', 'pickupLocations'],
        });
        if (!profile)
            throw new core_1.EntityNotFoundError('ShippingProfile', input.id);
        assertProfileGlobalPermissions(ctx, 'update', profile, input, profile);
        if (profile.isGlobal && !ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            throw new core_1.UserInputError('不能修改全局档案');
        }
        if (input.shippingMethodIds !== undefined) {
            if (input.shippingMethodIds.length === 0) {
                throw new core_1.UserInputError('配送档案至少需要选择一种配送方式');
            }
            profile.shippingMethods = input.shippingMethodIds.map((id) => ({ id }));
        }
        if (input.pickupLocationIds !== undefined) {
            profile.pickupLocations = input.pickupLocationIds.map((id) => ({ id }));
        }
        const { id, shippingMethodIds, pickupLocationIds } = input, updateData = __rest(input, ["id", "shippingMethodIds", "pickupLocationIds"]);
        // 超管切换 isGlobal 时维护归属与租户默认一致性
        if (input.isGlobal === true) {
            profile.ownerChannelId = null;
            profile.isTenantDefault = false;
        }
        else if (input.isGlobal === false) {
            profile.ownerChannelId = (_a = ctx.channelId) !== null && _a !== void 0 ? _a : null;
        }
        Object.assign(profile, updateData);
        await repo.save(profile);
        if (input.methodConfigs !== undefined) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        // 走 findOne 返回：它只额外挂 methodConfigs / boundPickupLocations，
        // 这两个字段在 SDL 是非空，直接返回裸实体会让整个 mutation 报错（data: null）
        return (await this.findOne(ctx, input.id));
    }
    async delete(ctx, id) {
        var _a;
        const repo = this.connection.getRepository(ctx, shipping_profile_entity_1.ShippingProfile);
        const result = await repo.manager.query(`SELECT COUNT(*) as count FROM product_variant WHERE "customFieldsShippingprofileid" = $1`, [String(id)]);
        const count = parseInt(((_a = result === null || result === void 0 ? void 0 : result[0]) === null || _a === void 0 ? void 0 : _a.count) || '0', 10);
        if (count > 0) {
            throw new core_1.UserInputError(`有 ${count} 个商品引用此档案，请先重新分配`);
        }
        const profile = await repo.findOne({ where: { id: id } });
        if (!profile)
            throw new core_1.EntityNotFoundError('ShippingProfile', id);
        assertProfileGlobalPermissions(ctx, 'delete', profile, undefined, profile);
        const jmRepo = this.connection.getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod);
        await jmRepo.delete({ profileId: String(id) });
        await repo.remove(profile);
    }
    async assignToVariants(ctx, variantIds, profileId) {
        const profile = await this.findOne(ctx, profileId);
        if (!profile)
            throw new core_1.EntityNotFoundError('ShippingProfile', profileId);
        const repo = this.connection.getRepository(ctx, 'ProductVariant');
        const ids = variantIds.map(id => Number(id));
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        await repo.manager.query(`UPDATE product_variant SET "customFieldsShippingprofileid" = $1 WHERE id IN (${placeholders})`, [String(profileId), ...ids]);
    }
    async getIntersectedShippingMethods(ctx, profileIds) {
        var _a;
        if (profileIds.length === 0)
            return [];
        if (profileIds.length === 1) {
            const profile = await this.findOne(ctx, profileIds[0]);
            return ((_a = profile === null || profile === void 0 ? void 0 : profile.shippingMethods) !== null && _a !== void 0 ? _a : []).map(sm => ({ id: sm.id, code: sm.code }));
        }
        const qb = this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .innerJoin('sp.shippingMethods', 'sm')
            .select('sm.id', 'id')
            .addSelect('sm.code', 'code')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .groupBy('sm.id')
            .addGroupBy('sm.code')
            .having('COUNT(DISTINCT sp.id) = :count', { count: profileIds.length });
        return qb.getRawMany();
    }
    /**
     * 按交集 id 查询完整 ShippingMethod 实体（供 Shop API 返回完整字段）
     * ShippingMethod 是 translatable 实体，需 join translations 加载 name
     */
    async findShippingMethodsByIds(ctx, ids) {
        if (ids.length === 0)
            return [];
        return this.connection
            .getRepository(ctx, 'ShippingMethod')
            .createQueryBuilder('sm')
            .leftJoinAndSelect('sm.translations', 't')
            .where('sm.id IN (:...ids)', { ids })
            .getMany();
    }
    /**
     * 获取多个 Profile 的自提点交集。
     * 规则：
     * - 任一 Profile 的 pickupLocations 为空（未约束）→ 视为该 Profile 不约束，跳过
     * - 所有约束了的 Profile 的 pickupLocations 取交集
     * - 若所有 Profile 都未约束，返回 null（表示不限制，前端展示全部自提点）
     * - 若交集为空但至少有一个约束，返回 []（表示无可用自提点）
     */
    async getIntersectedPickupLocations(ctx, profileIds) {
        if (profileIds.length === 0)
            return null;
        const profiles = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getMany();
        // 按 Profile 分组：约束了的 vs 未约束的
        const constrained = profiles.filter(p => { var _a, _b; return ((_b = (_a = p.pickupLocations) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0; });
        if (constrained.length === 0)
            return null; // 全部未约束
        // 取交集
        let intersection = new Set(constrained[0].pickupLocations.map(pl => pl.id));
        for (let i = 1; i < constrained.length; i++) {
            const current = new Set(constrained[i].pickupLocations.map(pl => pl.id));
            intersection = new Set([...intersection].filter(x => current.has(x)));
        }
        return [...intersection];
    }
    /**
     * 结合 per-method config 的自提点取 Profile 交集。
     * 规则：Profile 的 methodConfigs 中有 pickup 类 mode（pickup/store/employee）且带自提点范围时，
     * 以其 config 中的自提点作为该 Profile 的约束；否则回退到档案级 pickupLocations。
     * 其余语义与 getIntersectedPickupLocations 一致：
     * - 全部未约束 → null；有约束但交集为空 → []。
     */
    async getIntersectedPickupLocationsWithConfig(ctx, profileIds) {
        var _a;
        if (profileIds.length === 0)
            return null;
        const profiles = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getMany();
        const effectiveByProfile = [];
        for (const profile of profiles) {
            const configs = await this.getMethodConfigsByProfile(ctx, profile.id);
            const pickupEffective = [];
            for (const c of configs) {
                if (!this.isPickupMode(c.mode))
                    continue;
                const ids = await this.getEffectivePickupIdsForConfig(ctx, c);
                pickupEffective.push(...ids);
            }
            const effective = pickupEffective.length > 0
                ? pickupEffective
                : ((_a = profile.pickupLocations) !== null && _a !== void 0 ? _a : []).map(pl => pl.id);
            effectiveByProfile.push(effective);
        }
        const constrained = effectiveByProfile.filter(ids => ids.length > 0);
        if (constrained.length === 0)
            return null; // 全部未约束
        let intersection = new Set(constrained[0]);
        for (let i = 1; i < constrained.length; i++) {
            const current = new Set(constrained[i]);
            intersection = new Set([...intersection].filter(x => current.has(x)));
        }
        return [...intersection];
    }
    /**
     * 查询是否任一 Profile 约束了自提点。
     * 前端用此区分 eligiblePickupLocationsByProfile 返回 [] 的两种情况：
     * - false → 未约束，前端展示全部自提点
     * - true  → 约束了但交集为空，前端展示"无可用自提点"
     */
    async hasPickupLocationConstraint(ctx, profileIds) {
        if (profileIds.length === 0)
            return false;
        // 任一 Profile 级 pickupLocations 非空即为约束
        const count = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .innerJoin('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getCount();
        if (count > 0)
            return true;
        // 任一 pickup 方式 config 携带自提点范围（rangeMode='all' 或 pickupLocationIds）亦为约束
        for (const pid of profileIds) {
            const configs = await this.getMethodConfigsByProfile(ctx, pid);
            const constrained = configs.some(c => {
                var _a, _b, _c, _d;
                return this.isPickupMode(c.mode) &&
                    (((_a = c.options) === null || _a === void 0 ? void 0 : _a.rangeMode) === 'all' || ((_d = (_c = (_b = c.options) === null || _b === void 0 ? void 0 : _b.pickupLocationIds) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0);
            });
            if (constrained)
                return true;
        }
        return false;
    }
    /**
     * 方式 mode → 自提点实体类型映射：
     * - pickup → point
     * - store  → store
     * - employee → employee
     */
    pickupTypeByMode(mode) {
        switch (mode) {
            case 'store': return 'store';
            case 'employee': return 'employee';
            case 'pickup':
            default:
                return 'point';
        }
    }
    /**
     * pickup 类 mode 判定（C 端解析/交集门控用）：
     * 'pickup'(自提点) / 'store'(门店自提) / 'employee'(职工单位) 均视为自提方式，
     * 仅 'mail' 为邮寄。
     */
    isPickupMode(mode) {
        return mode === 'pickup' || mode === 'store' || mode === 'employee';
    }
    /**
     * 自提类计算器判定（门店自提/自提点/职工单位）。
     */
    isPickupCalculator(code) {
        return code === 'store-pickup-calculator' || code === 'pickup-point-calculator' || code === 'employee-pickup-calculator';
    }
    /**
     * 按配送方式计算器判定其自提点实体类型。
     * 门店自提/自提点/职工单位共用 mode='pickup' 之场景（历史前端默认值），
     * 必须以 calculator 为准，否则 store-pickup-calculator 会被误判成 'point'。
     * 非自提计算器返回 null（交由 pickupTypeByMode 回退）。
     */
    async pickupTypeForMethod(ctx, shippingMethodId) {
        var _a;
        if (shippingMethodId == null)
            return null;
        const sm = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { id: shippingMethodId } });
        const code = (_a = sm === null || sm === void 0 ? void 0 : sm.calculator) === null || _a === void 0 ? void 0 : _a.code;
        switch (code) {
            case 'store-pickup-calculator': return 'store';
            case 'pickup-point-calculator': return 'point';
            case 'employee-pickup-calculator': return 'employee';
            default: return null;
        }
    }
    /**
     * 计算箱的履约类型与候选自提点。
     * 箱型不能只看 profile.pickupLocations（新版前端把自提点放在方式级 methodConfig 里，
     * profile.pickupLocations 常为空），须按「档案可用配送方式是否为自提类」判定，
     * 否则门店自提/自提点/职工单位箱会被判成 delivery → C 端误显物理地址块。
     * pickupLocations = 档案级点 ∪ 各自提方式有效点（同城全部→渠道可见启用点，指定→方式限定点）。
     */
    async resolveBoxFulfilment(ctx, profile) {
        var _a, _b, _c, _d;
        const legacy = (_a = profile === null || profile === void 0 ? void 0 : profile.pickupLocations) !== null && _a !== void 0 ? _a : [];
        const methods = (_b = profile === null || profile === void 0 ? void 0 : profile.shippingMethods) !== null && _b !== void 0 ? _b : [];
        const cfgById = new Map();
        for (const c of ((_c = profile === null || profile === void 0 ? void 0 : profile.methodConfigs) !== null && _c !== void 0 ? _c : []))
            cfgById.set(String(c.shippingMethodId), c);
        const allPickup = methods.length > 0 &&
            methods.every((m) => {
                var _a;
                const cfg = cfgById.get(String(m.id));
                return (cfg && this.isPickupMode(cfg.mode)) || this.isPickupCalculator((_a = m.calculator) === null || _a === void 0 ? void 0 : _a.code);
            });
        const isPickup = legacy.length > 0 || allPickup;
        if (!isPickup)
            return { type: 'delivery', pickupLocations: [] };
        const idSet = new Set();
        for (const p of legacy)
            idSet.add(p.id);
        for (const m of methods) {
            const cfg = cfgById.get(String(m.id));
            if (!cfg)
                continue;
            if (this.isPickupMode(cfg.mode) || this.isPickupCalculator((_d = m.calculator) === null || _d === void 0 ? void 0 : _d.code)) {
                const eff = await this.getEffectivePickupIdsForConfig(ctx, cfg);
                eff.forEach(id => idSet.add(id));
            }
        }
        const out = [];
        if (idSet.size > 0) {
            const found = await this.pickupLocationService.findByIds(ctx, [...idSet]);
            const map = new Map(found.map(p => [String(p.id), p]));
            // 档案级绑定点同样过可见性/启用过滤（平台可见全量，租户仅公共+本租户）
            for (const p of legacy) {
                const f = map.get(String(p.id));
                if (f)
                    out.push(f);
            }
            for (const id of idSet) {
                const p = map.get(String(id));
                if (p && !out.some(x => String(x.id) === String(p.id)))
                    out.push(p);
            }
        }
        return { type: 'pickup', pickupLocations: out };
    }
    /**
     * 计算某一方式 config 的有效自提点 id 集合（shop 端透传 & 交集用）。
     * - options.rangeMode === 'all' → 动态聚合当前渠道可见的启用自提点，且仅取该方式对应类型
     *   （pickup→point）。city 来源不明确，采用"同 channel 的全部可见启用 point"聚合。
     * - 否则 → options.pickupLocationIds，并限定在对应类型内（pickup→point / store→store / employee→employee）。
     */
    async getEffectivePickupIdsForConfig(ctx, cfg) {
        var _a, _b, _c;
        if (!cfg || !this.isPickupMode(cfg.mode))
            return [];
        // 类型优先取配送方式计算器（门店自提/自提点/职工单位），历史 mode='pickup' 共用时以 calculator 为准
        const type = (_a = (await this.pickupTypeForMethod(ctx, cfg.shippingMethodId))) !== null && _a !== void 0 ? _a : this.pickupTypeByMode(cfg.mode);
        const options = (_b = cfg.options) !== null && _b !== void 0 ? _b : {};
        if (options.rangeMode === 'all') {
            return (await this.pickupLocationService.findByCityForChannel(ctx, null, type)).map(l => l.id);
        }
        const ids = (_c = options.pickupLocationIds) !== null && _c !== void 0 ? _c : [];
        if (ids.length === 0)
            return [];
        const locs = await this.pickupLocationService.findByIds(ctx, ids);
        return locs.filter(l => l.type === type).map(l => l.id);
    }
    async findPickupLocationsByIds(ctx, ids) {
        if (ids.length === 0)
            return [];
        return this.connection
            .getRepository(ctx, pickup_location_entity_1.PickupLocation)
            .findByIds(ids);
    }
    async replaceMethodConfigs(ctx, profileId, configs) {
        var _a, _b;
        const jmRepo = this.connection.getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod);
        await jmRepo.delete({ profileId: String(profileId) });
        for (const cfg of configs) {
            await jmRepo.save(new shipping_profile_method_entity_1.ShippingProfileMethod({
                profileId: String(profileId),
                shippingMethodId: String(cfg.shippingMethodId),
                mode: (_a = cfg.mode) !== null && _a !== void 0 ? _a : 'mail',
                options: (_b = cfg.options) !== null && _b !== void 0 ? _b : null,
            }));
        }
    }
    async setTenantDefault(ctx, id) {
        const repo = this.connection.getRepository(ctx, shipping_profile_entity_1.ShippingProfile);
        const profile = await repo.findOne({ where: { id: id } });
        if (!profile)
            throw new core_1.UserInputError('档案不存在');
        if (profile.isGlobal)
            throw new core_1.UserInputError('全局档案不能设为租户默认');
        await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder()
            .update()
            .set({ isTenantDefault: false })
            .where('"ownerChannelId" = :channelId AND "isGlobal" = false', { channelId: ctx.channelId })
            .execute();
        profile.isTenantDefault = true;
        await repo.save(profile);
    }
    async getTenantDefault(ctx) {
        const profile = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .findOne({
            where: { isGlobal: false, ownerChannelId: ctx.channelId, isTenantDefault: true, enabled: true },
            relations: ['shippingMethods', 'pickupLocations'],
        });
        return profile !== null && profile !== void 0 ? profile : undefined;
    }
    /**
     * 取配送档案绑定的支付档案；
     * 未绑定时回退到对应租户的默认支付档案（复用 PaymentProfileService.getTenantDefault）。
     */
    async getPaymentProfileForShippingProfile(ctx, shippingProfileId) {
        const profile = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .findOne({ where: { id: shippingProfileId }, relations: ['paymentProfile'] });
        if (profile === null || profile === void 0 ? void 0 : profile.paymentProfile)
            return profile.paymentProfile;
        return this.paymentProfileService.getTenantDefault(ctx);
    }
    /**
     * 解析变体绑定的档案集合（含默认回退）：
     * - 变体绑定的档案若已停用（enabled=false），视为未绑定，回退到租户默认档案；
     * - 回退命中（含租户默认）同样排除停用档案（见 getTenantDefault）；
     * - 返回去重后的有效档案 id 列表，供交集/匹配使用，保证停用档案不参与变体绑定匹配。
     */
    async resolveEffectiveProfileIds(ctx, profileIds) {
        var _a;
        const seen = new Set();
        const result = [];
        for (const pid of profileIds) {
            const profile = await this.findOne(ctx, pid);
            let effective = (profile === null || profile === void 0 ? void 0 : profile.enabled) === false
                ? (_a = (await this.getTenantDefault(ctx))) === null || _a === void 0 ? void 0 : _a.id
                : pid;
            if (effective == null)
                continue;
            const key = String(effective);
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push(effective);
        }
        return result;
    }
    async getMethodConfigsByProfile(ctx, profileId) {
        return this.connection
            .getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod)
            .find({ where: { profileId: String(profileId) } });
    }
    /**
     * 批量取多个档案的「有效方法行」（一次查询，避免逐档案查）。
     * 真实 ShippingProfileMethod 行优先；档案绑定了配送方式却缺行时按该方式的
     * 计算器推断 mode 补齐——行只在 web-admin 保存档案时写入，存量档案恒为空，
     * 不补则快递档案对能力派生完全不可见（口径同 resolveBoxFulfilment）。
     */
    async getEffectiveMethodConfigsByProfiles(ctx, profileIds) {
        var _a, _b, _c;
        const out = new Map();
        const ids = [...new Set(profileIds.map(id => String(id)))];
        if (ids.length === 0)
            return out;
        const rows = await this.connection
            .getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod)
            .find({ where: { profileId: (0, typeorm_1.In)(ids) } });
        for (const r of rows) {
            if (!out.has(r.profileId))
                out.set(r.profileId, []);
            out.get(r.profileId).push(r);
        }
        const profiles = await this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .find({ where: { id: (0, typeorm_1.In)(ids) }, relations: ['shippingMethods'] });
        for (const p of profiles) {
            const key = String(p.id);
            const existing = (_a = out.get(key)) !== null && _a !== void 0 ? _a : [];
            const covered = new Set(existing.map(c => String(c.shippingMethodId)));
            const filled = [...existing];
            for (const m of ((_b = p.shippingMethods) !== null && _b !== void 0 ? _b : [])) {
                if (covered.has(String(m.id)))
                    continue;
                filled.push(new shipping_profile_method_entity_1.ShippingProfileMethod({
                    profileId: key,
                    shippingMethodId: String(m.id),
                    mode: (0, delivery_capability_1.modeFromCalculatorCode)((_c = m.calculator) === null || _c === void 0 ? void 0 : _c.code),
                    options: null,
                }));
            }
            out.set(key, filled);
        }
        return out;
    }
    /** 本渠道内参与履约的全部生效档案（租户自有 + 全局），供渠道级能力并集使用 */
    async listEffectiveProfilesForChannel(ctx) {
        const qb = this.connection
            .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.shippingMethods', 'sm')
            .where('sp.enabled = :on', { on: true })
            .andWhere('(sp.isGlobal = :isGlobal OR sp.ownerChannelId = :channelId)', { isGlobal: true, channelId: ctx.channelId });
        return qb.getMany();
    }
    /**
     * 渠道级配送能力（并集）。
     * 若渠道内存在未绑定档案的变体，则并入租户默认档案的能力（与 computeOrderBoxes 的回退一致）。
     * 缺 method_configs 行的档案按绑定方式计算器推断补齐，否则快递档案不参与并集。
     * fallback：渠道内一个生效档案都没有 → 回退「两者都支持」，保持旧行为不误伤。
     */
    async getChannelDeliveryCapability(ctx) {
        var _a;
        const profiles = await this.listEffectiveProfilesForChannel(ctx);
        if (profiles.length === 0) {
            return { modes: ['MAIL', 'SELF_PICKUP'], bothSupported: true, source: 'fallback' };
        }
        const map = await this.getEffectiveMethodConfigsByProfiles(ctx, profiles.map(p => p.id));
        const perProfile = [...map.values()];
        const tenantDefault = await this.getTenantDefault(ctx);
        if (tenantDefault) {
            perProfile.push((_a = map.get(String(tenantDefault.id))) !== null && _a !== void 0 ? _a : []);
        }
        return (0, delivery_capability_1.unionCapability)(perProfile);
    }
    /**
     * 逐变体派生配送能力（含默认档案回退）。批量入参，档案方法行一次查出。
     * 回退语义与 OrderBoxService.computeOrderBoxes 完全一致：
     * 绑定档案停用 → 视为未绑定 → 回退租户默认档案；两者皆无 → fallback（两者都支持）。
     */
    async getVariantDeliveryCapabilities(ctx, variantIds) {
        var _a;
        const out = new Map();
        if (variantIds.length === 0)
            return out;
        const variantRepo = this.connection.getRepository(ctx, 'ProductVariant');
        const variants = await variantRepo
            .createQueryBuilder('v')
            .select(['v.id AS id', 'v."customFieldsShippingprofileid" AS pid'])
            .where('v.id IN (:...ids)', { ids: variantIds.map(v => Number(v)) })
            .getRawMany();
        const ids = new Set();
        for (const v of variants)
            if (v.pid)
                ids.add(String(v.pid));
        const tenantDefault = await this.getTenantDefault(ctx);
        if (tenantDefault)
            ids.add(String(tenantDefault.id));
        const configMap = await this.getEffectiveMethodConfigsByProfiles(ctx, [...ids]);
        // 停用档案集合（一次性查出，避免逐个 findOne）
        const rawIds = [...new Set(variants.map(v => { var _a; return String((_a = v.pid) !== null && _a !== void 0 ? _a : ''); }).filter(Boolean))];
        const enabledMap = new Map();
        if (rawIds.length) {
            const rows = await this.connection
                .getRepository(ctx, shipping_profile_entity_1.ShippingProfile)
                .find({ where: { id: (0, typeorm_1.In)(rawIds) }, loadEagerRelations: false });
            for (const p of rows)
                enabledMap.set(String(p.id), p.enabled !== false);
        }
        for (const v of variants) {
            const rawPid = v.pid ? String(v.pid) : '';
            let effective = rawPid && enabledMap.get(rawPid) === true ? rawPid : '';
            if (!effective && tenantDefault)
                effective = String(tenantDefault.id);
            const configs = effective ? (_a = configMap.get(effective)) !== null && _a !== void 0 ? _a : [] : [];
            out.set(String(v.id), (0, delivery_capability_1.capabilityFromMethodConfigs)(configs));
        }
        return out;
    }
    /**
     * 为列表查询批量填充 methodConfigs，避免 schema 非空字段返回 null 导致查询整体失败。
     */
    async attachMethodConfigs(ctx, items) {
        var _a;
        if (!items.length)
            return;
        const ids = items.map(i => String(i.id));
        const rows = await this.connection
            .getRepository(ctx, shipping_profile_method_entity_1.ShippingProfileMethod)
            .find({ where: { profileId: (0, typeorm_1.In)(ids) } });
        const byProfile = new Map();
        for (const r of rows) {
            const k = r.profileId;
            if (!byProfile.has(k))
                byProfile.set(k, []);
            byProfile.get(k).push(r);
        }
        for (const item of items) {
            item.methodConfigs = (_a = byProfile.get(String(item.id))) !== null && _a !== void 0 ? _a : [];
        }
    }
    /**
     * 附加 boundPickupLocations：档案真实绑定的自提点完整对象
     * = 档案级 pickupLocations ∪ 方式级 methodConfigs(pickup 类 mode) 的 options.pickupLocationIds。
     * 管理端展示档案自提点时必须看到真实绑定（即使该点当前渠道不可选/不可见），
     * 否则跨租户引用的自提点（如全局档案绑定某租户私有点）会从编辑面板消失。
     * 可选列表仍由 pickupLocations 查询按租户可见性单独返回。
     */
    async attachBoundPickupLocations(ctx, items) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!items.length)
            return;
        const idSet = new Set();
        for (const item of items) {
            for (const p of ((_a = item.pickupLocations) !== null && _a !== void 0 ? _a : []))
                idSet.add(p.id);
            for (const c of ((_b = item.methodConfigs) !== null && _b !== void 0 ? _b : [])) {
                if (this.isPickupMode(c.mode)) {
                    for (const id of ((_d = (_c = c.options) === null || _c === void 0 ? void 0 : _c.pickupLocationIds) !== null && _d !== void 0 ? _d : []))
                        idSet.add(id);
                }
            }
        }
        const map = new Map();
        if (idSet.size > 0) {
            for (const loc of await this.findPickupLocationsByIds(ctx, [...idSet])) {
                map.set(String(loc.id), loc);
            }
        }
        for (const item of items) {
            const own = new Set();
            for (const p of ((_e = item.pickupLocations) !== null && _e !== void 0 ? _e : []))
                own.add(p.id);
            for (const c of ((_f = item.methodConfigs) !== null && _f !== void 0 ? _f : [])) {
                if (this.isPickupMode(c.mode)) {
                    for (const id of ((_h = (_g = c.options) === null || _g === void 0 ? void 0 : _g.pickupLocationIds) !== null && _h !== void 0 ? _h : []))
                        own.add(id);
                }
            }
            const list = [];
            for (const id of own) {
                const loc = map.get(String(id));
                if (loc)
                    list.push(loc);
            }
            item.boundPickupLocations = list;
        }
    }
};
exports.ShippingProfileService = ShippingProfileService;
exports.ShippingProfileService = ShippingProfileService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        pickup_location_service_1.PickupLocationService,
        payment_profile_service_1.PaymentProfileService])
], ShippingProfileService);
/**
 * 配送档案「全局属性」权限校验（纯函数，便于单测）。
 * action: 'create' | 'update' | 'delete'
 */
function assertProfileGlobalPermissions(ctx, action, profile, input, target) {
    const isSuper = ctx.userHasPermissions([core_1.Permission.SuperAdmin]);
    const toGlobal = (input === null || input === void 0 ? void 0 : input.isGlobal) === true;
    if (action === 'create') {
        if (toGlobal && !isSuper) {
            throw new core_1.UserInputError('仅超级管理员可创建全局档案');
        }
        return;
    }
    if (action === 'update') {
        if ((input === null || input === void 0 ? void 0 : input.isGlobal) !== undefined && (input === null || input === void 0 ? void 0 : input.isGlobal) !== (target === null || target === void 0 ? void 0 : target.isGlobal) && !isSuper) {
            throw new core_1.UserInputError('仅超级管理员可修改全局属性');
        }
        return;
    }
    if (action === 'delete') {
        if ((target === null || target === void 0 ? void 0 : target.isGlobal) === true && !isSuper) {
            throw new core_1.UserInputError('仅超级管理员可删除全局档案');
        }
    }
}
//# sourceMappingURL=shipping-profile.service.js.map