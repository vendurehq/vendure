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
exports.OnebridgeOrderSummaryService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const errors_1 = require("../errors");
const entities_1 = require("../entities");
const channel_context_1 = require("./channel-context");
/** 订单聚合（CT-04）：标准 Order 字段 + 跨境 customFields + StageEvent 时间轴。 */
let OnebridgeOrderSummaryService = class OnebridgeOrderSummaryService {
    constructor(connection, orderService, customerService) {
        this.connection = connection;
        this.orderService = orderService;
        this.customerService = customerService;
    }
    async summary(ctx, orderCode, enforceOwnership) {
        var _a, _b, _c, _d, _e, _f, _g;
        (0, channel_context_1.resolveChannelToken)(ctx);
        const order = await this.orderService.findOneByCode(ctx, orderCode, [
            'customer',
            'lines',
            'lines.productVariant',
            'lines.productVariant.product',
        ]);
        if (!order)
            throw errors_1.Errors.orderNotFound(orderCode);
        if (enforceOwnership)
            await this.assertOwnership(ctx, order);
        const customFields = order.customFields;
        return {
            code: order.code,
            state: order.state,
            totalWithTax: order.totalWithTax,
            currencyCode: order.currencyCode,
            businessLine: (_a = customFields === null || customFields === void 0 ? void 0 : customFields.businessLine) !== null && _a !== void 0 ? _a : null,
            crossBorderStage: (_b = customFields === null || customFields === void 0 ? void 0 : customFields.crossBorderStage) !== null && _b !== void 0 ? _b : null,
            rfqCode: (_c = customFields === null || customFields === void 0 ? void 0 : customFields.rfqCode) !== null && _c !== void 0 ? _c : null,
            needType: (_d = customFields === null || customFields === void 0 ? void 0 : customFields.needType) !== null && _d !== void 0 ? _d : null,
            krwAmount: (_e = customFields === null || customFields === void 0 ? void 0 : customFields.krwAmount) !== null && _e !== void 0 ? _e : null,
            expectedEta: (_f = customFields === null || customFields === void 0 ? void 0 : customFields.expectedEta) !== null && _f !== void 0 ? _f : null,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            items: ((_g = order.lines) !== null && _g !== void 0 ? _g : []).map((line) => {
                var _a, _b, _c, _d, _e, _f, _g;
                const variant = line.productVariant;
                const translated = (_a = variant === null || variant === void 0 ? void 0 : variant.translations) === null || _a === void 0 ? void 0 : _a.find((t) => t.languageCode === ctx.languageCode);
                return {
                    id: line.id,
                    productVariantId: (_b = variant === null || variant === void 0 ? void 0 : variant.id) !== null && _b !== void 0 ? _b : null,
                    name: (_d = (_c = translated === null || translated === void 0 ? void 0 : translated.name) !== null && _c !== void 0 ? _c : variant === null || variant === void 0 ? void 0 : variant.sku) !== null && _d !== void 0 ? _d : '',
                    spec: (_g = (_f = (_e = variant === null || variant === void 0 ? void 0 : variant.product) === null || _e === void 0 ? void 0 : _e.customFields) === null || _f === void 0 ? void 0 : _f.spec) !== null && _g !== void 0 ? _g : null,
                    qty: line.quantity,
                    price: line.linePriceWithTax,
                };
            }),
            timeline: await this.timeline(ctx, order.code),
        };
    }
    async timeline(ctx, orderCode) {
        return this.connection.getRepository(ctx, entities_1.StageEvent).find({
            where: { ownerType: 'order', ownerCode: orderCode },
            order: { occurredAt: 'ASC' },
        });
    }
    /**
     * 物流轨迹（CT-09 orderTracks）：承运商单号/状态读 logistics-plugin 的 logistics_track；
     * 承运商轨迹接入前，trackInfo 复用 CT-10 业务时间轴，避免前端出现空轨道。
     * TODO(联调)：logistics_track.trackInfo 的承运商节点映射与 carrierName 字典待物流插件提供。
     */
    async orderTracks(ctx, orderCode, enforceOwnership = true) {
        var _a, _b, _c, _d, _e, _f, _g;
        (0, channel_context_1.resolveChannelToken)(ctx);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['fulfillments', 'customer']);
        if (!order)
            throw errors_1.Errors.orderNotFound(orderCode);
        if (enforceOwnership)
            await this.assertOwnership(ctx, order);
        const fulfillmentIds = ((_a = order.fulfillments) !== null && _a !== void 0 ? _a : []).map((f) => Number(f.id)).filter(Number.isFinite);
        const track = await this.latestLogisticsTrack(fulfillmentIds);
        return {
            orderCode,
            fulfillmentId: (track === null || track === void 0 ? void 0 : track.fulfillmentId) != null ? String(track.fulfillmentId) : null,
            trackingNo: (_b = track === null || track === void 0 ? void 0 : track.trackingNo) !== null && _b !== void 0 ? _b : null,
            carrierCode: (_c = track === null || track === void 0 ? void 0 : track.carrierCode) !== null && _c !== void 0 ? _c : null,
            carrierName: (_d = track === null || track === void 0 ? void 0 : track.carrierCode) !== null && _d !== void 0 ? _d : null,
            status: (_e = track === null || track === void 0 ? void 0 : track.status) !== null && _e !== void 0 ? _e : 'unknown',
            trackInfo: await this.timeline(ctx, orderCode),
            signedAt: (_f = track === null || track === void 0 ? void 0 : track.signedAt) !== null && _f !== void 0 ? _f : null,
            lastSyncedAt: (_g = track === null || track === void 0 ? void 0 : track.lastSyncedAt) !== null && _g !== void 0 ? _g : null,
            channelId: String(ctx.channelId),
        };
    }
    /** 读取最近一条物流轨迹；logistics-plugin 未安装/未建表时返回 null（不阻断联调） */
    async latestLogisticsTrack(fulfillmentIds) {
        if (!fulfillmentIds.length)
            return null;
        const runner = this.connection.rawConnection.createQueryRunner();
        try {
            if (!(await runner.hasTable('logistics_track')))
                return null;
            return await runner.manager
                .createQueryBuilder()
                .select([
                't.id AS id',
                't.fulfillmentId AS fulfillmentId',
                't.trackingNo AS trackingNo',
                't.carrierCode AS carrierCode',
                't.status AS status',
                't.signedAt AS signedAt',
                't.lastSyncedAt AS lastSyncedAt',
            ])
                .from('logistics_track', 't')
                .where('t.fulfillmentId IN (:...ids)', { ids: fulfillmentIds })
                .orderBy('t.id', 'DESC')
                .limit(1)
                .getRawOne();
        }
        finally {
            await runner.release();
        }
    }
    async assertOwnership(ctx, order) {
        var _a;
        if (!ctx.activeUserId)
            throw new core_1.UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer || ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.id) !== customer.id) {
            throw errors_1.Errors.orderNotFound(order.code);
        }
    }
};
exports.OnebridgeOrderSummaryService = OnebridgeOrderSummaryService;
exports.OnebridgeOrderSummaryService = OnebridgeOrderSummaryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.OrderService,
        core_1.CustomerService])
], OnebridgeOrderSummaryService);
//# sourceMappingURL=order-summary.service.js.map