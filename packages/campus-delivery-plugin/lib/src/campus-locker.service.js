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
exports.CampusLockerService = void 0;
// P2-4 智能取餐柜（站点登记 + C 端只读展示）与无人配送通道（配置 + 调用占位）。
//
// 取餐柜：后台按渠道维护站点（名称/位置/格口/取餐指引），C 端只读 enabled 的站点。
// 无人配送：配置挂在 campus_fulfillment_config（enabled/provider/endpoint/key），
//           requestDelivery 为占位适配器——mock 直接模拟受理，真实厂商留待后续接 SDK。
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_locker_entity_1 = require("./campus-locker.entity");
const campus_config_service_1 = require("./campus-config.service");
const unmanned_delivery_1 = require("./unmanned-delivery");
/** 取餐柜服务商：self=自建，其余复用无人配送服务商清单（排除none） */
const LOCKER_PROVIDER_CODES = ['self', ...unmanned_delivery_1.UNMANNED_PROVIDERS.filter(p => p.code !== 'none').map(p => p.code)];
let CampusLockerService = class CampusLockerService {
    constructor(connection, configService) {
        this.connection = connection;
        this.configService = configService;
    }
    repo(ctx) {
        return this.connection.getRepository(ctx, campus_locker_entity_1.CampusLockerStation);
    }
    // ===== 取餐柜站点 =====
    /** 后台：本渠道全部站点（含停用） */
    async adminList(ctx) {
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 200,
        });
        return rows.map(r => this.toView(r));
    }
    /** C 端：本渠道启用站点（按 sort / 创建时间） */
    async shopList(ctx) {
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId, enabled: true },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 50,
        });
        return rows.map(r => this.toView(r));
    }
    async create(ctx, input) {
        const data = this.normalize(input, true);
        const row = await this.repo(ctx).save(new campus_locker_entity_1.CampusLockerStation(Object.assign(Object.assign({ channelId: ctx.channelId }, data), { createdBy: ctx.activeUserId ? String(ctx.activeUserId) : null })));
        return this.toView(row);
    }
    async update(ctx, id, input) {
        const row = await this.findOwn(ctx, id);
        const data = this.normalize(input, false, row);
        Object.assign(row, data);
        await this.repo(ctx).save(row);
        return this.toView(row);
    }
    async remove(ctx, id) {
        const row = await this.findOwn(ctx, id);
        await this.repo(ctx).remove(row);
        return true;
    }
    async findOwn(ctx, id) {
        const row = await this.repo(ctx).findOne({ where: { id: id, channelId: ctx.channelId } });
        if (!row)
            throw new core_1.UserInputError('取餐柜站点不存在');
        return row;
    }
    toView(row) {
        return Object.assign(Object.assign({}, row), { providerName: row.provider === 'self' ? '自建' : (0, unmanned_delivery_1.findUnmannedProvider)(row.provider).name });
    }
    /** 入参归一化 + 校验：create 时必填项缺失直接拒绝；update 只校验传入字段 */
    normalize(input, isCreate, current) {
        var _a, _b, _c, _d;
        const patch = {};
        const pickStr = (key) => {
            const raw = input === null || input === void 0 ? void 0 : input[key];
            if (raw === undefined)
                return;
            const v = String(raw !== null && raw !== void 0 ? raw : '').trim();
            patch[key] = v || null;
        };
        if (isCreate || (input === null || input === void 0 ? void 0 : input.name) !== undefined) {
            pickStr('name');
            const name = String((_a = patch.name) !== null && _a !== void 0 ? _a : '').trim();
            if (!name)
                throw new core_1.UserInputError('柜机名称不能为空');
            if (name.length > 64)
                throw new core_1.UserInputError('柜机名称不能超过 64 个字符');
            patch.name = name;
        }
        if (isCreate || (input === null || input === void 0 ? void 0 : input.location) !== undefined) {
            pickStr('location');
            const location = String((_b = patch.location) !== null && _b !== void 0 ? _b : '').trim();
            if (!location)
                throw new core_1.UserInputError('柜机位置不能为空');
            if (location.length > 255)
                throw new core_1.UserInputError('柜机位置不能超过 255 个字符');
            patch.location = location;
        }
        if ((input === null || input === void 0 ? void 0 : input.provider) !== undefined || isCreate) {
            const provider = String((_c = input === null || input === void 0 ? void 0 : input.provider) !== null && _c !== void 0 ? _c : 'self').trim() || 'self';
            if (!LOCKER_PROVIDER_CODES.includes(provider))
                throw new core_1.UserInputError('取餐柜服务商不合法');
            patch.provider = provider;
        }
        const totalCells = (input === null || input === void 0 ? void 0 : input.totalCells) !== undefined ? Number(input.totalCells) : undefined;
        if (totalCells !== undefined) {
            if (!Number.isInteger(totalCells) || totalCells < 0 || totalCells > 2000) {
                throw new core_1.UserInputError('格口总数必须为 0-2000 的整数');
            }
            patch.totalCells = totalCells;
        }
        const availableCells = (input === null || input === void 0 ? void 0 : input.availableCells) !== undefined ? Number(input.availableCells) : undefined;
        if (availableCells !== undefined) {
            const total = (_d = totalCells !== null && totalCells !== void 0 ? totalCells : current === null || current === void 0 ? void 0 : current.totalCells) !== null && _d !== void 0 ? _d : 0;
            if (!Number.isInteger(availableCells) || availableCells < 0) {
                throw new core_1.UserInputError('可用格口必须为不小于 0 的整数');
            }
            if (availableCells > total)
                throw new core_1.UserInputError('可用格口不能超过格口总数');
            patch.availableCells = availableCells;
        }
        if ((input === null || input === void 0 ? void 0 : input.openHours) !== undefined) {
            pickStr('openHours');
            const hours = patch.openHours;
            if (hours && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(hours)) {
                throw new core_1.UserInputError('开放时间格式需为 HH:mm-HH:mm');
            }
        }
        if ((input === null || input === void 0 ? void 0 : input.pickupGuide) !== undefined) {
            pickStr('pickupGuide');
            const guide = patch.pickupGuide;
            if (guide && guide.length > 500)
                throw new core_1.UserInputError('取餐指引不能超过 500 个字符');
        }
        if ((input === null || input === void 0 ? void 0 : input.enabled) !== undefined)
            patch.enabled = !!input.enabled;
        if ((input === null || input === void 0 ? void 0 : input.sort) !== undefined) {
            const sort = Number(input.sort);
            if (!Number.isInteger(sort) || sort < 0 || sort > 999)
                throw new core_1.UserInputError('排序必须为 0-999 的整数');
            patch.sort = sort;
        }
        return patch;
    }
    // ===== 无人配送通道 =====
    /** 后台：通道配置视图（密钥只回是否已配，不回明文） */
    async channel(ctx) {
        var _a;
        const cfg = await this.configService.getConfig(ctx);
        const provider = (0, unmanned_delivery_1.findUnmannedProvider)(cfg.unmannedDeliveryProvider);
        return {
            enabled: !!cfg.unmannedDeliveryEnabled,
            provider: provider.code,
            providerName: provider.name,
            providers: unmanned_delivery_1.UNMANNED_PROVIDERS.map(p => ({ code: p.code, name: p.name, needsEndpoint: p.needsEndpoint, needsKey: p.needsKey, integrated: p.integrated })),
            endpoint: (_a = cfg.unmannedDeliveryEndpoint) !== null && _a !== void 0 ? _a : null,
            keyConfigured: !!cfg.unmannedDeliveryKey,
            needsEndpoint: provider.needsEndpoint,
            needsKey: provider.needsKey,
            integrated: provider.integrated,
        };
    }
    /** 后台：保存通道配置（endpoint / key 传空串 = 清空） */
    async updateChannel(ctx, input) {
        var _a, _b, _c, _d;
        const cfg = await this.configService.getConfig(ctx);
        const patch = {};
        if ((input === null || input === void 0 ? void 0 : input.enabled) !== undefined)
            patch.unmannedDeliveryEnabled = !!input.enabled;
        if ((input === null || input === void 0 ? void 0 : input.provider) !== undefined) {
            const provider = String((_a = input.provider) !== null && _a !== void 0 ? _a : '').trim();
            if (!unmanned_delivery_1.UNMANNED_PROVIDERS.some(p => p.code === provider))
                throw new core_1.UserInputError('无人配送服务商不合法');
            patch.unmannedDeliveryProvider = provider;
            if (provider === 'none')
                patch.unmannedDeliveryEnabled = false;
        }
        if ((input === null || input === void 0 ? void 0 : input.endpoint) !== undefined) {
            const endpoint = String((_b = input.endpoint) !== null && _b !== void 0 ? _b : '').trim();
            if (endpoint && !/^https?:\/\//i.test(endpoint))
                throw new core_1.UserInputError('接口地址需为 http(s) 地址');
            patch.unmannedDeliveryEndpoint = endpoint || null;
        }
        if ((input === null || input === void 0 ? void 0 : input.key) !== undefined) {
            const key = String((_c = input.key) !== null && _c !== void 0 ? _c : '').trim();
            patch.unmannedDeliveryKey = key || null;
        }
        // 开启时校验：真实厂商必须有接口地址与密钥，否则调用必然失败
        const nextEnabled = patch.unmannedDeliveryEnabled !== undefined ? patch.unmannedDeliveryEnabled : !!cfg.unmannedDeliveryEnabled;
        const nextProvider = (0, unmanned_delivery_1.findUnmannedProvider)((_d = patch.unmannedDeliveryProvider) !== null && _d !== void 0 ? _d : cfg.unmannedDeliveryProvider);
        const nextEndpoint = patch.unmannedDeliveryEndpoint !== undefined ? patch.unmannedDeliveryEndpoint : cfg.unmannedDeliveryEndpoint;
        const nextKey = patch.unmannedDeliveryKey !== undefined ? patch.unmannedDeliveryKey : cfg.unmannedDeliveryKey;
        if (nextEnabled) {
            if (nextProvider.code === 'none')
                throw new core_1.UserInputError('未开通服务商，不能开启无人配送');
            if (nextProvider.needsEndpoint && !nextEndpoint)
                throw new core_1.UserInputError('该服务商需要填写接口地址');
            if (nextProvider.needsKey && !nextKey)
                throw new core_1.UserInputError('该服务商需要填写密钥');
        }
        await this.configService.updateConfig(ctx, patch);
        return this.channel(ctx);
    }
    /**
     * 调用占位：校验通道配置后「受理」一次无人配送请求。
     * 真实厂商接入时替换本方法内的 submit 逻辑，返回结构保持不变。
     */
    async requestDelivery(ctx, orderId) {
        const cfg = await this.configService.getConfig(ctx);
        const provider = (0, unmanned_delivery_1.findUnmannedProvider)(cfg.unmannedDeliveryProvider);
        const base = { provider: provider.code, providerName: provider.name, requestNo: null };
        if (!cfg.unmannedDeliveryEnabled || provider.code === 'none') {
            return Object.assign(Object.assign({}, base), { ok: false, status: 'disabled', message: '无人配送通道未开启' });
        }
        const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: orderId, channelId: ctx.channelId },
        });
        if (!order)
            throw new core_1.UserInputError('订单不存在');
        if (provider.needsEndpoint && !cfg.unmannedDeliveryEndpoint) {
            return Object.assign(Object.assign({}, base), { ok: false, status: 'unconfigured', message: '无人配送接口地址未配置' });
        }
        if (provider.needsKey && !cfg.unmannedDeliveryKey) {
            return Object.assign(Object.assign({}, base), { ok: false, status: 'unconfigured', message: '无人配送密钥未配置' });
        }
        // L1：只有 mock 允许「受理」；真实厂商未接入时必须明确失败，不伪造运单号，
        // 否则商家会误以为已下发无人车，且该假单号可能被记录进履约链路。
        if (provider.code !== 'mock') {
            return Object.assign(Object.assign({}, base), { ok: false, status: 'unsupported', message: `${provider.name}通道尚未接入，未下发运单` });
        }
        const requestNo = `MOCK-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
        return Object.assign(Object.assign({}, base), { ok: true, status: 'accepted', requestNo, message: '模拟通道已受理（未真实下发运单，仅用于联调验证）' });
    }
};
exports.CampusLockerService = CampusLockerService;
exports.CampusLockerService = CampusLockerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection, campus_config_service_1.CampusConfigService])
], CampusLockerService);
//# sourceMappingURL=campus-locker.service.js.map