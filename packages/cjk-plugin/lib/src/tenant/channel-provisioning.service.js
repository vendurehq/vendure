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
exports.ChannelProvisioningService = exports.DEFAULT_PROVISION_PAYMENT_METHOD_CODES = exports.DEFAULT_PROVISION_SHIPPING_METHOD_CODES = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const constants_1 = require("../constants");
/**
 * 新渠道默认绑定的配送方式 code（按顺序取第一个存在的）。
 * 不写渠道 id，避免各环境 id 漂移。
 */
exports.DEFAULT_PROVISION_SHIPPING_METHOD_CODES = ['courier-delivery'];
/**
 * 新渠道默认绑定的支付方式 code。
 * 只绑「可直接用于流程验证」的方式；korea-pg 一期是桩，默认不绑（见 B-04）。
 */
exports.DEFAULT_PROVISION_PAYMENT_METHOD_CODES = ['cash-on-delivery'];
/**
 * 新建渠道的「兜底配置」——B-01 根因治理。
 *
 * 背景：ChannelService.create 不继承任何默认值，新建渠道既没有税区/配送区，
 * 也没有绑配送方式/支付方式，导致：
 *   - hydratePriceFields 抛「tax zone 无法确定」→ specSheets 价格 null；
 *   - eligibleShippingMethods / eligiblePaymentMethods 为空 → 无法下单；
 *   - BoxShippingLineAssignmentStrategy 找不到生效配送档案 → shippingLineId 为空 →
 *     订单卡在 `not all lines have shipping`（B-02 同根因）。
 *
 * 本服务把「该有的配置」收敛到一处并幂等补齐，新建租户不再依赖人工二次补配。
 */
