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
exports.PaymentProfileService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const payment_profile_entity_1 = require("./payment-profile.entity");
const payment_profile_method_entity_1 = require("./payment-profile-method.entity");
const list_sort_1 = require("../common/list-sort");
let PaymentProfileService = class PaymentProfileService {
    constructor(connection) {
        this.connection = connection;
    }
    async findAll(ctx, options) {
        var _a, _b;
        const qb = this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .createQueryBuilder('pp')
            .leftJoinAndSelect('pp.paymentMethods', 'pm')
            .where('(pp.isGlobal = :isGlobal OR pp.ownerChannelId = :channelId)', {
            isGlobal: true,
            channelId: ctx.channelId,
        });
        if ((_b = (_a = options === null || options === void 0 ? void 0 : options.filter) === null || _a === void 0 ? void 0 : _a.name) === null || _b === void 0 ? void 0 : _b.contains) {
            qb.andWhere('pp.name LIKE :name', { name: `%${options.filter.name.contains}%` });
        }
        (0, list_sort_1.applyListSort)(qb, 'pp', options === null || options === void 0 ? void 0 : options.sort, ['name', 'createdAt', 'updatedAt']);
        const skip = (options === null || options === void 0 ? void 0 : options.skip) || 0;
        const take = (options === null || options === void 0 ? void 0 : options.take) || 10;
        qb.skip(skip).take(take);
        const [items, totalItems] = await qb.getManyAndCount();
        await this.attachMethodConfigs(ctx, items);
        return { items, totalItems };
    }
    async findOne(ctx, id) {
        const result = await this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .findOne({ where: { id: id }, relations: ['paymentMethods'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod)
                .find({ where: { profileId: String(result.id) } });
            result.methodConfigs = methodConfigs;
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    async findByCode(ctx, code) {
        const result = await this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .findOne({ where: { code }, relations: ['paymentMethods'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod)
                .find({ where: { profileId: String(result.id) } });
            result.methodConfigs = methodConfigs;
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    async create(ctx, input) {
        var _a, _b, _c, _d;
        if (!((_a = input.paymentMethodIds) === null || _a === void 0 ? void 0 : _a.length)) {
            throw new core_1.UserInputError('支付档案至少需要选择一种支付方式');
        }
        const repo = this.connection.getRepository(ctx, payment_profile_entity_1.PaymentProfile);
        const profile = new payment_profile_entity_1.PaymentProfile(input);
        profile.channels = [ctx.channel];
        profile.ownerChannelId = input.isGlobal ? null : ctx.channelId;
        profile.isGlobal = (_b = input.isGlobal) !== null && _b !== void 0 ? _b : false;
        if ((_c = input.paymentMethodIds) === null || _c === void 0 ? void 0 : _c.length) {
            profile.paymentMethods = input.paymentMethodIds.map((id) => ({ id }));
        }
        await repo.save(profile);
        if ((_d = input.methodConfigs) === null || _d === void 0 ? void 0 : _d.length) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        // reload 以填充关联实体完整字段并挂 methodConfigs
        return (await this.findOne(ctx, profile.id));
    }
    async update(ctx, input) {
        const repo = this.connection.getRepository(ctx, payment_profile_entity_1.PaymentProfile);
        const profile = await repo.findOne({
            where: { id: input.id },
            relations: ['paymentMethods'],
        });
        if (!profile)
            throw new core_1.EntityNotFoundError('PaymentProfile', input.id);
        if (profile.isGlobal && !ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            throw new core_1.UserInputError('不能修改全局档案');
        }
        if (input.paymentMethodIds !== undefined) {
            if (input.paymentMethodIds.length === 0) {
                throw new core_1.UserInputError('支付档案至少需要选择一种支付方式');
            }
            profile.paymentMethods = input.paymentMethodIds.map((id) => ({ id }));
        }
        const { id, paymentMethodIds } = input, updateData = __rest(input, ["id", "paymentMethodIds"]);
        Object.assign(profile, updateData);
        await repo.save(profile);
        if (input.methodConfigs !== undefined) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        return (await this.findOne(ctx, profile.id));
    }
    async delete(ctx, id) {
        var _a;
        const repo = this.connection.getRepository(ctx, payment_profile_entity_1.PaymentProfile);
        const result = await repo.manager.query(`SELECT COUNT(*) as count FROM product_variant WHERE "customFieldsPaymentprofileid" = $1`, [String(id)]);
        const count = parseInt(((_a = result === null || result === void 0 ? void 0 : result[0]) === null || _a === void 0 ? void 0 : _a.count) || '0', 10);
        if (count > 0) {
            throw new core_1.UserInputError(`有 ${count} 个商品引用此档案，请先重新分配`);
        }
        const profile = await repo.findOne({ where: { id: id } });
        if (!profile)
            throw new core_1.EntityNotFoundError('PaymentProfile', id);
        const jmRepo = this.connection.getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod);
        await jmRepo.delete({ profileId: String(id) });
        await repo.remove(profile);
    }
    async assignToVariants(ctx, variantIds, profileId) {
        const profile = await this.findOne(ctx, profileId);
        if (!profile)
            throw new core_1.EntityNotFoundError('PaymentProfile', profileId);
        const repo = this.connection.getRepository(ctx, 'ProductVariant');
        const ids = variantIds.map(id => Number(id));
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        await repo.manager.query(`UPDATE product_variant SET "customFieldsPaymentprofileid" = $1 WHERE id IN (${placeholders})`, [String(profileId), ...ids]);
    }
    async getIntersectedPaymentMethods(ctx, profileIds) {
        var _a;
        if (profileIds.length === 0)
            return [];
        if (profileIds.length === 1) {
            const profile = await this.findOne(ctx, profileIds[0]);
            return ((_a = profile === null || profile === void 0 ? void 0 : profile.paymentMethods) !== null && _a !== void 0 ? _a : []).map(pm => ({ id: pm.id, code: pm.code }));
        }
        const qb = this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .createQueryBuilder('pp')
            .innerJoin('pp.paymentMethods', 'pm')
            .select('pm.id', 'id')
            .addSelect('pm.code', 'code')
            .where('pp.id IN (:...profileIds)', { profileIds })
            .groupBy('pm.id')
            .addGroupBy('pm.code')
            .having('COUNT(DISTINCT pp.id) = :count', { count: profileIds.length });
        return qb.getRawMany();
    }
    /**
     * 按交集 id 查询完整 PaymentMethod 实体（供 Shop API 返回完整字段）
     * PaymentMethod 是 translatable 实体，需 join translations 加载 name
     */
    async findPaymentMethodsByIds(ctx, ids) {
        if (ids.length === 0)
            return [];
        return this.connection
            .getRepository(ctx, 'PaymentMethod')
            .createQueryBuilder('pm')
            .leftJoinAndSelect('pm.translations', 't')
            .where('pm.id IN (:...ids)', { ids })
            .getMany();
    }
    async getIntersectedInstallmentOptions(ctx, profileIds) {
        if (profileIds.length === 0)
            return null;
        const profiles = await this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .find({ where: { id: profileIds } });
        const profilesWithInstallment = profiles.filter(p => p.installmentOptions);
        if (profilesWithInstallment.length === 0)
            return null;
        const result = {};
        for (const provider of ['alipay', 'wechatpay']) {
            const allPeriods = profilesWithInstallment
                .filter(p => { var _a, _b, _c; return (_c = (_b = (_a = p.installmentOptions) === null || _a === void 0 ? void 0 : _a[provider]) === null || _b === void 0 ? void 0 : _b.huabei) === null || _c === void 0 ? void 0 : _c.periods; })
                .map(p => p.installmentOptions[provider].huabei.periods);
            if (allPeriods.length < profilesWithInstallment.length)
                continue;
            const intersected = allPeriods.reduce((a, b) => a.filter(v => b.includes(v)));
            if (intersected.length > 0) {
                result[provider] = { huabei: { periods: intersected } };
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }
    async replaceMethodConfigs(ctx, profileId, configs) {
        var _a, _b;
        const jmRepo = this.connection.getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod);
        await jmRepo.delete({ profileId: String(profileId) });
        for (const cfg of configs) {
            await jmRepo.save(new payment_profile_method_entity_1.PaymentProfileMethod({
                profileId: String(profileId),
                paymentMethodId: String(cfg.paymentMethodId),
                mode: (_a = cfg.mode) !== null && _a !== void 0 ? _a : 'installment',
                options: (_b = cfg.options) !== null && _b !== void 0 ? _b : null,
            }));
        }
    }
    async setTenantDefault(ctx, id) {
        const repo = this.connection.getRepository(ctx, payment_profile_entity_1.PaymentProfile);
        const profile = await repo.findOne({ where: { id: id } });
        if (!profile)
            throw new core_1.UserInputError('档案不存在');
        if (profile.isGlobal)
            throw new core_1.UserInputError('全局档案不能设为租户默认');
        await this.connection
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
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
            .getRepository(ctx, payment_profile_entity_1.PaymentProfile)
            .findOne({
            where: { isGlobal: false, ownerChannelId: ctx.channelId, isTenantDefault: true, enabled: true },
            relations: ['paymentMethods'],
        });
        return profile !== null && profile !== void 0 ? profile : undefined;
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
            .getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod)
            .find({ where: { profileId: String(profileId) } });
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
            .getRepository(ctx, payment_profile_method_entity_1.PaymentProfileMethod)
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
};
exports.PaymentProfileService = PaymentProfileService;
exports.PaymentProfileService = PaymentProfileService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], PaymentProfileService);
//# sourceMappingURL=payment-profile.service.js.map