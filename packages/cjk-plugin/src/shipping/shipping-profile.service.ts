import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import {
    EntityNotFoundError,
    ID,
    ListQueryOptions,
    PaginatedList,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { ShippingProfile } from './shipping-profile.entity';
import { ShippingProfileMethod } from './shipping-profile-method.entity';
import { DeliveryCapability, capabilityFromMethodConfigs, modeFromCalculatorCode, unionCapability } from './delivery-capability';
import { PickupLocation } from '../pickup/pickup-location.entity';
import { PickupLocationService } from '../pickup/pickup-location.service';
import { PaymentProfile } from '../payment/payment-profile.entity';
import { PaymentProfileService } from '../payment/payment-profile.service';
import { applyListSort } from '../common/list-sort';

@Injectable()
export class ShippingProfileService {
    constructor(
        private connection: TransactionalConnection,
        private pickupLocationService: PickupLocationService,
        private paymentProfileService: PaymentProfileService,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ShippingProfile>,
    ): Promise<PaginatedList<ShippingProfile>> {
        const qb = this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.shippingMethods', 'sm')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('(sp.isGlobal = :isGlobal OR sp.ownerChannelId = :channelId)', {
                isGlobal: true,
                channelId: ctx.channelId,
            });
        if (options?.filter?.name?.contains) {
            qb.andWhere('sp.name LIKE :name', { name: `%${options.filter.name.contains}%` });
        }
        applyListSort(qb, 'sp', options?.sort, ['name', 'createdAt', 'updatedAt']);

        const skip = options?.skip || 0;
        const take = options?.take || 10;
        qb.skip(skip).take(take);
        const [items, totalItems] = await qb.getManyAndCount();
        await this.attachMethodConfigs(ctx, items);
        await this.attachBoundPickupLocations(ctx, items);
        return { items, totalItems };
    }

    async findOne(ctx: RequestContext, id: any): Promise<ShippingProfile | undefined> {
        const result = await this.connection
            .getRepository(ctx, ShippingProfile)
            .findOne({ where: { id: id as any }, relations: ['shippingMethods', 'pickupLocations'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, ShippingProfileMethod)
                .find({ where: { profileId: String(result.id) } as any });
            (result as any).methodConfigs = methodConfigs;
            await this.attachBoundPickupLocations(ctx, [result]);
        }
        return result ?? undefined;
    }

    async findByCode(ctx: RequestContext, code: string): Promise<ShippingProfile | undefined> {
        const result = await this.connection
            .getRepository(ctx, ShippingProfile)
            .findOne({ where: { code }, relations: ['shippingMethods', 'pickupLocations'] });
        if (result) {
            const methodConfigs = await this.connection
                .getRepository(ctx, ShippingProfileMethod)
                .find({ where: { profileId: String(result.id) } as any });
            (result as any).methodConfigs = methodConfigs;
            await this.attachBoundPickupLocations(ctx, [result]);
        }
        return result ?? undefined;
    }

    async create(ctx: RequestContext, input: any): Promise<ShippingProfile> {
        if (!input.shippingMethodIds?.length) {
            throw new UserInputError('配送档案至少需要选择一种配送方式');
        }
        assertProfileGlobalPermissions(ctx, 'create', undefined, input, { isGlobal: input.isGlobal === true });
        const repo = this.connection.getRepository(ctx, ShippingProfile);
        const profile = new ShippingProfile(input);
        profile.channels = [ctx.channel];
        profile.ownerChannelId = input.isGlobal ? null : ctx.channelId;
        profile.isGlobal = input.isGlobal ?? false;
        if (input.shippingMethodIds?.length) {
            profile.shippingMethods = input.shippingMethodIds.map((id: ID) => ({ id } as any));
        }
        // pickupLocations: undefined=不变, []=清空, [ids]=设置
        if (input.pickupLocationIds !== undefined) {
            profile.pickupLocations = input.pickupLocationIds.map((id: ID) => ({ id } as any));
        }
        // paymentProfileId: 可为空，允许不绑定（回退租户默认支付档案）
        if (input.paymentProfileId !== undefined) {
            profile.paymentProfileId = input.paymentProfileId ?? null;
        }
        await repo.save(profile);
        if (input.methodConfigs?.length) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        // 走 findOne 返回：它只额外挂 methodConfigs / boundPickupLocations，
        // 这两个字段在 SDL 是非空，直接返回裸实体会让整个 mutation 报错（data: null）
        return (await this.findOne(ctx, profile.id)) as ShippingProfile;
    }

    async update(ctx: RequestContext, input: any): Promise<ShippingProfile> {
        const repo = this.connection.getRepository(ctx, ShippingProfile);
        const profile = await repo.findOne({
            where: { id: input.id },
            relations: ['shippingMethods', 'pickupLocations'],
        });
        if (!profile) throw new EntityNotFoundError('ShippingProfile', input.id);
        assertProfileGlobalPermissions(ctx, 'update', profile, input, profile);
        if (profile.isGlobal && !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('不能修改全局档案');
        }
        if (input.shippingMethodIds !== undefined) {
            if (input.shippingMethodIds.length === 0) {
                throw new UserInputError('配送档案至少需要选择一种配送方式');
            }
            profile.shippingMethods = input.shippingMethodIds.map((id: ID) => ({ id } as any));
        }
        if (input.pickupLocationIds !== undefined) {
            profile.pickupLocations = input.pickupLocationIds.map((id: ID) => ({ id } as any));
        }
        const { id, shippingMethodIds, pickupLocationIds, ...updateData } = input;
        // 超管切换 isGlobal 时维护归属与租户默认一致性
        if (input.isGlobal === true) {
            profile.ownerChannelId = null;
            profile.isTenantDefault = false;
        } else if (input.isGlobal === false) {
            profile.ownerChannelId = (ctx.channelId as any) ?? null;
        }
        Object.assign(profile, updateData);
        await repo.save(profile);
        if (input.methodConfigs !== undefined) {
            await this.replaceMethodConfigs(ctx, profile.id, input.methodConfigs);
        }
        // 走 findOne 返回：它只额外挂 methodConfigs / boundPickupLocations，
        // 这两个字段在 SDL 是非空，直接返回裸实体会让整个 mutation 报错（data: null）
        return (await this.findOne(ctx, input.id)) as ShippingProfile;
    }

    async delete(ctx: RequestContext, id: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, ShippingProfile);
        const result = await repo.manager.query(
            `SELECT COUNT(*) as count FROM product_variant WHERE "customFieldsShippingprofileid" = $1`,
            [String(id)]
        );
        const count = parseInt(result?.[0]?.count || '0', 10);
        if (count > 0) {
            throw new UserInputError(`有 ${count} 个商品引用此档案，请先重新分配`);
        }
        const profile = await repo.findOne({ where: { id: id as any } });
        if (!profile) throw new EntityNotFoundError('ShippingProfile', id);
        assertProfileGlobalPermissions(ctx, 'delete', profile, undefined, profile);
        const jmRepo = this.connection.getRepository(ctx, ShippingProfileMethod);
        await jmRepo.delete({ profileId: String(id) } as any);
        await repo.remove(profile);
    }

    async assignToVariants(
        ctx: RequestContext,
        variantIds: ID[],
        profileId: ID,
    ): Promise<void> {
        const profile = await this.findOne(ctx, profileId);
        if (!profile) throw new EntityNotFoundError('ShippingProfile', profileId);
        const repo = this.connection.getRepository(ctx, 'ProductVariant');
        const ids = variantIds.map(id => Number(id));
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        await repo.manager.query(
            `UPDATE product_variant SET "customFieldsShippingprofileid" = $1 WHERE id IN (${placeholders})`,
            [String(profileId), ...ids]
        );
    }

    async getIntersectedShippingMethods(
        ctx: RequestContext,
        profileIds: ID[],
    ): Promise<Array<{ id: ID; code: string }>> {
        if (profileIds.length === 0) return [];
        if (profileIds.length === 1) {
            const profile = await this.findOne(ctx, profileIds[0]);
            return (profile?.shippingMethods ?? []).map(sm => ({ id: sm.id, code: sm.code }));
        }
        const qb = this.connection
            .getRepository(ctx, ShippingProfile)
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
    async findShippingMethodsByIds(ctx: RequestContext, ids: ID[]): Promise<any[]> {
        if (ids.length === 0) return [];
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
    async getIntersectedPickupLocations(
        ctx: RequestContext,
        profileIds: ID[],
    ): Promise<ID[] | null> {
        if (profileIds.length === 0) return null;
        const profiles = await this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getMany();

        // 按 Profile 分组：约束了的 vs 未约束的
        const constrained = profiles.filter(p => (p.pickupLocations?.length ?? 0) > 0);
        if (constrained.length === 0) return null; // 全部未约束

        // 取交集
        let intersection = new Set(constrained[0].pickupLocations.map(pl => pl.id));
        for (let i = 1; i < constrained.length; i++) {
            const current = new Set(constrained[i].pickupLocations.map(pl => pl.id));
            intersection = new Set([...intersection].filter(x => current.has(x as any)));
        }
        return [...intersection] as ID[];
    }

    /**
     * 结合 per-method config 的自提点取 Profile 交集。
     * 规则：Profile 的 methodConfigs 中有 pickup 类 mode（pickup/store/employee）且带自提点范围时，
     * 以其 config 中的自提点作为该 Profile 的约束；否则回退到档案级 pickupLocations。
     * 其余语义与 getIntersectedPickupLocations 一致：
     * - 全部未约束 → null；有约束但交集为空 → []。
     */
    async getIntersectedPickupLocationsWithConfig(
        ctx: RequestContext,
        profileIds: ID[],
    ): Promise<ID[] | null> {
        if (profileIds.length === 0) return null;
        const profiles = await this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getMany();

        const effectiveByProfile: ID[][] = [];
        for (const profile of profiles) {
            const configs = await this.getMethodConfigsByProfile(ctx, profile.id);
            const pickupEffective: ID[] = [];
            for (const c of configs) {
                if (!this.isPickupMode(c.mode)) continue;
                const ids = await this.getEffectivePickupIdsForConfig(ctx, c);
                pickupEffective.push(...ids);
            }
            const effective = pickupEffective.length > 0
                ? pickupEffective
                : (profile.pickupLocations ?? []).map(pl => pl.id);
            effectiveByProfile.push(effective);
        }

        const constrained = effectiveByProfile.filter(ids => ids.length > 0);
        if (constrained.length === 0) return null; // 全部未约束

        let intersection = new Set(constrained[0]);
        for (let i = 1; i < constrained.length; i++) {
            const current = new Set(constrained[i]);
            intersection = new Set([...intersection].filter(x => current.has(x as any)));
        }
        return [...intersection] as ID[];
    }

    /**
     * 查询是否任一 Profile 约束了自提点。
     * 前端用此区分 eligiblePickupLocationsByProfile 返回 [] 的两种情况：
     * - false → 未约束，前端展示全部自提点
     * - true  → 约束了但交集为空，前端展示"无可用自提点"
     */
    async hasPickupLocationConstraint(
        ctx: RequestContext,
        profileIds: ID[],
    ): Promise<boolean> {
        if (profileIds.length === 0) return false;
        // 任一 Profile 级 pickupLocations 非空即为约束
        const count = await this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder('sp')
            .innerJoin('sp.pickupLocations', 'pl')
            .where('sp.id IN (:...profileIds)', { profileIds })
            .getCount();
        if (count > 0) return true;
        // 任一 pickup 方式 config 携带自提点范围（rangeMode='all' 或 pickupLocationIds）亦为约束
        for (const pid of profileIds) {
            const configs = await this.getMethodConfigsByProfile(ctx, pid);
            const constrained = configs.some(c => this.isPickupMode(c.mode) &&
                (c.options?.rangeMode === 'all' || (c.options?.pickupLocationIds?.length ?? 0) > 0));
            if (constrained) return true;
        }
        return false;
    }

    /**
     * 方式 mode → 自提点实体类型映射：
     * - pickup → point
     * - store  → store
     * - employee → employee
     */
    private pickupTypeByMode(mode: string): string {
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
    private isPickupMode(mode: string | null | undefined): boolean {
        return mode === 'pickup' || mode === 'store' || mode === 'employee';
    }

    /**
     * 自提类计算器判定（门店自提/自提点/职工单位）。
     */
    private isPickupCalculator(code?: string): boolean {
        return code === 'store-pickup-calculator' || code === 'pickup-point-calculator' || code === 'employee-pickup-calculator';
    }

    /**
     * 按配送方式计算器判定其自提点实体类型。
     * 门店自提/自提点/职工单位共用 mode='pickup' 之场景（历史前端默认值），
     * 必须以 calculator 为准，否则 store-pickup-calculator 会被误判成 'point'。
     * 非自提计算器返回 null（交由 pickupTypeByMode 回退）。
     */
    private async pickupTypeForMethod(
        ctx: RequestContext,
        shippingMethodId: any,
    ): Promise<string | null> {
        if (shippingMethodId == null) return null;
        const sm = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { id: shippingMethodId as any } as any });
        const code = (sm as any)?.calculator?.code;
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
    async resolveBoxFulfilment(
        ctx: RequestContext,
        profile?: ShippingProfile,
    ): Promise<{ type: 'pickup' | 'delivery'; pickupLocations: PickupLocation[] }> {
        const legacy = profile?.pickupLocations ?? [];
        const methods = profile?.shippingMethods ?? [];
        const cfgById = new Map<string, any>();
        for (const c of ((profile as any)?.methodConfigs ?? [])) cfgById.set(String(c.shippingMethodId), c);
        const allPickup =
            methods.length > 0 &&
            methods.every((m: any) => {
                const cfg = cfgById.get(String(m.id));
                return (cfg && this.isPickupMode(cfg.mode)) || this.isPickupCalculator(m.calculator?.code);
            });
        const isPickup = legacy.length > 0 || allPickup;
        if (!isPickup) return { type: 'delivery', pickupLocations: [] };

        const idSet = new Set<ID>();
        for (const p of legacy) idSet.add(p.id as ID);
        for (const m of methods as any[]) {
            const cfg = cfgById.get(String(m.id));
            if (!cfg) continue;
            if (this.isPickupMode(cfg.mode) || this.isPickupCalculator(m.calculator?.code)) {
                const eff = await this.getEffectivePickupIdsForConfig(ctx, cfg);
                eff.forEach(id => idSet.add(id));
            }
        }
        const out: PickupLocation[] = [];
        if (idSet.size > 0) {
            const found = await this.pickupLocationService.findByIds(ctx, [...idSet]);
            const map = new Map(found.map(p => [String(p.id), p]));
            // 档案级绑定点同样过可见性/启用过滤（平台可见全量，租户仅公共+本租户）
            for (const p of legacy) {
                const f = map.get(String(p.id));
                if (f) out.push(f);
            }
            for (const id of idSet) {
                const p = map.get(String(id));
                if (p && !out.some(x => String(x.id) === String(p.id))) out.push(p);
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
    async getEffectivePickupIdsForConfig(ctx: RequestContext, cfg: any): Promise<ID[]> {
        if (!cfg || !this.isPickupMode(cfg.mode)) return [];
        // 类型优先取配送方式计算器（门店自提/自提点/职工单位），历史 mode='pickup' 共用时以 calculator 为准
        const type = (await this.pickupTypeForMethod(ctx, cfg.shippingMethodId)) ?? this.pickupTypeByMode(cfg.mode);
        const options = cfg.options ?? {};
        if (options.rangeMode === 'all') {
            return (await this.pickupLocationService.findByCityForChannel(ctx, null, type)).map(l => l.id);
        }
        const ids: ID[] = options.pickupLocationIds ?? [];
        if (ids.length === 0) return [];
        const locs = await this.pickupLocationService.findByIds(ctx, ids);
        return locs.filter(l => l.type === type).map(l => l.id);
    }

    async findPickupLocationsByIds(
        ctx: RequestContext,
        ids: ID[],
    ): Promise<PickupLocation[]> {
        if (ids.length === 0) return [];
        return this.connection
            .getRepository(ctx, PickupLocation)
            .findByIds(ids as any);
    }

    private async replaceMethodConfigs(
        ctx: RequestContext,
        profileId: any,
        configs: Array<{ shippingMethodId: any; mode?: string; options?: any }>,
    ): Promise<void> {
        const jmRepo = this.connection.getRepository(ctx, ShippingProfileMethod);
        await jmRepo.delete({ profileId: String(profileId) } as any);
        for (const cfg of configs) {
            await jmRepo.save(new ShippingProfileMethod({
                profileId: String(profileId),
                shippingMethodId: String(cfg.shippingMethodId),
                mode: cfg.mode ?? 'mail',
                options: cfg.options ?? null,
            } as any));
        }
    }

    async setTenantDefault(ctx: RequestContext, id: any): Promise<void> {
        const repo = this.connection.getRepository(ctx, ShippingProfile);
        const profile = await repo.findOne({ where: { id: id as any } });
        if (!profile) throw new UserInputError('档案不存在');
        if (profile.isGlobal) throw new UserInputError('全局档案不能设为租户默认');
        await this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder()
            .update()
            .set({ isTenantDefault: false })
            .where('"ownerChannelId" = :channelId AND "isGlobal" = false', { channelId: ctx.channelId })
            .execute();
        profile.isTenantDefault = true;
        await repo.save(profile);
    }

    async getTenantDefault(ctx: RequestContext): Promise<ShippingProfile | undefined> {
        const profile = await this.connection
            .getRepository(ctx, ShippingProfile)
            .findOne({
                where: { isGlobal: false, ownerChannelId: ctx.channelId as any, isTenantDefault: true, enabled: true },
                relations: ['shippingMethods', 'pickupLocations'],
            });
        return profile ?? undefined;
    }

    /**
     * 取配送档案绑定的支付档案；
     * 未绑定时回退到对应租户的默认支付档案（复用 PaymentProfileService.getTenantDefault）。
     */
    async getPaymentProfileForShippingProfile(
        ctx: RequestContext,
        shippingProfileId: ID,
    ): Promise<PaymentProfile | undefined> {
        const profile = await this.connection
            .getRepository(ctx, ShippingProfile)
            .findOne({ where: { id: shippingProfileId as any }, relations: ['paymentProfile'] });
        if (profile?.paymentProfile) return profile.paymentProfile;
        return this.paymentProfileService.getTenantDefault(ctx);
    }

    /**
     * 解析变体绑定的档案集合（含默认回退）：
     * - 变体绑定的档案若已停用（enabled=false），视为未绑定，回退到租户默认档案；
     * - 回退命中（含租户默认）同样排除停用档案（见 getTenantDefault）；
     * - 返回去重后的有效档案 id 列表，供交集/匹配使用，保证停用档案不参与变体绑定匹配。
     */
    async resolveEffectiveProfileIds(ctx: RequestContext, profileIds: ID[]): Promise<ID[]> {
        const seen = new Set<string>();
        const result: ID[] = [];
        for (const pid of profileIds) {
            const profile = await this.findOne(ctx, pid as any);
            let effective: ID | undefined = profile?.enabled === false
                ? (await this.getTenantDefault(ctx))?.id as ID | undefined
                : pid;
            if (effective == null) continue;
            const key = String(effective);
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(effective);
        }
        return result;
    }

    async getMethodConfigsByProfile(ctx: RequestContext, profileId: any): Promise<any[]> {
        return this.connection
            .getRepository(ctx, ShippingProfileMethod)
            .find({ where: { profileId: String(profileId) } as any });
    }

    /**
     * 批量取多个档案的「有效方法行」（一次查询，避免逐档案查）。
     * 真实 ShippingProfileMethod 行优先；档案绑定了配送方式却缺行时按该方式的
     * 计算器推断 mode 补齐——行只在 web-admin 保存档案时写入，存量档案恒为空，
     * 不补则快递档案对能力派生完全不可见（口径同 resolveBoxFulfilment）。
     */
    async getEffectiveMethodConfigsByProfiles(
        ctx: RequestContext,
        profileIds: Array<ID | string>,
    ): Promise<Map<string, ShippingProfileMethod[]>> {
        const out = new Map<string, ShippingProfileMethod[]>();
        const ids = [...new Set(profileIds.map(id => String(id)))];
        if (ids.length === 0) return out;
        const rows = await this.connection
            .getRepository(ctx, ShippingProfileMethod)
            .find({ where: { profileId: In(ids) } as any });
        for (const r of rows) {
            if (!out.has(r.profileId)) out.set(r.profileId, []);
            out.get(r.profileId)!.push(r);
        }
        const profiles = await this.connection
            .getRepository(ctx, ShippingProfile)
            .find({ where: { id: In(ids) } as any, relations: ['shippingMethods'] });
        for (const p of profiles) {
            const key = String(p.id);
            const existing = out.get(key) ?? [];
            const covered = new Set(existing.map(c => String(c.shippingMethodId)));
            const filled = [...existing];
            for (const m of (p.shippingMethods ?? []) as any[]) {
                if (covered.has(String(m.id))) continue;
                filled.push(new ShippingProfileMethod({
                    profileId: key,
                    shippingMethodId: String(m.id),
                    mode: modeFromCalculatorCode(m.calculator?.code),
                    options: null,
                } as any));
            }
            out.set(key, filled);
        }
        return out;
    }

    /** 本渠道内参与履约的全部生效档案（租户自有 + 全局），供渠道级能力并集使用 */
    async listEffectiveProfilesForChannel(ctx: RequestContext): Promise<ShippingProfile[]> {
        const qb = this.connection
            .getRepository(ctx, ShippingProfile)
            .createQueryBuilder('sp')
            .leftJoinAndSelect('sp.shippingMethods', 'sm')
            .where('sp.enabled = :on', { on: true })
            .andWhere(
                '(sp.isGlobal = :isGlobal OR sp.ownerChannelId = :channelId)',
                { isGlobal: true, channelId: ctx.channelId },
            );
        return qb.getMany();
    }

    /**
     * 渠道级配送能力（并集）。
     * 若渠道内存在未绑定档案的变体，则并入租户默认档案的能力（与 computeOrderBoxes 的回退一致）。
     * 缺 method_configs 行的档案按绑定方式计算器推断补齐，否则快递档案不参与并集。
     * fallback：渠道内一个生效档案都没有 → 回退「两者都支持」，保持旧行为不误伤。
     */
    async getChannelDeliveryCapability(ctx: RequestContext): Promise<DeliveryCapability> {
        const profiles = await this.listEffectiveProfilesForChannel(ctx);
        if (profiles.length === 0) {
            return { modes: ['MAIL', 'SELF_PICKUP'], bothSupported: true, source: 'fallback' };
        }
        const map = await this.getEffectiveMethodConfigsByProfiles(ctx, profiles.map(p => p.id));
        const perProfile = [...map.values()];
        const tenantDefault = await this.getTenantDefault(ctx);
        if (tenantDefault) {
            perProfile.push(map.get(String(tenantDefault.id)) ?? []);
        }
        return unionCapability(perProfile);
    }

    /**
     * 逐变体派生配送能力（含默认档案回退）。批量入参，档案方法行一次查出。
     * 回退语义与 OrderBoxService.computeOrderBoxes 完全一致：
     * 绑定档案停用 → 视为未绑定 → 回退租户默认档案；两者皆无 → fallback（两者都支持）。
     */
    async getVariantDeliveryCapabilities(
        ctx: RequestContext,
        variantIds: ID[],
    ): Promise<Map<string, DeliveryCapability>> {
        const out = new Map<string, DeliveryCapability>();
        if (variantIds.length === 0) return out;
        const variantRepo = this.connection.getRepository(ctx, 'ProductVariant');
        const variants = await variantRepo
            .createQueryBuilder('v')
            .select(['v.id AS id', 'v."customFieldsShippingprofileid" AS pid'])
            .where('v.id IN (:...ids)', { ids: variantIds.map(v => Number(v)) })
            .getRawMany<{ id: number; pid: string | null }>();

        const ids = new Set<string>();
        for (const v of variants) if (v.pid) ids.add(String(v.pid));
        const tenantDefault = await this.getTenantDefault(ctx);
        if (tenantDefault) ids.add(String(tenantDefault.id));
        const configMap = await this.getEffectiveMethodConfigsByProfiles(ctx, [...ids]);

        // 停用档案集合（一次性查出，避免逐个 findOne）
        const rawIds = [...new Set(variants.map(v => String(v.pid ?? '')).filter(Boolean))];
        const enabledMap = new Map<string, boolean>();
        if (rawIds.length) {
            const rows = await this.connection
                .getRepository(ctx, ShippingProfile)
                .find({ where: { id: In(rawIds) } as any, loadEagerRelations: false });
            for (const p of rows) enabledMap.set(String(p.id), p.enabled !== false);
        }

        for (const v of variants) {
            const rawPid = v.pid ? String(v.pid) : '';
            let effective = rawPid && enabledMap.get(rawPid) === true ? rawPid : '';
            if (!effective && tenantDefault) effective = String(tenantDefault.id);
            const configs = effective ? configMap.get(effective) ?? [] : [];
            out.set(String(v.id), capabilityFromMethodConfigs(configs));
        }
        return out;
    }

    /**
     * 为列表查询批量填充 methodConfigs，避免 schema 非空字段返回 null 导致查询整体失败。
     */
    private async attachMethodConfigs(ctx: RequestContext, items: ShippingProfile[]): Promise<void> {
        if (!items.length) return;
        const ids = items.map(i => String(i.id));
        const rows = await this.connection
            .getRepository(ctx, ShippingProfileMethod)
            .find({ where: { profileId: In(ids) } as any });
        const byProfile = new Map<string, ShippingProfileMethod[]>();
        for (const r of rows) {
            const k = r.profileId;
            if (!byProfile.has(k)) byProfile.set(k, []);
            byProfile.get(k)!.push(r);
        }
        for (const item of items) {
            (item as any).methodConfigs = byProfile.get(String(item.id)) ?? [];
        }
    }

    /**
     * 附加 boundPickupLocations：档案真实绑定的自提点完整对象
     * = 档案级 pickupLocations ∪ 方式级 methodConfigs(pickup 类 mode) 的 options.pickupLocationIds。
     * 管理端展示档案自提点时必须看到真实绑定（即使该点当前渠道不可选/不可见），
     * 否则跨租户引用的自提点（如全局档案绑定某租户私有点）会从编辑面板消失。
     * 可选列表仍由 pickupLocations 查询按租户可见性单独返回。
     */
    private async attachBoundPickupLocations(ctx: RequestContext, items: ShippingProfile[]): Promise<void> {
        if (!items.length) return;
        const idSet = new Set<ID>();
        for (const item of items) {
            for (const p of (item.pickupLocations ?? [])) idSet.add(p.id as ID);
            for (const c of ((item as any).methodConfigs ?? [])) {
                if (this.isPickupMode(c.mode)) {
                    for (const id of (c.options?.pickupLocationIds ?? [])) idSet.add(id as ID);
                }
            }
        }
        const map = new Map<string, PickupLocation>();
        if (idSet.size > 0) {
            for (const loc of await this.findPickupLocationsByIds(ctx, [...idSet])) {
                map.set(String(loc.id), loc);
            }
        }
        for (const item of items) {
            const own = new Set<ID>();
            for (const p of (item.pickupLocations ?? [])) own.add(p.id as ID);
            for (const c of ((item as any).methodConfigs ?? [])) {
                if (this.isPickupMode(c.mode)) {
                    for (const id of (c.options?.pickupLocationIds ?? [])) own.add(id as ID);
                }
            }
            const list: PickupLocation[] = [];
            for (const id of own) {
                const loc = map.get(String(id));
                if (loc) list.push(loc);
            }
            (item as any).boundPickupLocations = list;
        }
    }
}

/**
 * 配送档案「全局属性」权限校验（纯函数，便于单测）。
 * action: 'create' | 'update' | 'delete'
 */
export function assertProfileGlobalPermissions(
    ctx: RequestContext,
    action: 'create' | 'update' | 'delete',
    profile: { isGlobal: boolean } | undefined,
    input: Partial<any> | undefined,
    target: { isGlobal: boolean } | undefined,
): void {
    const isSuper = ctx.userHasPermissions([Permission.SuperAdmin]);
    const toGlobal = input?.isGlobal === true;

    if (action === 'create') {
        if (toGlobal && !isSuper) {
            throw new UserInputError('仅超级管理员可创建全局档案');
        }
        return;
    }

    if (action === 'update') {
        if (input?.isGlobal !== undefined && input?.isGlobal !== target?.isGlobal && !isSuper) {
            throw new UserInputError('仅超级管理员可修改全局属性');
        }
        return;
    }

    if (action === 'delete') {
        if (target?.isGlobal === true && !isSuper) {
            throw new UserInputError('仅超级管理员可删除全局档案');
        }
    }
}