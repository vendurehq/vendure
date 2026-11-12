import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    ID,
    Logger,
    PaymentMethod,
    RequestContext,
    ShippingMethod,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';
import { loggerCtx } from '../constants';

/**
 * 新渠道默认绑定的配送方式 code（按顺序取第一个存在的）。
 * 不写渠道 id，避免各环境 id 漂移。
 */
export const DEFAULT_PROVISION_SHIPPING_METHOD_CODES: string[] = ['courier-delivery'];

/**
 * 新渠道默认绑定的支付方式 code。
 * 只绑「可直接用于流程验证」的方式；korea-pg 一期是桩，默认不绑（见 B-04）。
 */
export const DEFAULT_PROVISION_PAYMENT_METHOD_CODES: string[] = ['cash-on-delivery'];

export interface ChannelProvisionResult {
    channelId: ID;
    defaultTaxZoneId: ID | null;
    defaultShippingZoneId: ID | null;
    shippingMethodIds: ID[];
    paymentMethodIds: ID[];
    shippingProfileId: ID | null;
    /** 非致命问题（缺 code、绑定失败等），调用方据需告警 */
    warnings: string[];
}

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
@Injectable()
export class ChannelProvisioningService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    /**
     * 读取默认渠道（`__default_channel__`）的税区 / 配送区，用于新渠道继承。
     * 供 createChannel 在 channelService.create 入参里直接带上。
     */
    async getDefaultChannelZones(
        ctx: RequestContext,
    ): Promise<{ defaultTaxZoneId: ID | null; defaultShippingZoneId: ID | null }> {
        try {
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            const repo = this.connection.getRepository(ctx, Channel);
            const loaded = await repo.findOne({
                where: { id: defaultChannel.id },
                relations: ['defaultTaxZone', 'defaultShippingZone'],
            });
            return {
                defaultTaxZoneId: loaded?.defaultTaxZone?.id ?? null,
                defaultShippingZoneId: loaded?.defaultShippingZone?.id ?? null,
            };
        } catch (e: any) {
            Logger.warn(`读取默认渠道税区/配送区失败：${e?.message ?? e}`, loggerCtx);
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
    async provision(
        ctx: RequestContext,
        channel: Channel,
        options?: {
            shippingMethodCodes?: string[];
            paymentMethodCodes?: string[];
            createDefaultShippingProfile?: boolean;
        },
    ): Promise<ChannelProvisionResult> {
        const channelId = channel.id;
        const shippingCodes = options?.shippingMethodCodes ?? DEFAULT_PROVISION_SHIPPING_METHOD_CODES;
        const paymentCodes = options?.paymentMethodCodes ?? DEFAULT_PROVISION_PAYMENT_METHOD_CODES;
        const warnings: string[] = [];

        const zones = await this.ensureDefaultZones(ctx, channelId, warnings);
        const shippingMethodIds = await this.ensureMethodsInChannel(
            ctx,
            channelId,
            ShippingMethod,
            'ShippingMethod',
            shippingCodes,
            warnings,
        );
        const paymentMethodIds = await this.ensureMethodsInChannel(
            ctx,
            channelId,
            PaymentMethod,
            'PaymentMethod',
            paymentCodes,
            warnings,
        );
        const shippingProfileId =
            options?.createDefaultShippingProfile === false
                ? null
                : await this.ensureTenantDefaultShippingProfile(ctx, channel, shippingMethodIds, warnings);

        if (warnings.length > 0) {
            Logger.warn(
                `渠道 ${channel.code} 兜底配置未完全就绪：${warnings.join('；')}`,
                loggerCtx,
            );
        } else {
            Logger.info(
                `渠道 ${channel.code} 兜底配置就绪（配送 ${shippingMethodIds.length} 个 / 支付 ${paymentMethodIds.length} 个 / 配送档案 ${shippingProfileId ?? '无'}）`,
                loggerCtx,
            );
        }

        return {
            channelId,
            defaultTaxZoneId: zones.defaultTaxZoneId ?? null,
            defaultShippingZoneId: zones.defaultShippingZoneId ?? null,
            shippingMethodIds,
            paymentMethodIds,
            shippingProfileId,
            warnings,
        };
    }

    /** 缺省继承默认渠道的税区/配送区；已有值不动（不覆盖人工配置） */
    private async ensureDefaultZones(
        ctx: RequestContext,
        channelId: ID,
        warnings: string[],
    ): Promise<{ defaultTaxZoneId: ID | null; defaultShippingZoneId: ID | null }> {
        const repo = this.connection.getRepository(ctx, Channel);
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
            fresh.defaultTaxZone = { id: zones.defaultTaxZoneId } as any;
            dirty = true;
        }
        if (fresh && !fresh.defaultShippingZone && zones.defaultShippingZoneId) {
            fresh.defaultShippingZone = { id: zones.defaultShippingZoneId } as any;
            dirty = true;
        }
        if (dirty && fresh) {
            await repo.save(fresh);
            Logger.info(
                `渠道 ${channelId} 已继承默认渠道税区 ${zones.defaultTaxZoneId ?? '-'} / 配送区 ${zones.defaultShippingZoneId ?? '-'}`,
                loggerCtx,
            );
        }
        return zones;
    }

    /** 按 code 找到配送/支付方式并幂等绑定到渠道，返回渠道内可用的 id 列表 */
    private async ensureMethodsInChannel(
        ctx: RequestContext,
        channelId: ID,
        entity: typeof ShippingMethod | typeof PaymentMethod,
        entityName: 'ShippingMethod' | 'PaymentMethod',
        codes: string[],
        warnings: string[],
    ): Promise<ID[]> {
        if (codes.length === 0) {
            return [];
        }
        let methods: any[] = [];
        try {
            methods = await this.connection.getRepository(ctx, entity).find({
                where: { code: In(codes) } as any,
                relations: ['channels'],
            });
        } catch (e: any) {
            warnings.push(`查询 ${entityName} 失败：${e?.message ?? e}`);
            return [];
        }
        for (const code of codes) {
            if (!methods.some(m => m.code === code)) {
                warnings.push(`${entityName} code=${code} 不存在`);
            }
        }
        const bound: ID[] = [];
        for (const method of methods) {
            const inChannel = (method.channels ?? []).some((c: any) => String(c.id) === String(channelId));
            if (!inChannel) {
                try {
                    await this.channelService.assignToChannels(ctx, entity as any, method.id, [channelId]);
                } catch (e: any) {
                    warnings.push(`绑定 ${entityName} code=${method.code} 失败：${e?.message ?? e}`);
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
    private async ensureTenantDefaultShippingProfile(
        ctx: RequestContext,
        channel: Channel,
        shippingMethodIds: ID[],
        warnings: string[],
    ): Promise<ID | null> {
        if (shippingMethodIds.length === 0) {
            warnings.push('无可用配送方式，跳过默认配送档案创建');
            return null;
        }
        try {
            // 运行期按实体名取仓库，避免在测试环境求值实体装饰器（同 tenant-member.service 的做法）
            const profileRepo = this.connection.getRepository(ctx, 'ShippingProfile' as any);
            const existing = await profileRepo.findOne({
                where: {
                    ownerChannelId: channel.id as any,
                    isGlobal: false,
                    isTenantDefault: true,
                    enabled: true,
                } as any,
            });
            if (existing) {
                return (existing as any).id as ID;
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
            } as any);
            const saved = await profileRepo.save(profile as any);
            const profileId = (saved as any).id as ID;

            // 配送能力真源：档案 × 方式 的工作模式（默认 mail）；失败不影响档案可用
            const methodRepo = this.connection.getRepository(ctx, 'ShippingProfileMethod' as any);
            for (const shippingMethodId of shippingMethodIds) {
                await methodRepo.save(
                    methodRepo.create({
                        profileId: String(profileId),
                        shippingMethodId: String(shippingMethodId),
                        mode: 'mail',
                        options: null,
                    } as any) as any,
                );
            }
            Logger.info(`渠道 ${channel.code} 已创建默认配送档案 ${profileId}`, loggerCtx);
            return profileId;
        } catch (e: any) {
            warnings.push(`创建默认配送档案失败：${e?.message ?? e}`);
            return null;
        }
    }
}