let ChannelProvisioningService = class ChannelProvisioningService {
    constructor(connection, channelService) {
        this.connection = connection;
        this.channelService = channelService;
    }
    /**
     * 读取默认渠道（`__default_channel__`）的税区 / 配送区，用于新渠道继承。
     * 供 createChannel 在 channelService.create 入参里直接带上。
     */
    async getDefaultChannelZones(ctx) {
        var _a, _b, _c, _d, _e;
        try {
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            const repo = this.connection.getRepository(ctx, core_1.Channel);
            const loaded = await repo.findOne({
                where: { id: defaultChannel.id },
                relations: ['defaultTaxZone', 'defaultShippingZone'],
            });
            return {
                defaultTaxZoneId: (_b = (_a = loaded === null || loaded === void 0 ? void 0 : loaded.defaultTaxZone) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                defaultShippingZoneId: (_d = (_c = loaded === null || loaded === void 0 ? void 0 : loaded.defaultShippingZone) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
            };
        }
        catch (e) {
            core_1.Logger.warn(`读取默认渠道税区/配送区失败：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`, constants_1.loggerCtx);
            return { defaultTaxZoneId: null, defaultShippingZoneId: null };
        }
    }
    /**
     * 为已创建的渠道补齐默认配置（幂等，可重复执行，可用于存量渠道修复）：
     * 1. 缺税区/配送区时继承默认渠道；
     * 2. 绑定默认配送方式（courier-delivery 等）；
     * 3. 绑定默认支付方式（cash-on-delivery 等）；
     * 4. 无租户默认配送档案时创建，并把已绑配送方式挂进去（mode=mail）。
     *
     * 单步失败只记 warning，不阻断渠道创建（避免因某个 code 缺失导致建租户整体失败）；
     * 失败原因会随结果返回，调用方写日志。
     */
    async provision(ctx, channel, options) {
        var _a, _b, _c, _d;
        const channelId = channel.id;
        const shippingCodes = (_a = options === null || options === void 0 ? void 0 : options.shippingMethodCodes) !== null && _a !== void 0 ? _a : exports.DEFAULT_PROVISION_SHIPPING_METHOD_CODES;
        const paymentCodes = (_b = options === null || options === void 0 ? void 0 : options.paymentMethodCodes) !== null && _b !== void 0 ? _b : exports.DEFAULT_PROVISION_PAYMENT_METHOD_CODES;
        const warnings = [];
        const zones = await this.ensureDefaultZones(ctx, channelId, warnings);
        const shippingMethodIds = await this.ensureMethodsInChannel(ctx, channelId, core_1.ShippingMethod, 'ShippingMethod', shippingCodes, warnings);
        const paymentMethodIds = await this.ensureMethodsInChannel(ctx, channelId, core_1.PaymentMethod, 'PaymentMethod', paymentCodes, warnings);
        const shippingProfileId = (options === null || options === void 0 ? void 0 : options.createDefaultShippingProfile) === false
            ? null
            : await this.ensureTenantDefaultShippingProfile(ctx, channel, shippingMethodIds, warnings);
        if (warnings.length > 0) {
            core_1.Logger.warn(`渠道 ${channel.code} 兜底配置未完全就绪：${warnings.join('；')}`, constants_1.loggerCtx);
        }
        else {
            core_1.Logger.info(`渠道 ${channel.code} 兜底配置就绪（配送 ${shippingMethodIds.length} 个 / 支付 ${paymentMethodIds.length} 个 / 配送档案 ${shippingProfileId !== null && shippingProfileId !== void 0 ? shippingProfileId : '无'}）`, constants_1.loggerCtx);
        }
        return {
            channelId,
            defaultTaxZoneId: (_c = zones.defaultTaxZoneId) !== null && _c !== void 0 ? _c : null,
            defaultShippingZoneId: (_d = zones.defaultShippingZoneId) !== null && _d !== void 0 ? _d : null,
            shippingMethodIds,
            paymentMethodIds,
            shippingProfileId,
            warnings,
        };
    }
    /** 缺省继承默认渠道的税区/配送区；已有值不动（不覆盖人工配置） */
    async ensureDefaultZones(ctx, channelId, warnings) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, core_1.Channel);
        const fresh = await repo.findOne({
            where: { id: channelId },
            relations: ['defaultTaxZone', 'defaultShippingZone'],
        });
        const zones = await this.getDefaultChannelZones(ctx);
        if (!zones.defaultTaxZoneId && !zones.defaultShippingZoneId) {
            warnings.push('默认渠道未配置税区/配送区，无法继承');
            return { defaultTaxZoneId: null, defaultShippingZoneId: null };
        }
        let dirty = false;
        if (fresh && !fresh.defaultTaxZone && zones.defaultTaxZoneId) {
            fresh.defaultTaxZone = { id: zones.defaultTaxZoneId };
            dirty = true;
        }
        if (fresh && !fresh.defaultShippingZone && zones.defaultShippingZoneId) {
            fresh.defaultShippingZone = { id: zones.defaultShippingZoneId };
            dirty = true;
        }
        if (dirty && fresh) {
            await repo.save(fresh);
            core_1.Logger.info(`渠道 ${channelId} 已继承默认渠道税区 ${(_a = zones.defaultTaxZoneId) !== null && _a !== void 0 ? _a : '-'} / 配送区 ${(_b = zones.defaultShippingZoneId) !== null && _b !== void 0 ? _b : '-'}`, constants_1.loggerCtx);
        }
        return zones;
    }
    /** 按 code 找到配送/支付方式并幂等绑定到渠道，返回渠道内可用的 id 列表 */
    async ensureMethodsInChannel(ctx, channelId, entity, entityName, codes, warnings) {
        var _a, _b, _c;
        if (codes.length === 0) {
            return [];
        }
        let methods = [];
        try {
            methods = await this.connection.getRepository(ctx, entity).find({
                where: { code: (0, typeorm_1.In)(codes) },
                relations: ['channels'],
            });
        }
        catch (e) {
            warnings.push(`查询 ${entityName} 失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
            return [];
        }
        for (const code of codes) {
            if (!methods.some(m => m.code === code)) {
                warnings.push(`${entityName} code=${code} 不存在`);
            }
        }
        const bound = [];
        for (const method of methods) {
            const inChannel = ((_b = method.channels) !== null && _b !== void 0 ? _b : []).some((c) => String(c.id) === String(channelId));
            if (!inChannel) {
                try {
                    await this.channelService.assignToChannels(ctx, entity, method.id, [channelId]);
                }
                catch (e) {
                    warnings.push(`绑定 ${entityName} code=${method.code} 失败：${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`);
                    continue;
                }
            }
            bound.push(method.id);
        }
        return bound;
    }
    /**
     * 无租户默认配送档案时创建并设为默认，挂上已绑定的配送方式（default mode=mail）。
     * 这是 `not all lines have shipping` 的治本点：BoxShippingLineAssignmentStrategy
     * 在变体未绑定档案时回退租户默认档案，没有默认档案就没有 shippingLineId。
     */
    async ensureTenantDefaultShippingProfile(ctx, channel, shippingMethodIds, warnings) {
        var _a;
        if (shippingMethodIds.length === 0) {
            warnings.push('无可用配送方式，跳过默认配送档案创建');
            return null;
        }
        try {
            // 运行期按实体名取仓库，避免在测试环境求值实体装饰器（同 tenant-member.service 的做法）
            const profileRepo = this.connection.getRepository(ctx, 'ShippingProfile');
            const existing = await profileRepo.findOne({
                where: {
                    ownerChannelId: channel.id,
                    isGlobal: false,
                    isTenantDefault: true,
                    enabled: true,
                },
            });
            if (existing) {
                return existing.id;
            }
            const profile = profileRepo.create({
                name: '默认配送',
                code: `${channel.code}-default`,
                isGlobal: false,
                ownerChannelId: channel.id,
                isTenantDefault: true,
                enabled: true,
                requiresAddress: true,
                requiresContact: false,
                channels: [{ id: channel.id }],
                shippingMethods: shippingMethodIds.map(id => ({ id })),
            });
            const saved = await profileRepo.save(profile);
            const profileId = saved.id;
            // 配送能力真源：档案 × 方式 的工作模式（默认 mail）；失败不影响档案可用
            const methodRepo = this.connection.getRepository(ctx, 'ShippingProfileMethod');
            for (const shippingMethodId of shippingMethodIds) {
                await methodRepo.save(methodRepo.create({
                    profileId: String(profileId),
                    shippingMethodId: String(shippingMethodId),
                    mode: 'mail',
                    options: null,
                }));
            }
            core_1.Logger.info(`渠道 ${channel.code} 已创建默认配送档案 ${profileId}`, constants_1.loggerCtx);
            return profileId;
        }
        catch (e) {
            warnings.push(`创建默认配送档案失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
            return null;
        }
    }
};
exports.ChannelProvisioningService = ChannelProvisioningService;
exports.ChannelProvisioningService = ChannelProvisioningService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ChannelService])
], ChannelProvisioningService);
//# sourceMappingURL=channel-provisioning.service.js.map