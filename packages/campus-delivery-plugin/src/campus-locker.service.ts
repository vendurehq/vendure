// P2-4 智能取餐柜（站点登记 + C 端只读展示）与无人配送通道（配置 + 调用占位）。
//
// 取餐柜：后台按渠道维护站点（名称/位置/格口/取餐指引），C 端只读 enabled 的站点。
// 无人配送：配置挂在 campus_fulfillment_config（enabled/provider/endpoint/key），
//           requestDelivery 为占位适配器——mock 直接模拟受理，真实厂商留待后续接 SDK。
import { Injectable } from '@nestjs/common';
import { ID, Order, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { CampusLockerStation } from './campus-locker.entity';
import { CampusConfigService } from './campus-config.service';
import { findUnmannedProvider, UNMANNED_PROVIDERS, type UnmannedDeliveryResult } from './unmanned-delivery';

export interface LockerStationInput {
    name?: string;
    location?: string;
    provider?: string;
    totalCells?: number;
    availableCells?: number;
    openHours?: string | null;
    pickupGuide?: string | null;
    enabled?: boolean;
    sort?: number;
}

export interface UnmannedChannelInput {
    enabled?: boolean;
    provider?: string;
    endpoint?: string | null;
    key?: string | null;
}

/** 取餐柜服务商：self=自建，其余复用无人配送服务商清单（排除none） */
const LOCKER_PROVIDER_CODES = ['self', ...UNMANNED_PROVIDERS.filter(p => p.code !== 'none').map(p => p.code)];

@Injectable()
export class CampusLockerService {
    constructor(private connection: TransactionalConnection, private configService: CampusConfigService) {}

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CampusLockerStation);
    }

    // ===== 取餐柜站点 =====

    /** 后台：本渠道全部站点（含停用） */
    async adminList(ctx: RequestContext) {
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId as any },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 200,
        });
        return rows.map(r => this.toView(r));
    }

    /** C 端：本渠道启用站点（按 sort / 创建时间） */
    async shopList(ctx: RequestContext) {
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId as any, enabled: true },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 50,
        });
        return rows.map(r => this.toView(r));
    }

    async create(ctx: RequestContext, input: LockerStationInput) {
        const data = this.normalize(input, true);
        const row = await this.repo(ctx).save(
            new CampusLockerStation({
                channelId: ctx.channelId as any,
                ...data,
                createdBy: ctx.activeUserId ? String(ctx.activeUserId) : null,
            } as any),
        );
        return this.toView(row);
    }

    async update(ctx: RequestContext, id: ID, input: LockerStationInput) {
        const row = await this.findOwn(ctx, id);
        const data = this.normalize(input, false, row);
        Object.assign(row, data);
        await this.repo(ctx).save(row);
        return this.toView(row);
    }

    async remove(ctx: RequestContext, id: ID) {
        const row = await this.findOwn(ctx, id);
        await this.repo(ctx).remove(row);
        return true;
    }

    private async findOwn(ctx: RequestContext, id: ID) {
        const row = await this.repo(ctx).findOne({ where: { id: id as any, channelId: ctx.channelId as any } });
        if (!row) throw new UserInputError('取餐柜站点不存在');
        return row;
    }

    private toView(row: CampusLockerStation) {
        return {
            ...row,
            providerName: row.provider === 'self' ? '自建' : findUnmannedProvider(row.provider).name,
        };
    }

    /** 入参归一化 + 校验：create 时必填项缺失直接拒绝；update 只校验传入字段 */
    private normalize(input: LockerStationInput, isCreate: boolean, current?: CampusLockerStation): Partial<CampusLockerStation> {
        const patch: Partial<CampusLockerStation> = {};
        const pickStr = (key: 'name' | 'location' | 'openHours' | 'pickupGuide') => {
            const raw = (input as any)?.[key];
            if (raw === undefined) return;
            const v = String(raw ?? '').trim();
            (patch as any)[key] = v || null;
        };
        if (isCreate || input?.name !== undefined) {
            pickStr('name');
            const name = String(patch.name ?? '').trim();
            if (!name) throw new UserInputError('柜机名称不能为空');
            if (name.length > 64) throw new UserInputError('柜机名称不能超过 64 个字符');
            patch.name = name;
        }
        if (isCreate || input?.location !== undefined) {
            pickStr('location');
            const location = String(patch.location ?? '').trim();
            if (!location) throw new UserInputError('柜机位置不能为空');
            if (location.length > 255) throw new UserInputError('柜机位置不能超过 255 个字符');
            patch.location = location;
        }
        if (input?.provider !== undefined || isCreate) {
            const provider = String(input?.provider ?? 'self').trim() || 'self';
            if (!LOCKER_PROVIDER_CODES.includes(provider)) throw new UserInputError('取餐柜服务商不合法');
            patch.provider = provider;
        }
        const totalCells = input?.totalCells !== undefined ? Number(input.totalCells) : undefined;
        if (totalCells !== undefined) {
            if (!Number.isInteger(totalCells) || totalCells < 0 || totalCells > 2000) {
                throw new UserInputError('格口总数必须为 0-2000 的整数');
            }
            patch.totalCells = totalCells;
        }
        const availableCells = input?.availableCells !== undefined ? Number(input.availableCells) : undefined;
        if (availableCells !== undefined) {
            const total = totalCells ?? current?.totalCells ?? 0;
            if (!Number.isInteger(availableCells) || availableCells < 0) {
                throw new UserInputError('可用格口必须为不小于 0 的整数');
            }
            if (availableCells > total) throw new UserInputError('可用格口不能超过格口总数');
            patch.availableCells = availableCells;
        }
        if (input?.openHours !== undefined) {
            pickStr('openHours');
            const hours = patch.openHours as string | null;
            if (hours && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(hours)) {
                throw new UserInputError('开放时间格式需为 HH:mm-HH:mm');
            }
        }
        if (input?.pickupGuide !== undefined) {
            pickStr('pickupGuide');
            const guide = patch.pickupGuide as string | null;
            if (guide && guide.length > 500) throw new UserInputError('取餐指引不能超过 500 个字符');
        }
        if (input?.enabled !== undefined) patch.enabled = !!input.enabled;
        if (input?.sort !== undefined) {
            const sort = Number(input.sort);
            if (!Number.isInteger(sort) || sort < 0 || sort > 999) throw new UserInputError('排序必须为 0-999 的整数');
            patch.sort = sort;
        }
        return patch;
    }

    // ===== 无人配送通道 =====

    /** 后台：通道配置视图（密钥只回是否已配，不回明文） */
    async channel(ctx: RequestContext) {
        const cfg = await this.configService.getConfig(ctx);
        const provider = findUnmannedProvider(cfg.unmannedDeliveryProvider);
        return {
            enabled: !!cfg.unmannedDeliveryEnabled,
            provider: provider.code,
            providerName: provider.name,
            providers: UNMANNED_PROVIDERS.map(p => ({ code: p.code, name: p.name, needsEndpoint: p.needsEndpoint, needsKey: p.needsKey })),
            endpoint: cfg.unmannedDeliveryEndpoint ?? null,
            keyConfigured: !!cfg.unmannedDeliveryKey,
            needsEndpoint: provider.needsEndpoint,
            needsKey: provider.needsKey,
        };
    }

    /** 后台：保存通道配置（endpoint / key 传空串 = 清空） */
    async updateChannel(ctx: RequestContext, input: UnmannedChannelInput) {
        const cfg = await this.configService.getConfig(ctx);
        const patch: Record<string, any> = {};
        if (input?.enabled !== undefined) patch.unmannedDeliveryEnabled = !!input.enabled;
        if (input?.provider !== undefined) {
            const provider = String(input.provider ?? '').trim();
            if (!UNMANNED_PROVIDERS.some(p => p.code === provider)) throw new UserInputError('无人配送服务商不合法');
            patch.unmannedDeliveryProvider = provider;
            if (provider === 'none') patch.unmannedDeliveryEnabled = false;
        }
        if (input?.endpoint !== undefined) {
            const endpoint = String(input.endpoint ?? '').trim();
            if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new UserInputError('接口地址需为 http(s) 地址');
            patch.unmannedDeliveryEndpoint = endpoint || null;
        }
        if (input?.key !== undefined) {
            const key = String(input.key ?? '').trim();
            patch.unmannedDeliveryKey = key || null;
        }
        // 开启时校验：真实厂商必须有接口地址与密钥，否则调用必然失败
        const nextEnabled = patch.unmannedDeliveryEnabled !== undefined ? patch.unmannedDeliveryEnabled : !!cfg.unmannedDeliveryEnabled;
        const nextProvider = findUnmannedProvider(patch.unmannedDeliveryProvider ?? cfg.unmannedDeliveryProvider);
        const nextEndpoint = patch.unmannedDeliveryEndpoint !== undefined ? patch.unmannedDeliveryEndpoint : cfg.unmannedDeliveryEndpoint;
        const nextKey = patch.unmannedDeliveryKey !== undefined ? patch.unmannedDeliveryKey : cfg.unmannedDeliveryKey;
        if (nextEnabled) {
            if (nextProvider.code === 'none') throw new UserInputError('未开通服务商，不能开启无人配送');
            if (nextProvider.needsEndpoint && !nextEndpoint) throw new UserInputError('该服务商需要填写接口地址');
            if (nextProvider.needsKey && !nextKey) throw new UserInputError('该服务商需要填写密钥');
        }
        await this.configService.updateConfig(ctx, patch as any);
        return this.channel(ctx);
    }

    /**
     * 调用占位：校验通道配置后「受理」一次无人配送请求。
     * 真实厂商接入时替换本方法内的 submit 逻辑，返回结构保持不变。
     */
    async requestDelivery(ctx: RequestContext, orderId: ID): Promise<UnmannedDeliveryResult> {
        const cfg = await this.configService.getConfig(ctx);
        const provider = findUnmannedProvider(cfg.unmannedDeliveryProvider);
        const base = { provider: provider.code, providerName: provider.name, requestNo: null as string | null };
        if (!cfg.unmannedDeliveryEnabled || provider.code === 'none') {
            return { ...base, ok: false, status: 'disabled', message: '无人配送通道未开启' };
        }
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any, channelId: ctx.channelId as any } as any,
        });
        if (!order) throw new UserInputError('订单不存在');
        if (provider.needsEndpoint && !cfg.unmannedDeliveryEndpoint) {
            return { ...base, ok: false, status: 'unconfigured', message: '无人配送接口地址未配置' };
        }
        if (provider.needsKey && !cfg.unmannedDeliveryKey) {
            return { ...base, ok: false, status: 'unconfigured', message: '无人配送密钥未配置' };
        }
        // L1：只有 mock 允许「受理」；真实厂商未接入时必须明确失败，不伪造运单号，
        // 否则商家会误以为已下发无人车，且该假单号可能被记录进履约链路。
        if (provider.code !== 'mock') {
            return { ...base, ok: false, status: 'unsupported', message: `${provider.name}通道尚未接入，未下发运单` };
        }
        const requestNo = `MOCK-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
        return {
            ...base,
            ok: true,
            status: 'accepted',
            requestNo,
            message: '模拟通道已受理（未真实下发运单，仅用于联调验证）',
        };
    }
}
