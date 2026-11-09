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
exports.OnebridgeCustomsService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const errors_1 = require("../errors");
const entities_1 = require("../entities");
const stages_1 = require("../stages");
const types_1 = require("../types");
const channel_context_1 = require("./channel-context");
/** 清关状态机（CT-06）；只允许前进与 hold 兜底，非法回退返回 CUSTOMS_SYNC_FAILED。 */
const CUSTOMS_FLOW = {
    not_started: ['docs_preparing', 'declared', 'hold'],
    docs_preparing: ['declared', 'hold'],
    declared: ['inspecting', 'cleared', 'hold'],
    inspecting: ['cleared', 'hold'],
    cleared: ['hold'],
    hold: ['docs_preparing', 'declared', 'inspecting', 'cleared'],
};
let OnebridgeCustomsService = class OnebridgeCustomsService {
    constructor(connection, orderService, customerService) {
        this.connection = connection;
        this.orderService = orderService;
        this.customerService = customerService;
    }
    async upsert(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g;
        const channelToken = (0, channel_context_1.resolveChannelToken)(ctx);
        if (!((_a = input.orderCode) === null || _a === void 0 ? void 0 : _a.trim()))
            throw new core_1.UserInputError('orderCode is required');
        if (input.customsStatus && !types_1.CUSTOMS_STATUSES.includes(input.customsStatus)) {
            throw new core_1.UserInputError(`Unknown customs status: ${input.customsStatus}`);
        }
        const repo = this.repo(ctx);
        if (input.idempotencyKey) {
            const hit = await repo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
            // 幂等命中直接返回最后已知状态，不重复写时间轴/订单阶段
            if (hit)
                return hit;
        }
        const orderCode = input.orderCode.trim();
        const existing = await repo.findOne({ where: { orderCode } });
        const record = existing !== null && existing !== void 0 ? existing : new entities_1.CustomsRecord({ orderCode, customsStatus: 'not_started' });
        const nextStatus = (_b = input.customsStatus) !== null && _b !== void 0 ? _b : record.customsStatus;
        if (existing && nextStatus !== record.customsStatus && !CUSTOMS_FLOW[record.customsStatus].includes(nextStatus)) {
            throw errors_1.Errors.customsSyncFailed(`Illegal customs transition: ${record.customsStatus} -> ${nextStatus}`);
        }
        record.customsStatus = nextStatus;
        record.declaredAt = (_c = this.asDate(input.declaredAt)) !== null && _c !== void 0 ? _c : record.declaredAt;
        record.clearedAt = (_d = this.asDate(input.clearedAt)) !== null && _d !== void 0 ? _d : record.clearedAt;
        if (nextStatus === 'declared' && !record.declaredAt)
            record.declaredAt = new Date();
        if (nextStatus === 'cleared' && !record.clearedAt)
            record.clearedAt = new Date();
        if (input.hsCode !== undefined)
            record.hsCode = ((_e = input.hsCode) === null || _e === void 0 ? void 0 : _e.trim()) || null;
        if (input.declarationNo !== undefined)
            record.declarationNo = ((_f = input.declarationNo) === null || _f === void 0 ? void 0 : _f.trim()) || null;
        if (input.note !== undefined)
            record.note = input.note;
        if (input.docs !== undefined)
            record.docs = input.docs;
        record.lastSyncedAt = new Date();
        record.idempotencyKey = (_g = input.idempotencyKey) !== null && _g !== void 0 ? _g : record.idempotencyKey;
        const saved = await repo.save(record);
        if (nextStatus === 'cleared') {
            await this.onCleared(ctx, orderCode, channelToken);
        }
        return saved;
    }
    async findByOrderCode(ctx, orderCode) {
        (0, channel_context_1.resolveChannelToken)(ctx);
        return this.repo(ctx).findOne({ where: { orderCode } });
    }
    async shopFind(ctx, orderCode) {
        (0, channel_context_1.resolveChannelToken)(ctx);
        await this.assertOrderOwnership(ctx, orderCode);
        return this.repo(ctx).findOne({ where: { orderCode } });
    }
    async adminList(ctx, options) {
        var _a, _b;
        (0, channel_context_1.resolveChannelToken)(ctx);
        const qb = this.repo(ctx).createQueryBuilder('record');
        if (options === null || options === void 0 ? void 0 : options.customsStatus) {
            qb.andWhere('record.customsStatus = :status', { status: options.customsStatus });
        }
        if (options === null || options === void 0 ? void 0 : options.keyword) {
            qb.andWhere('(record.orderCode LIKE :kw OR record.declarationNo LIKE :kw)', {
                kw: `%${options.keyword.trim()}%`,
            });
        }
        qb.orderBy('record.lastSyncedAt', 'DESC')
            .skip(Math.max(0, (_a = options === null || options === void 0 ? void 0 : options.skip) !== null && _a !== void 0 ? _a : 0))
            .take(Math.min(100, Math.max(1, (_b = options === null || options === void 0 ? void 0 : options.take) !== null && _b !== void 0 ? _b : 20)));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    repo(ctx) {
        return this.connection.getRepository(ctx, entities_1.CustomsRecord);
    }
    /** cleared 回写：订单业务阶段 + 时间轴事件（幂等：同一订单只留一条 customs 节点） */
    async onCleared(ctx, orderCode, channelToken) {
        const stageRepo = this.connection.getRepository(ctx, entities_1.StageEvent);
        const existingEvent = await stageRepo.findOne({
            where: { ownerType: 'order', ownerCode: orderCode, stage: 'customs' },
        });
        if (!existingEvent) {
            const label = stages_1.STAGE_META.customs.labelZh;
            await stageRepo.save(new entities_1.StageEvent({
                ownerType: 'order',
                ownerCode: orderCode,
                stage: 'customs',
                // TODO(韩文待补)：韩文文案缺失，titleKr 暂用中文占位
                titleKr: label,
                titleCn: label,
                descKr: null,
                descCn: null,
                state: 'now',
                occurredAt: new Date(),
                operator: ctx.activeUserId ? String(ctx.activeUserId) : null,
                idempotencyKey: `customs:${channelToken}:${orderCode}:cleared`,
            }));
        }
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer', 'lines', 'surcharges']);
        if (!order)
            return;
        const customFields = order.customFields;
        if (customFields.crossBorderStage !== 'customs') {
            customFields.crossBorderStage = 'customs';
            await this.connection.getRepository(ctx, core_1.Order).save(order);
        }
    }
    async assertOrderOwnership(ctx, orderCode) {
        var _a;
        if (!ctx.activeUserId)
            throw new core_1.UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer']);
        if (!customer || !order || ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.id) !== customer.id) {
            throw errors_1.Errors.orderNotFound(orderCode);
        }
    }
    asDate(value) {
        if (!value)
            return null;
        return value instanceof Date ? value : new Date(value);
    }
};
exports.OnebridgeCustomsService = OnebridgeCustomsService;
exports.OnebridgeCustomsService = OnebridgeCustomsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.OrderService,
        core_1.CustomerService])
], OnebridgeCustomsService);
//# sourceMappingURL=customs.service.js.map