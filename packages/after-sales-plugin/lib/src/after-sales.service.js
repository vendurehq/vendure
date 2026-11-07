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
var AfterSalesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AfterSalesService = void 0;
const common_1 = require("@nestjs/common");
const node_stream_1 = require("node:stream");
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const after_sales_request_entity_1 = require("./after-sales-request.entity");
const after_sales_message_entity_1 = require("./after-sales-message.entity");
const after_sales_state_history_entity_1 = require("./after-sales-state-history.entity");
const after_sales_events_1 = require("./after-sales.events");
const types_1 = require("./types");
const inventory_plugin_1 = require("@vendure/inventory-plugin");
/** 可退款支付状态：只认已成功支付（Declined/Error/Cancelled 的重试单不可退） */
const REFUNDABLE_PAYMENT_STATES = ['Settled', 'Authorized'];
let AfterSalesService = AfterSalesService_1 = class AfterSalesService {
    constructor(connection, listQueryBuilder) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.orderService = null;
        this.customerService = null;
        this.inventoryService = null;
        this.options = {};
        this.assetService = null;
        this.configService = null;
        this.channelService = null;
        this.eventBus = null;
    }
    init(injector) {
        var _a, _b;
        this.orderService = injector.get(core_1.OrderService);
        this.customerService = injector.get(core_1.CustomerService);
        try {
            this.inventoryService = injector.get(inventory_plugin_1.InventoryService);
        }
        catch (e) {
            this.inventoryService = null;
            core_1.Logger.warn(`InventoryService 不可用，售后回补库存被禁用: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
        }
        try {
            this.options = (_b = injector.get(constants_1.AFTER_SALES_PLUGIN_OPTIONS)) !== null && _b !== void 0 ? _b : {};
        }
        catch (_c) {
            this.options = {};
        }
        this.assetService = injector.get(core_1.AssetService);
        this.configService = injector.get(core_1.ConfigService);
        try {
            this.channelService = injector.get(core_1.ChannelService);
        }
        catch (_d) {
            this.channelService = null;
        }
        try {
            this.eventBus = injector.get(core_1.EventBus);
        }
        catch (_e) {
            this.eventBus = null;
        }
    }
    /**
     * 当前登录用户对应的 Customer 主键。
     * 说明：ctx.activeUserId 是 User 表主键，而售后单 customerId 存的是 Customer 表主键，
     * 两者是不同实体，必须经 CustomerService.findOneByUserId 桥接，否则过滤永远匹配不到。
     */
    async resolveCustomerId(ctx) {
        if (!ctx.activeUserId || !this.customerService)
            return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer ? Number(customer.id) : null;
    }
    async findOne(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id },
            relations: { order: true, orderLine: true, customer: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } },
        });
        return result !== null && result !== void 0 ? result : undefined;
    }
    /**
     * Shop API 专用：按 customer 过滤，防止越权枚举他人售后单。
     */
    async findOneForCustomer(ctx, id) {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId) {
            throw new core_1.UnauthorizedError();
        }
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id, customerId },
            relations: { order: true, orderLine: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } },
        });
        if (result) {
            await this.attachMessageCounts(ctx, [result]);
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    async findMyRequests(ctx, options) {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId) {
            return { items: [], totalItems: 0 };
        }
        return this.listQueryBuilder
            .build(after_sales_request_entity_1.AfterSalesRequest, options, {
            ctx,
            relations: ['order', 'orderLine', 'channels'],
            channelId: ctx.channelId,
        })
            .andWhere('aftersalesrequest."customerId" = :customerId', { customerId })
            .getManyAndCount()
            .then(async ([items, totalItems]) => {
            await this.attachMessageCounts(ctx, items);
            return { items, totalItems };
        });
    }
    async findAll(ctx, options) {
        return this.listQueryBuilder
            .build(after_sales_request_entity_1.AfterSalesRequest, options, {
            ctx,
            relations: ['order', 'orderLine', 'customer', 'channels'],
            channelId: ctx.channelId,
        })
            .getManyAndCount()
            .then(async ([items, totalItems]) => {
            await this.attachMessageCounts(ctx, items);
            return { items, totalItems };
        });
    }
    async createRequest(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        if (!ctx.activeUserId) {
            throw new core_1.UnauthorizedError();
        }
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        // 1. 校验订单存在且归属当前用户。
        // 注意：order.customer.id 是 Customer 主键，而 ctx.activeUserId 是关联 User 主键，两者不同。
        // 归属校验必须基于 customer.user.id 与 activeUserId 比较。
        let order;
        try {
            order = await this.orderService.findOne(ctx, input.orderId, ['customer', 'customer.user', 'lines']);
        }
        catch (e) {
            throw e;
        }
        if (!order) {
            throw new core_1.UserInputError(`Order ${input.orderId} not found`);
        }
        const customerUserId = (_b = (_a = order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (!order.customer || customerUserId == null || String(customerUserId) !== String(ctx.activeUserId)) {
            throw new core_1.ForbiddenError();
        }
        // 2. 校验订单状态（白名单可配置；外卖单全程 PaymentSettled，由 dev-config 显式放行）
        const allowedStates = ((_d = (_c = this.options) === null || _c === void 0 ? void 0 : _c.allowedOrderStates) === null || _d === void 0 ? void 0 : _d.length)
            ? this.options.allowedOrderStates
            : ['Shipped', 'Delivered', 'PartiallyDelivered', 'Completed', 'Cancelled'];
        if (!allowedStates.includes(order.state)) {
            throw new core_1.UserInputError(`Cannot create after-sales: order state must be one of ${allowedStates.join('/')}, got ${order.state}`);
        }
        // 3. 售后窗口校验：
        //    afterSalesWindowHours > 0 时按小时窗口（送达时间起算，外卖 24h 场景）；
        //    否则按 maxDays + 15 天质量问题延长逻辑。
        //    计时起点 fulfillmentCompletedAt → fulfillmentDeliveredAt → deliveredAt（外卖骑手送达落库）→ createdAt。
        //    不能用 order.updatedAt：任何订单写回（备注、标签、状态回写等）都会重置时间，使售后窗口被无限延长。
        //    窗口仅对有配送档案的订单生效（外卖/骑手场景专属）；普通快递/自提单（档案字段为空）走 maxDays 分支，
        //    避免 24h 窗口误伤普通单（发货完成 24h 后即不可售后不合理）。
        const cf = ((_e = order.customFields) !== null && _e !== void 0 ? _e : {});
        const gate = (_f = this.options) === null || _f === void 0 ? void 0 : _f.requireOrderCustomField;
        const hasDeliveryArchive = !!(gate === null || gate === void 0 ? void 0 : gate.field) && cf[gate.field] != null;
        // 口径：前三个 customFields 是 timestamptz（绝对时刻，直接可用）；
        // order.createdAt 是 timestamp + DB DEFAULT now()，库里存 UTC 墙钟，
        // 必须先按 UTC 墙钟还原，否则会被当成 8 小时前，导致售后窗口提前关闭。
        const orderDate = cf.fulfillmentCompletedAt || cf.fulfillmentDeliveredAt || cf.deliveredAt
            || (order.createdAt);
        const windowHours = (_h = (_g = this.options) === null || _g === void 0 ? void 0 : _g.afterSalesWindowHours) !== null && _h !== void 0 ? _h : 0;
        if (windowHours > 0 && hasDeliveryArchive) {
            const hoursSince = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60);
            if (hoursSince > windowHours) {
                throw new core_1.UserInputError(`Cannot create after-sales: exceeded ${windowHours}h window`);
            }
        }
        else {
            const maxDays = (_k = (_j = this.options) === null || _j === void 0 ? void 0 : _j.maxDaysAfterDelivery) !== null && _k !== void 0 ? _k : 7;
            const daysSince = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince > maxDays + 15) {
                throw new core_1.UserInputError(`Cannot create after-sales: exceeded ${maxDays + 15} days limit`);
            }
        }
        // 3.1 送达门槛（外卖/骑手场景）：外卖订单（R1/R2/R3/R5 骑手单、跑腿单）必须已送达才可售后，
        //     防止未送达的骑手单走售后与取消链路双退款；普通快递/自提单/R4 到店自取无骑手配送档案，跳过校验。
        //     不能只在字段有值时校验：未开始配送时 deliveryStatus 为 null，正是最需要拦截的时刻
        //     （旧逻辑下未接单的已支付外卖单可全额退款却不脱厅、不取消订单 → 商家照做、骑手照送，货钱双失）。
        const route = String((_l = cf.fulfillmentRoute) !== null && _l !== void 0 ? _l : '');
        const isCampusDeliveryOrder = cf.orderKind === 'errand' || ['R1', 'R2', 'R3', 'R5'].includes(route) || cf.deliveryPlan != null;
        if ((gate === null || gate === void 0 ? void 0 : gate.field) && (cf[gate.field] != null || isCampusDeliveryOrder)) {
            const actual = cf[gate.field];
            if (String(actual !== null && actual !== void 0 ? actual : '') !== String(gate.value)) {
                throw new core_1.UserInputError(`Cannot create after-sales: order not eligible (${gate.field}=${actual !== null && actual !== void 0 ? actual : 'null'})`);
            }
        }
        // 4. 退款金额上限校验
        const orderLine = input.orderLineId
            ? order.lines.find(l => String(l.id) === String(input.orderLineId))
            : null;
        if (input.orderLineId && !orderLine) {
            throw new core_1.UserInputError(`Order line ${input.orderLineId} not found in order ${input.orderId}`);
        }
        // 下限校验：0/负数金额建单会在执行阶段因 planRefunds 返回空计划而直接置 Refunded，
        // 产生「已退款但实退 0 元」的假结案，必须在建单入口挡住。
        if (!Number.isFinite(input.refundAmount) || input.refundAmount <= 0) {
            throw new core_1.UserInputError(`Refund amount must be a positive number, got ${input.refundAmount}`);
        }
        // 含税口径（P1）：proratedLinePrice / order.total 均为不含税额，按此上限会少退税额，
        // 与 createSystemRequest 及实际退款额（支付单实收含税）不一致。优先取含税字段。
        const maxRefund = orderLine
            ? ((_m = orderLine.proratedLinePriceWithTax) !== null && _m !== void 0 ? _m : orderLine.proratedLinePrice)
            : ((_o = order.totalWithTax) !== null && _o !== void 0 ? _o : ((_p = order.lines) !== null && _p !== void 0 ? _p : []).reduce((s, l) => { var _a, _b; return s + ((_b = (_a = l.proratedLinePriceWithTax) !== null && _a !== void 0 ? _a : l.proratedLinePrice) !== null && _b !== void 0 ? _b : 0); }, 0));
        // 建单上限还要扣掉历史已退款：否则多笔售后叠加申请、审核通过后执行阶段才因支付单余额不足失败。
        // 无支付单信息（balance < 0）时保持旧行为，仅按订单行/订单金额上限校验。
        const balance = await this.refundableBalance(ctx, order.id);
        const effectiveMax = balance >= 0 ? Math.min(maxRefund, balance) : maxRefund;
        if (input.refundAmount > effectiveMax) {
            throw new core_1.UserInputError(`Refund amount ${input.refundAmount} exceeds max ${effectiveMax}`);
        }
        // 4.1 用解码后的实体 ID 存储外键：order.id / line.id 已是数据库内部数字 ID，
        // 不能直接用 GraphQL 编码 ID（T_1）写入 number 外键列，否则触发 FOREIGN KEY 约束失败。
        const entityOrderId = order.id;
        const entityOrderLineId = orderLine ? orderLine.id : null;
        // 5. 重复售后校验：整单售后（无 orderLineId）按订单查重；指定行按行查重（均排除 Closed / Refunded
        //    两个终局态，Rejected 也算占用——被拒单必须走申诉，不允许绕开仲裁重新提单）。
        //    排除 Refunded：退款已完成即可视为本条售后了结，否则同一订单/行永久不能再发起售后。
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        if (entityOrderLineId != null) {
            const existing = await repo.findOne({
                where: { orderLineId: entityOrderLineId, state: (0, typeorm_1.Not)((0, typeorm_1.In)(['Closed', 'Refunded'])) },
            });
            if (existing) {
                throw new core_1.UserInputError(`After-sales already exists for order line ${input.orderLineId}`);
            }
        }
        else {
            const existing = await repo.findOne({
                where: { orderId: entityOrderId, state: (0, typeorm_1.Not)((0, typeorm_1.In)(['Closed', 'Refunded'])) },
            });
            if (existing) {
                throw new core_1.UserInputError(`After-sales already exists for order ${input.orderId}`);
            }
        }
        const request = new after_sales_request_entity_1.AfterSalesRequest({
            orderId: entityOrderId,
            orderLineId: entityOrderLineId,
            type: input.type || 'return_refund',
            reason: input.reason,
            description: input.description || null,
            evidenceImages: input.evidenceImages || null,
            refundAmount: input.refundAmount,
            customerId: order.customer.id,
        });
        request.channels = [ctx.channel];
        const saved = await this.commitState(ctx, request, null, 'Pending');
        core_1.Logger.info(`After-sales request ${saved.id} created by customer ${ctx.activeUserId}`, constants_1.loggerCtx);
        return this.hydrate(ctx, saved.id);
    }
    /**
     * 系统内部建单（P4 酒店预订取消链路）：绕过顾客门禁（订单状态/送达/窗口白名单），
     * 由后端策略计算退款额后代顾客发起；归属仍落订单顾客，状态历史/事件经统一 commitState 出口。
     * 调用方负责后续审批（refund_only 可直接 approveRequest 走自动退款链）。
     */
    async createSystemRequest(ctx, input) {
        var _a, _b, _c;
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const order = await this.orderService.findOne(ctx, input.orderId, ['customer', 'lines']);
        if (!order) {
            throw new core_1.UserInputError(`Order ${input.orderId} not found`);
        }
        const orderLine = input.orderLineId
            ? order.lines.find(l => String(l.id) === String(input.orderLineId))
            : undefined;
        if (input.orderLineId && !orderLine) {
            throw new core_1.UserInputError(`Order line ${input.orderLineId} not found in order ${input.orderId}`);
        }
        // 下限校验：0/负数金额建单会在执行阶段因 planRefunds 返回空计划而直接置 Refunded，
        // 产生「已退款但实退 0 元」的假结案；系统建单的调用方（酒店取消/改期退差）均为正数。
        if (!Number.isFinite(input.refundAmount) || input.refundAmount <= 0) {
            throw new core_1.UserInputError(`Refund amount must be a positive number, got ${input.refundAmount}`);
        }
        const refundAmount = Math.round(input.refundAmount);
        // 含税口径优先（酒店预订等含税价租户：proratedLinePrice 为不含税额，会误拦真实可退额）
        const maxRefund = orderLine
            ? ((_a = orderLine.proratedLinePriceWithTax) !== null && _a !== void 0 ? _a : orderLine.proratedLinePrice)
            : ((_b = order.totalWithTax) !== null && _b !== void 0 ? _b : order.lines.reduce((s, l) => { var _a, _b; return s + ((_b = (_a = l.proratedLinePriceWithTax) !== null && _a !== void 0 ? _a : l.proratedLinePrice) !== null && _b !== void 0 ? _b : 0); }, 0));
        // 与 createRequest 一致：上限还需扣掉历史已退款，避免系统建单超额后执行阶段才失败
        const balance = await this.refundableBalance(ctx, order.id);
        const effectiveMax = balance >= 0 ? Math.min(maxRefund, balance) : maxRefund;
        if (refundAmount > effectiveMax) {
            throw new core_1.UserInputError(`Refund amount ${refundAmount} exceeds max ${effectiveMax}`);
        }
        if (!((_c = order.customer) === null || _c === void 0 ? void 0 : _c.id)) {
            throw new core_1.UserInputError(`Order ${input.orderId} has no customer`);
        }
        const entityOrderId = order.id;
        const entityOrderLineId = orderLine ? orderLine.id : null;
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        // 行级幂等：同一订单行已有未了结（非 Closed/Refunded）售后单则拒绝（酒店 booking.afterSalesRequestId 亦做去重）
        if (entityOrderLineId != null) {
            const existing = await repo.findOne({
                where: { orderLineId: entityOrderLineId, state: (0, typeorm_1.Not)((0, typeorm_1.In)(['Closed', 'Refunded'])) },
            });
            if (existing) {
                throw new core_1.UserInputError(`After-sales already exists for order line ${input.orderLineId}`);
            }
        }
        const request = new after_sales_request_entity_1.AfterSalesRequest({
            orderId: entityOrderId,
            orderLineId: entityOrderLineId,
            type: input.type || 'refund_only',
            reason: input.reason,
            description: input.description || null,
            evidenceImages: null,
            refundAmount,
            customerId: order.customer.id,
        });
        request.channels = [ctx.channel];
        const saved = await this.commitState(ctx, request, null, 'Pending');
        core_1.Logger.info(`After-sales request ${saved.id} created by system (order ${entityOrderId}, line ${entityOrderLineId !== null && entityOrderLineId !== void 0 ? entityOrderLineId : '-'})`, constants_1.loggerCtx);
        return this.hydrate(ctx, saved.id);
    }
    /**
     * Shop 侧写操作归属校验：后台（admin）由 Permission.UpdateOrder 兜底，
     * shop 必须确认售后单属于当前登录顾客，否则为越权（IDOR）。
     */
    async assertCustomerOwnership(ctx, request) {
        if (ctx.apiType !== 'shop')
            return;
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId || Number(request.customerId) !== customerId) {
            throw new core_1.ForbiddenError();
        }
    }
    async cancelRequest(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        await this.assertCustomerOwnership(ctx, request);
        if (request.state !== 'Pending') {
            throw new Error(`Cannot cancel request in state: ${request.state}`);
        }
        const fromState = request.state;
        const saved = await this.commitState(ctx, request, fromState, 'Closed');
        return this.hydrate(ctx, saved.id);
    }
    /**
     * 商家/平台关闭待处理售后（Pending → Closed）：用于顾客重复提交/误申请。
     * 原因落 rejectReason 留痕（顾客 C 端可见），不触发退款与库存回补。
     */
    async adminCancelRequest(ctx, id, reason) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${id} not found`);
        if (request.state !== 'Pending') {
            throw new core_1.UserInputError(`Cannot close request in state: ${request.state}`);
        }
        const why = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (why)
            request.rejectReason = why.slice(0, 200);
        // commitState 统一出口：落历史 + 发布事件（顾客收「售后已关闭」站内信）
        return this.commitState(ctx, request, 'Pending', 'Closed');
    }
    /**
     * 商家催办顾客：仅进行中单可催（Pending/Approved/Returning/Appealed）。
     * 经事件交由 notification-plugin 落顾客站内信；未装时仅无提醒，不影响返回。
     */
    async remindCustomer(ctx, id, note) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${id} not found`);
        if (!['Pending', 'Approved', 'Returning', 'Appealed'].includes(request.state)) {
            throw new core_1.UserInputError(`Cannot remind in state: ${request.state}`);
        }
        const extra = String(note !== null && note !== void 0 ? note : '').trim();
        try {
            await ((_a = this.eventBus) === null || _a === void 0 ? void 0 : _a.publish(new after_sales_events_1.AfterSalesCustomerRemindEvent(ctx, Number(request.id), request.customerId == null ? null : Number(request.customerId), '售后处理提醒', extra
                ? extra.slice(0, 200)
                : '商家提醒您及时处理售后事项（如寄回商品、确认收货），可在售后详情查看最新进展。')));
        }
        catch (e) {
            core_1.Logger.warn(`publish AfterSalesCustomerRemindEvent failed for #${id}: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, constants_1.loggerCtx);
        }
        return request;
    }
    /**
     * 退款完成结案：Refunded → Closed。
     * 退款到账后售后单若一直停在 Refunded，该订单/行会被查重逻辑永久占用、后台列表持续堆积，
     * 因此提供显式结案出口（其余终局态如 ExchangeShipped 已有各自关闭路径）。
     */
    async closeRequest(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new core_1.EntityNotFoundError('AfterSalesRequest', id);
        if (request.state !== 'Refunded') {
            throw new core_1.UserInputError(`Cannot close request in state: ${request.state}`);
        }
        const fromState = request.state;
        const saved = await this.commitState(ctx, request, fromState, 'Closed');
        // 同步回写订单看板状态，避免订单长期挂「已退款」而与实际售后已结案不一致
        await this.updateOrderAfterSalesStatus(ctx, saved.orderId, 'Closed');
        core_1.Logger.info(`after-sales#${saved.id} 退款完成结案`, constants_1.loggerCtx);
        return this.hydrate(ctx, saved.id);
    }
    async updateReturnTracking(ctx, id, trackingNo, carrier) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        await this.assertCustomerOwnership(ctx, request);
        if (request.state !== 'Approved') {
            throw new Error(`Cannot update tracking in state: ${request.state}`);
        }
        const fromState = request.state;
        request.returnTrackingNo = trackingNo;
        request.returnCarrier = carrier;
        const saved = await this.commitState(ctx, request, fromState, 'Returning');
        return this.hydrate(ctx, saved.id);
    }
    /**
     * 顾客端上传售后凭证图。
     * 仅做「边界校验 + 落 Asset」，不创建售后单、不写售后业务数据。
     * 返回绝对值 URL：AssetInterceptorPlugin 只对 GraphQL 类型为 Asset 的字段补绝对前缀，
     * 这里是 [String!]!，必须自行调用 storageStrategy.toAbsoluteUrl（与 Vendure 自身行为一致）。
     */
    async uploadEvidence(ctx, images) {
        if (!ctx.activeUserId) {
            throw new core_1.UnauthorizedError();
        }
        if (!Array.isArray(images) || images.length === 0) {
            throw new core_1.UserInputError('No evidence image provided');
        }
        if (!this.assetService || !this.configService) {
            throw new Error('AssetService not initialized');
        }
        const urls = [];
        for (const dataUrl of images) {
            const parsed = AfterSalesService_1.parseImageDataUrl(dataUrl);
            if (!parsed) {
                throw new core_1.UserInputError('Invalid evidence image: only png/jpeg/webp data URL is allowed');
            }
            if (parsed.buffer.length > AfterSalesService_1.EVIDENCE_MAX_BYTES) {
                throw new core_1.UserInputError(`Evidence image too large: ${parsed.buffer.length} bytes exceeds ${AfterSalesService_1.EVIDENCE_MAX_BYTES} bytes`);
            }
            const filename = `after-sales-evidence-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${parsed.ext}`;
            const asset = await this.assetService.createFromFileStream(node_stream_1.Readable.from(parsed.buffer), filename, ctx);
            if ((0, core_1.isGraphQlErrorResult)(asset)) {
                throw new core_1.UserInputError(`Failed to create asset: ${asset.message}`);
            }
            urls.push(this.toAbsoluteAssetUrl(ctx, asset.preview));
        }
        core_1.Logger.info(`Uploaded ${urls.length} after-sales evidence image(s) by user ${ctx.activeUserId}`, constants_1.loggerCtx);
        return urls;
    }
    /** 解析 `data:image/(png|jpeg|webp);base64,xxx`，非法返回 null */
    static parseImageDataUrl(dataUrl) {
        if (typeof dataUrl !== 'string')
            return null;
        const match = /^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
        if (!match)
            return null;
        const mime = match[1].toLowerCase();
        const ext = AfterSalesService_1.EVIDENCE_MIME_EXT[mime];
        if (!ext)
            return null;
        try {
            const buffer = Buffer.from(match[2], 'base64');
            if (buffer.length === 0)
                return null;
            return { buffer, ext };
        }
        catch (_a) {
            return null;
        }
    }
    /** 与 AssetInterceptorPlugin 同源：用 assetStorageStrategy.toAbsoluteUrl 补绝对前缀 */
    toAbsoluteAssetUrl(ctx, preview) {
        var _a;
        if (!preview)
            return '';
        const strategy = (_a = this.configService) === null || _a === void 0 ? void 0 : _a.assetOptions.assetStorageStrategy;
        if ((strategy === null || strategy === void 0 ? void 0 : strategy.toAbsoluteUrl) && ctx.req) {
            return strategy.toAbsoluteUrl(ctx.req, preview);
        }
        return preview;
    }
    /**
     * Mutation 保存后重新加载并返回带关系（order/orderLine）的实体。
     * 直接 repo.save() 返回的实体关系未加载，Shop SDL 中 `order: Order!` 非空字段会被自动关系解析取到 null，
     * 触发 "Cannot return null for non-nullable field AfterSalesRequest.order"。
     */
    async hydrate(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const full = await repo.findOne({
            where: { id: id },
            relations: { order: true, orderLine: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } },
        });
        if (full) {
            await this.attachMessageCounts(ctx, [full]);
            return full;
        }
        throw new Error(`AfterSalesRequest #${id} not found after save`);
    }
    /**
     * 状态变更统一出口：写状态 + 落历史 + 发布 AfterSalesStateTransitionEvent。
     * 所有状态写入点必须经此方法保证通知全覆盖；事件发布失败仅告警不阻断。
     */
    async commitState(ctx, request, fromState, toState) {
        var _a, _b, _c, _d;
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        request.state = toState;
        const saved = await repo.save(request);
        await this.recordState(ctx, Number(saved.id), fromState, toState);
        try {
            const full = await repo.findOne({ where: { id: saved.id }, relations: { order: true } });
            await ((_a = this.eventBus) === null || _a === void 0 ? void 0 : _a.publish(new after_sales_events_1.AfterSalesStateTransitionEvent(ctx, Number(saved.id), Number(saved.orderId), saved.type, fromState, toState, saved.customerId != null ? Number(saved.customerId) : null, (_c = (_b = full === null || full === void 0 ? void 0 : full.order) === null || _b === void 0 ? void 0 : _b.code) !== null && _c !== void 0 ? _c : null, new Date())));
        }
        catch (e) {
            core_1.Logger.warn(`publish AfterSalesStateTransitionEvent failed for #${saved.id}: ${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`, constants_1.loggerCtx);
        }
        return saved;
    }
    /** 状态流转历史落库：失败仅告警，绝不阻断主流程 */
    async recordState(ctx, requestId, fromState, toState) {
        var _a;
        try {
            const repo = this.connection.getRepository(ctx, after_sales_state_history_entity_1.AfterSalesStateHistory);
            await repo.insert({
                requestId,
                fromState: fromState !== null && fromState !== void 0 ? fromState : null,
                toState,
                operatorUserId: ctx.activeUserId != null ? Number(ctx.activeUserId) : null,
            });
        }
        catch (e) {
            core_1.Logger.warn(`recordState failed for after-sales #${requestId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
        }
    }
    // ===== Admin Operations =====
    async approveRequest(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        const saved = await this.transitionState(ctx, id, 'Approved');
        // refund_only（外卖）无需退货：审批通过（含 48h 自动同意）即链式 Received → 退款
        if (request.type === 'refund_only') {
            return this.refundOnlyChain(ctx, id);
        }
        return saved;
    }
    /** refund_only 退款链：Approved → Received（免退货直达）→ executeRefund。
     *  退款失败由 executeRefund 内部落 RefundFailed 可重试，不回滚已到达的 Received。 */
    async refundOnlyChain(ctx, id) {
        await this.transitionState(ctx, id, 'Received');
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id },
            relations: ['order', 'order.payments'],
        });
        if (!request)
            throw new core_1.EntityNotFoundError('AfterSalesRequest', id);
        // 余额不足属于事务外前置拒绝，executeRefund 此时不会落 RefundFailed；
        // 若不兜底，售后单会卡在 Received，而后台重试入口只认 RefundFailed，只能人工走 processAfterSalesRefund。
        const plan = await this.planRefunds(ctx, request.orderId, request.refundAmount);
        if (plan == null) {
            const reason = `Cannot refund: insufficient refundable balance for order ${request.orderId}`;
            await this.applyRefundFailed(ctx, request.id, reason, false);
            core_1.Logger.warn(`refund_only 链式退款前置拒绝，已置 RefundFailed: ${reason}`, constants_1.loggerCtx);
            return this.hydrate(ctx, request.id);
        }
        return this.executeRefund(ctx, request);
    }
    async rejectRequest(ctx, id, reason) {
        var _a;
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        if (!((_a = types_1.STATE_TRANSITIONS[request.state]) === null || _a === void 0 ? void 0 : _a.includes('Rejected'))) {
            throw new Error(`Cannot reject from state: ${request.state}`);
        }
        const fromState = request.state;
        request.rejectReason = reason;
        const saved = await this.commitState(ctx, request, fromState, 'Rejected');
        return this.hydrate(ctx, saved.id);
    }
    /** C 端申诉：Rejected → Appealed（仅本人售后单）；申诉说明落入协商留言流（customer），商家/平台可见 */
    async appealRequest(ctx, id, note) {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId)
            throw new core_1.UnauthorizedError();
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id, customerId } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${id} not found`);
        if (request.state !== 'Rejected') {
            throw new core_1.UserInputError(`Cannot appeal request in state: ${request.state}`);
        }
        if (note === null || note === void 0 ? void 0 : note.trim()) {
            await this.addMessage(ctx, id, 'customer', note.trim().slice(0, 1000));
        }
        return this.transitionState(ctx, id, 'Appealed');
    }
    /** 平台仲裁：Appealed → Approved（同意；refund_only 链式退款）| Closed（维持拒绝，note 必填写入 rejectReason） */
    async arbitrateRequest(ctx, id, approve, note) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        if (request.state !== 'Appealed') {
            throw new Error(`Cannot arbitrate request in state: ${request.state}`);
        }
        if (!approve) {
            const text = (note !== null && note !== void 0 ? note : '').trim();
            if (!text)
                throw new core_1.UserInputError('维持拒绝必须填写仲裁说明');
            request.rejectReason = text;
            await repo.save(request);
            return this.transitionState(ctx, id, 'Closed');
        }
        if (note === null || note === void 0 ? void 0 : note.trim()) {
            // 仲裁说明落入协商留言流（admin 侧），C 端留言卡可见
            await this.addMessage(ctx, id, 'admin', note.trim().slice(0, 1000));
        }
        const saved = await this.transitionState(ctx, id, 'Approved');
        if (request.type === 'refund_only') {
            return this.refundOnlyChain(ctx, id);
        }
        return saved;
    }
    /**
     * Returning → Received（收到退货）：
     * 在状态流转前先做库存回补——把收到的退货回补到原发货仓（orderLine.stockLocationId），
     * 同一事务内写 afterSales 账本，避免“退款了但库存不回来”。回补失败不影响收退货流程（告警）。
     * @param receivedQuantity 实收数量（部分退货按实收回补；缺省按订单行数量全额回补）
     */
    async confirmReceive(ctx, id, receivedQuantity) {
        return this.connection.withTransaction(ctx, async (txCtx) => {
            var _a, _b, _c;
            const repo = this.connection.getRepository(txCtx, after_sales_request_entity_1.AfterSalesRequest);
            const request = await repo.findOne({
                where: { id: id },
                relations: ['orderLine'],
            });
            if (!request)
                throw new Error('Request not found');
            const allowed = types_1.STATE_TRANSITIONS[request.state];
            if (!(allowed === null || allowed === void 0 ? void 0 : allowed.includes('Received'))) {
                throw new Error(`Invalid transition: ${request.state} -> Received`);
            }
            // 实收数量：显式传入则记录；否则缺省为订单行数量（全额回补）
            const orderLine = request.orderLine;
            const orderedQty = orderLine ? Number(orderLine.quantity) || 0 : 0;
            if (receivedQuantity != null) {
                request.receivedQuantity = Math.max(0, Math.floor(receivedQuantity));
            }
            const recoverQty = Math.max(0, Math.min(orderedQty, request.receivedQuantity != null ? request.receivedQuantity : orderedQty));
            // 部分退货：退款额必须按实收数量收紧，否则「只收回 1 件仍退全额」造成资损。
            // 仅在有订单行、显式传了实收数量且少于订购数量时生效；缺省全收不调整（兼容原全额退款）。
            if (orderLine && orderedQty > 0 && receivedQuantity != null && recoverQty < orderedQty) {
                const lineTax = Number((_b = (_a = orderLine.proratedLinePriceWithTax) !== null && _a !== void 0 ? _a : orderLine.proratedLinePrice) !== null && _b !== void 0 ? _b : 0);
                if (lineTax > 0) {
                    const capped = Math.floor((lineTax * recoverQty) / orderedQty);
                    if (capped < Number(request.refundAmount)) {
                        core_1.Logger.warn(`after-sales#${request.id} 实收 ${recoverQty}/${orderedQty}，退款额 ${request.refundAmount} → ${capped}`, constants_1.loggerCtx);
                        request.refundAmount = capped;
                    }
                }
            }
            // 库存回补：按各仓实际发货比例多仓按包回补（单仓退化原逻辑），落 restockJson 留痕
            if (orderLine && this.inventoryService && recoverQty > 0) {
                try {
                    const restockDetail = await this.inventoryService.applyAfterSalesRestockMulti(txCtx, orderLine.id, recoverQty, `AS${request.id}`);
                    request.restockJson = restockDetail.length ? JSON.stringify(restockDetail) : null;
                    core_1.Logger.info(`库存回补 after-sales#${request.id}: ${JSON.stringify(restockDetail)}`, constants_1.loggerCtx);
                }
                catch (e) {
                    // 回补失败不阻断收退货流程（仍可退款），仅告警便于运维追查
                    core_1.Logger.error(`库存回补失败 after-sales#${request.id}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, constants_1.loggerCtx);
                }
            }
            else if (recoverQty === 0) {
                core_1.Logger.warn(`after-sales#${request.id} recoverQty=0，跳过库存回补`, constants_1.loggerCtx);
            }
            else {
                core_1.Logger.warn(`after-sales#${request.id} 无订单行或 InventoryService 不可用，跳过库存回补`, constants_1.loggerCtx);
            }
            const fromState = request.state;
            const saved = await this.commitState(txCtx, request, fromState, 'Received');
            return this.hydrate(txCtx, saved.id);
        });
    }
    async processRefund(ctx, id) {
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id },
            relations: ['order', 'order.payments'],
        });
        if (!request) {
            throw new core_1.EntityNotFoundError('AfterSalesRequest', id);
        }
        if (request.state !== 'Received') {
            throw new core_1.UserInputError('Cannot refund: request must be in Received state');
        }
        if (request.type === 'exchange') {
            throw new core_1.UserInputError('Cannot refund: exchange requests are not refundable');
        }
        return this.executeRefund(ctx, request);
    }
    /**
     * 退款失败后重试：仅 RefundFailed 允许；复用 executeRefund 退款核心。
     */
    async retryRefund(ctx, id) {
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id },
            relations: ['order', 'order.payments'],
        });
        if (!request) {
            throw new core_1.EntityNotFoundError('AfterSalesRequest', id);
        }
        if (request.state !== 'RefundFailed') {
            throw new core_1.UserInputError('Cannot retry refund: request must be in RefundFailed state');
        }
        return this.executeRefund(ctx, request);
    }
    /**
     * 退款核心：按「新→旧」把退款额拆分到多张可退支付单（组合支付：余额+微信/多笔），
     * 逐笔 refundOrder；停在 Pending 时 settleRefund 推进，只有全部达 Settled 才置 Refunded。
     * 某笔失败时：已成功打款的笔次保留（钱已真实退回，不可回滚），售后单置 RefundFailed，
     * 下次重试会自动按更新后的剩余额度继续退，避免重复退款。
     */
    async executeRefund(ctx, request) {
        var _a, _b, _c, _d, _e;
        const plan = await this.planRefunds(ctx, request.orderId, request.refundAmount);
        if (plan == null) {
            throw new core_1.UserInputError(`Cannot refund: insufficient refundable balance for order ${request.orderId}`);
        }
        const fromState = request.state;
        // 事务包裹：退款成功后统一提交（改状态 + 落账 + 回写 order.afterSalesStatus），失败回滚整笔。
        await this.connection.startTransaction(ctx);
        try {
            let settledAmount = 0;
            const transactionIds = [];
            // 该笔退款未达 Settled：把 Refund 置 Failed，使下次 planRefunds 不计入已退额度（可重试），
            // 与 campus settleRefundOrMarkFailed 同口径。
            const markRefundFailed = async (refund) => {
                var _a;
                if (!(refund === null || refund === void 0 ? void 0 : refund.id))
                    return;
                try {
                    refund.state = 'Failed';
                    await this.connection.getRepository(ctx, core_1.Refund).save(refund);
                }
                catch (e) {
                    core_1.Logger.warn(`mark refund ${refund.id} failed error: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
                }
            };
            const failPartial = async (error, reasonMsg) => {
                var _a;
                request.refundError = error;
                request.refundedAt = undefined;
                request.actualRefundAmount = ((_a = request.actualRefundAmount) !== null && _a !== void 0 ? _a : 0) + settledAmount;
                await this.commitState(ctx, request, fromState, 'RefundFailed');
                await this.updateOrderAfterSalesStatus(ctx, request.orderId, 'RefundFailed');
                await this.connection.commitOpenTransaction(ctx);
                core_1.Logger.warn(reasonMsg, constants_1.loggerCtx);
                return this.hydrate(ctx, request.id);
            };
            for (const leg of plan) {
                let refund;
                try {
                    const refundResult = await this.orderService.refundOrder(ctx, {
                        paymentId: leg.paymentId,
                        amount: leg.amount,
                        reason: `After-sales refund #${request.id}`,
                        shipping: 0, // Refund.shipping 为 NOT NULL 列，必须显式置 0
                        adjustment: 0,
                    });
                    if ((0, core_1.isGraphQlErrorResult)(refundResult)) {
                        return failPartial(`refundOrder 拒绝: ${JSON.stringify(refundResult)}`, `after-sales #${request.id} refundOrder 拒绝 (partial ${settledAmount})`);
                    }
                    refund = refundResult;
                    if (refund.state === 'Pending') {
                        const settled = await this.orderService.settleRefund(ctx, {
                            id: refund.id,
                            transactionId: (_a = refund.transactionId) !== null && _a !== void 0 ? _a : '',
                        });
                        refund.state = settled.state;
                        refund.transactionId = (_b = settled.transactionId) !== null && _b !== void 0 ? _b : refund.transactionId;
                    }
                }
                catch (e) {
                    // 该笔未成功（或结算异常）：已成功的笔次保留并提交，剩余额度留给重试
                    await markRefundFailed(refund);
                    return failPartial(`退款异常: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, `after-sales #${request.id} refund leg 异常 (partial ${settledAmount}): ${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`);
                }
                if (refund.state !== 'Settled') {
                    await markRefundFailed(refund);
                    return failPartial(`退款未达 Settled，当前 ${refund.state}`, `after-sales #${request.id} 退款终态 ${refund.state}，已置 RefundFailed`);
                }
                settledAmount += refund.total != null ? Number(refund.total) : leg.amount;
                if (refund.transactionId)
                    transactionIds.push(String(refund.transactionId));
            }
            request.refundTransactionId = transactionIds.length ? transactionIds.join(',') : null;
            request.actualRefundAmount = ((_e = request.actualRefundAmount) !== null && _e !== void 0 ? _e : 0) + settledAmount;
            request.refundError = null;
            request.refundedAt = new Date();
            await this.commitState(ctx, request, fromState, 'Refunded');
            await this.updateOrderAfterSalesStatus(ctx, request.orderId, 'Refunded');
            core_1.Logger.info(`Refund settled for after-sales request #${request.id}, tx=${request.refundTransactionId}`, constants_1.loggerCtx);
            await this.connection.commitOpenTransaction(ctx);
        }
        catch (e) {
            await this.connection.rollBackTransaction(ctx);
            core_1.Logger.error(`Refund failed for after-sales #${request.id}: ${e.message}`, constants_1.loggerCtx);
            // 未知异常：置 RefundFailed 以便重试，而非让事务留下半成品
            await this.applyRefundFailed(ctx, request.id, e.message, false);
            throw e;
        }
        return this.hydrate(ctx, request.id);
    }
    /**
     * 订单可退余额（与 planRefunds 同口径）：可退支付单实收合计 − 已退合计（排除 Failed，未真实打款）。
     * 无任何可退支付单时返回 -1，表示「无法计算」，调用方据此跳过收紧、维持原上限校验。
     */
    async refundableBalance(ctx, orderId) {
        var _a;
        const payments = await this.connection.getRepository(ctx, core_1.Payment).find({
            where: { order: { id: orderId } },
            order: { id: 'DESC' },
        });
        const refundable = payments.filter(p => REFUNDABLE_PAYMENT_STATES.includes(String(p.state)));
        if (refundable.length === 0)
            return -1;
        let balance = 0;
        for (const payment of refundable) {
            const refunded = await this.connection
                .getRepository(ctx, core_1.Refund)
                .createQueryBuilder('r')
                .select('COALESCE(SUM(r.total), 0)', 'sum')
                .where('r.paymentId = :pid', { pid: payment.id })
                .andWhere('r.state <> :failed', { failed: 'Failed' })
                .getRawOne();
            balance += Math.max(0, Number(payment.amount) - Number((_a = refunded === null || refunded === void 0 ? void 0 : refunded.sum) !== null && _a !== void 0 ? _a : 0));
        }
        return balance;
    }
    /**
     * 生成退款计划（新→旧）：每张支付单退「自身剩余额度」，累计到 request.refundAmount 为止。
     * 组合支付（余额+微信/多笔）跨单拆分；总额不足返回 null（调用方拒绝，绝不部分退）。
     * 只认 Settled/Authorized，已退总额排除 Failed（结算失败未真实打款，允许重试）。
     */
    async planRefunds(ctx, orderId, needAmount) {
        var _a;
        if (needAmount <= 0)
            return [];
        const payments = await this.connection.getRepository(ctx, core_1.Payment).find({
            where: { order: { id: orderId } },
            order: { id: 'DESC' },
        });
        const plan = [];
        let left = needAmount;
        for (const payment of payments) {
            if (!REFUNDABLE_PAYMENT_STATES.includes(String(payment.state)))
                continue;
            const refunded = await this.connection
                .getRepository(ctx, core_1.Refund)
                .createQueryBuilder('r')
                .select('COALESCE(SUM(r.total), 0)', 'sum')
                .where('r.paymentId = :pid', { pid: payment.id })
                .andWhere('r.state <> :failed', { failed: 'Failed' })
                .getRawOne();
            const remaining = Number(payment.amount) - Number((_a = refunded === null || refunded === void 0 ? void 0 : refunded.sum) !== null && _a !== void 0 ? _a : 0);
            if (remaining <= 0)
                continue;
            const take = Math.min(remaining, left);
            plan.push({ paymentId: payment.id, amount: take });
            left -= take;
            if (left <= 0)
                break;
        }
        return left > 0 ? null : plan;
    }
    /** 幂等地把售后单置为 RefundFailed（不入事务，供 catch 兜底），避免异常路径留下半成品脏数据 */
    async applyRefundFailed(ctx, idOrRequest, error, inTx) {
        var _a;
        try {
            const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
            const request = typeof idOrRequest === 'object' ? idOrRequest : await repo.findOne({ where: { id: idOrRequest } });
            if (!request || request.state === 'Refunded')
                return;
            const fromState = request.state;
            request.refundError = error;
            request.refundedAt = undefined;
            if (fromState !== 'RefundFailed') {
                await this.commitState(ctx, request, fromState, 'RefundFailed');
            }
            else {
                // 已是 RefundFailed 的重复兜底：只更新错误信息，不再发布事件（防重试风暴）
                await repo.save(request);
            }
            await this.updateOrderAfterSalesStatus(ctx, request.orderId, 'RefundFailed');
        }
        catch (inner) {
            core_1.Logger.error(`applyRefundFailed 兜底写入失败: ${(_a = inner === null || inner === void 0 ? void 0 : inner.message) !== null && _a !== void 0 ? _a : inner}`, constants_1.loggerCtx);
        }
    }
    /**
     * 回写 Order customFields.afterSalesStatus。失败仅告警，不影响主流程。
     */
    async updateOrderAfterSalesStatus(ctx, orderId, status) {
        if (!this.orderService)
            return;
        try {
            await this.orderService.updateCustomFields(ctx, orderId, { afterSalesStatus: status });
        }
        catch (e) {
            core_1.Logger.warn(`Failed to update order afterSalesStatus: ${e.message}`, constants_1.loggerCtx);
        }
    }
    /** Admin 单查：加载 order/orderLine/customer/history（web-admin 详情页专用，替代列表过滤 hack） */
    async findOneForAdmin(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id },
            relations: { order: true, orderLine: true, customer: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } },
        });
        if (result) {
            await this.attachMessageCounts(ctx, [result]);
        }
        return result !== null && result !== void 0 ? result : undefined;
    }
    /** 批量同意：复用单条方法逐条执行，单条失败不中断整批。上限 50。 */
    async batchApprove(ctx, ids) {
        var _a;
        if (!Array.isArray(ids) || ids.length === 0)
            throw new core_1.UserInputError('ids is required');
        if (ids.length > 50)
            throw new core_1.UserInputError(`Batch limit is 50, got ${ids.length}`);
        const results = [];
        for (const id of ids) {
            try {
                const r = await this.approveRequest(ctx, id);
                results.push({ id: String(id), success: true, state: r.state, message: '' });
            }
            catch (e) {
                results.push({ id: String(id), success: false, state: '', message: (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e) });
            }
        }
        return results;
    }
    /** 批量拒绝：同 batchApprove，整批共用一个 reason。 */
    async batchReject(ctx, ids, reason) {
        var _a;
        if (!Array.isArray(ids) || ids.length === 0)
            throw new core_1.UserInputError('ids is required');
        if (ids.length > 50)
            throw new core_1.UserInputError(`Batch limit is 50, got ${ids.length}`);
        const results = [];
        for (const id of ids) {
            try {
                const r = await this.rejectRequest(ctx, id, reason);
                results.push({ id: String(id), success: true, state: r.state, message: '' });
            }
            catch (e) {
                results.push({ id: String(id), success: false, state: '', message: (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e) });
            }
        }
        return results;
    }
    /** 读当前渠道售后寄回地址（Admin/Shop 共用；未配置返回空串） */
    async getReturnAddress(ctx) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, core_1.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        return (_b = (_a = channel === null || channel === void 0 ? void 0 : channel.customFields) === null || _a === void 0 ? void 0 : _a.afterSalesReturnAddress) !== null && _b !== void 0 ? _b : '';
    }
    /** 写当前渠道售后寄回地址（走 ChannelService.update，免开 ChannelService 权限） */
    async updateReturnAddress(ctx, address) {
        if (!this.channelService)
            throw new Error('ChannelService not initialized');
        await this.channelService.update(ctx, {
            id: ctx.channelId,
            customFields: { afterSalesReturnAddress: address },
        });
        return true;
    }
    /**
     * 售后数据看板聚合（三期设计 §四）：窗口申请总数 / 仍 Pending / 实退总额 / 平均处理时长 / 按日 / 按状态 / 按类型。
     * from/to 接受 'YYYY-MM-DD' 或完整 ISO 串（纯日期的 to 按当日 23:59:59.999 收口）。
     * 分日聚合用 SUBSTR(createdAt,1,10)（sqlite/mysql 均支持）；平均处理时长用 JS 计算避免跨库 AVG 精度差异。
     */
    async stats(ctx, from, to) {
        var _a, _b, _c;
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            throw new core_1.UserInputError('Invalid from/to date');
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) {
            toDate.setHours(23, 59, 59, 999);
        }
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        // 一次取窗口内 createdAt：总数与按日聚合共用，避免依赖 SUBSTR(timestamp)
        //（PostgreSQL 没有该函数重载，sqlite 才有；生产 PG 环境下会直接报错）。
        const createdRows = await repo
            .createQueryBuilder('r')
            .select('r.createdAt', 'createdAt')
            .where('r.createdAt >= :from', { from: fromDate })
            .andWhere('r.createdAt <= :to', { to: toDate })
            .getRawMany();
        const totalRequests = createdRows.length;
        const pendingCount = await repo
            .createQueryBuilder('r')
            .where('r.state = :state', { state: 'Pending' })
            .andWhere('r.createdAt <= :to', { to: toDate })
            .getCount();
        // 退款口径按 refundedAt 判定而非 state：Refunded 结案后会流转到 Closed，
        // 若仍按 state='Refunded' 统计，已真实打款的金额会从看板里消失。
        const refundRow = await repo
            .createQueryBuilder('r')
            .select('COALESCE(SUM(r.actualRefundAmount), 0)', 'total')
            .where('r.refundedAt IS NOT NULL')
            .andWhere('r.refundedAt >= :from', { from: fromDate })
            .andWhere('r.refundedAt <= :to', { to: toDate })
            .getRawOne();
        const totalRefundAmount = Number((_a = refundRow === null || refundRow === void 0 ? void 0 : refundRow.total) !== null && _a !== void 0 ? _a : 0);
        // 按日聚合在 JS 完成（DB 无关）：直接截取 createdAt 原始串的日期前缀，避免时区换算漂移。
        const dailyMap = new Map();
        for (const row of createdRows) {
            const date = String((_b = row.createdAt) !== null && _b !== void 0 ? _b : '').slice(0, 10);
            if (!date)
                continue;
            dailyMap.set(date, ((_c = dailyMap.get(date)) !== null && _c !== void 0 ? _c : 0) + 1);
        }
        const daily = [...dailyMap.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, total]) => ({ date, total }));
        const stateRows = await repo
            .createQueryBuilder('r')
            .select('r.state', 'key')
            .addSelect('COUNT(*)', 'count')
            .addSelect('COALESCE(SUM(r.actualRefundAmount), 0)', 'amount')
            .where('r.createdAt >= :from', { from: fromDate })
            .andWhere('r.createdAt <= :to', { to: toDate })
            .groupBy('r.state')
            .getRawMany();
        const typeRows = await repo
            .createQueryBuilder('r')
            .select('r.type', 'key')
            .addSelect('COUNT(*)', 'count')
            .addSelect('COALESCE(SUM(r.actualRefundAmount), 0)', 'amount')
            .where('r.createdAt >= :from', { from: fromDate })
            .andWhere('r.createdAt <= :to', { to: toDate })
            .groupBy('r.type')
            .getRawMany();
        // 平均处理时长（小时）：窗口内「已真实退款」行 refundedAt - createdAt 的均值，保留两位；无数据为 null。
        // 同样按 refundedAt 判定（含已结案的 Closed），避免结案后处理时长样本丢失。
        const refundedRows = await repo
            .createQueryBuilder('r')
            .select('r.createdAt', 'createdAt')
            .addSelect('r.refundedAt', 'refundedAt')
            .where('r.refundedAt IS NOT NULL')
            .andWhere('r.createdAt >= :from', { from: fromDate })
            .andWhere('r.createdAt <= :to', { to: toDate })
            .getRawMany();
        const hours = refundedRows
            .map(
        // refundedAt 由 JS 写入（北京墙钟，读回即真实时刻）；createdAt 由 DB now() 写入（UTC 墙钟）。
        // 不做换算会把处理时长整体多算 8 小时。
        (r) => (new Date(r.refundedAt).getTime() - (r.createdAt).getTime()) / 3600000)
            .filter((h) => Number.isFinite(h) && h >= 0);
        const avgHandleHours = hours.length
            ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 100) / 100
            : null;
        return {
            totalRequests,
            pendingCount,
            totalRefundAmount,
            avgHandleHours,
            daily,
            byState: stateRows.map((row) => ({
                key: String(row.key),
                count: Number(row.count),
                amount: Number(row.amount),
            })),
            byType: typeRows.map((row) => ({
                key: String(row.key),
                count: Number(row.count),
                amount: Number(row.amount),
            })),
        };
    }
    async transitionState(ctx, id, toState) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new Error('Request not found');
        const allowed = types_1.STATE_TRANSITIONS[request.state];
        if (!(allowed === null || allowed === void 0 ? void 0 : allowed.includes(toState))) {
            throw new Error(`Invalid transition: ${request.state} -> ${toState}`);
        }
        const saved = await this.commitState(ctx, request, request.state, toState);
        return this.hydrate(ctx, saved.id);
    }
    /**
     * 追加一条协商留言。senderType=customer 供顾客发送（addAfterSalesMessage），admin 供商家回复（replyAfterSalesMessage）。
     * 售后单关闭（Closed）后禁止继续留言；图片 ≤3 张、正文 ≤1000 字。
     */
    async addMessage(ctx, requestId, senderType, content, images) {
        var _a;
        if (!ctx.activeUserId) {
            throw new core_1.UnauthorizedError();
        }
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: requestId } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${requestId} not found`);
        // 顾客留言必须校验归属；商家回复走 Permission.UpdateOrder，不在此列
        if (senderType === 'customer') {
            await this.assertCustomerOwnership(ctx, request);
        }
        if (request.state === 'Closed') {
            // ForbiddenError 是 I18nError，自定义文案会被丢弃，故用 UserInputError 透传禁言提示
            throw new core_1.UserInputError('After-sales request is closed: messaging disabled');
        }
        const trimmed = (content !== null && content !== void 0 ? content : '').trim();
        if (!trimmed) {
            throw new core_1.UserInputError('Message content is required');
        }
        if (trimmed.length > AfterSalesService_1.MESSAGE_MAX_LENGTH) {
            throw new core_1.UserInputError(`Message content exceeds ${AfterSalesService_1.MESSAGE_MAX_LENGTH} characters`);
        }
        const imgs = Array.isArray(images) ? images : [];
        if (imgs.length > AfterSalesService_1.MESSAGE_MAX_IMAGES) {
            throw new core_1.UserInputError(`Message images exceed limit of ${AfterSalesService_1.MESSAGE_MAX_IMAGES}`);
        }
        const senderName = await this.resolveSenderName(ctx, senderType);
        const msgRepo = this.connection.getRepository(ctx, after_sales_message_entity_1.AfterSalesMessage);
        const message = await msgRepo.save(new after_sales_message_entity_1.AfterSalesMessage({
            requestId: Number(requestId),
            senderType,
            senderUserId: Number(ctx.activeUserId),
            senderName,
            content: trimmed,
            images: imgs.length ? imgs : null,
        }));
        core_1.Logger.info(`After-sales message added: request=${requestId} sender=${senderType} user=${ctx.activeUserId}`, constants_1.loggerCtx);
        // 顾客留言 → 商家站内信提醒（notification-plugin 订阅；未装时事件无人消费，仅不提醒）
        if (senderType === 'customer' && this.eventBus) {
            try {
                this.eventBus.publish(new after_sales_events_1.AfterSalesMerchantNotifyEvent(ctx, Number(requestId), '售后有新留言', `顾客在售后单（订单 ${request.orderId}）发来新留言，请及时回复。`));
            }
            catch (e) {
                core_1.Logger.warn(`publish AfterSalesMerchantNotifyEvent failed for #${requestId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
            }
        }
        return message;
    }
    /** 发送人显示名：管理员取 Administrator、顾客取 Customer（姓名拼接），失败兜底 'user' */
    async resolveSenderName(ctx, senderType) {
        var _a;
        if (!ctx.activeUserId)
            return 'user';
        try {
            if (senderType === 'admin') {
                const adminRepo = this.connection.getRepository(ctx, core_1.Administrator);
                const admin = await adminRepo.findOne({
                    where: { user: { id: ctx.activeUserId } },
                    relations: { user: true },
                });
                if (admin)
                    return `${admin.firstName} ${admin.lastName}`.trim();
            }
            else if (this.customerService) {
                const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
                if (customer)
                    return `${customer.firstName} ${customer.lastName}`.trim();
            }
        }
        catch (e) {
            core_1.Logger.warn(`resolveSenderName failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
        }
        return 'user';
    }
    /**
     * 售后单留言列表（createdAt 正序，skip/take 常规分页）。
     * senderType=customer 时校验售后单归属当前顾客，防止越权读他人留言。
     */
    async listMessages(ctx, requestId, senderType, options) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: requestId } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${requestId} not found`);
        if (senderType === 'customer') {
            const customerId = await this.resolveCustomerId(ctx);
            if (!customerId || Number(request.customerId) !== customerId) {
                throw new core_1.ForbiddenError();
            }
        }
        const msgRepo = this.connection.getRepository(ctx, after_sales_message_entity_1.AfterSalesMessage);
        const take = Math.min(Math.max((_a = options === null || options === void 0 ? void 0 : options.take) !== null && _a !== void 0 ? _a : 50, 1), 100);
        const skip = Math.max((_b = options === null || options === void 0 ? void 0 : options.skip) !== null && _b !== void 0 ? _b : 0, 0);
        const [items, totalItems] = await msgRepo.findAndCount({
            where: { requestId: Number(requestId) },
            order: { createdAt: 'ASC' },
            skip,
            take,
        });
        return { items, totalItems };
    }
    /** 批量统计各售后单留言条数并附加到 messageCount 非持久化属性 */
    async attachMessageCounts(ctx, requests) {
        var _a;
        if (!requests.length)
            return;
        const ids = requests.map((r) => Number(r.id));
        const msgRepo = this.connection.getRepository(ctx, after_sales_message_entity_1.AfterSalesMessage);
        const rows = await msgRepo
            .createQueryBuilder('m')
            .select('m.requestId', 'requestId')
            .addSelect('COUNT(*)', 'count')
            .where('m.requestId IN (:...ids)', { ids })
            .groupBy('m.requestId')
            .getRawMany();
        const map = new Map(rows.map((r) => [Number(r.requestId), Number(r.count)]));
        for (const r of requests) {
            r.messageCount = (_a = map.get(Number(r.id))) !== null && _a !== void 0 ? _a : 0;
        }
    }
    // ===== 换货闭环（迭代三期） =====
    /** 换货发货（admin）：Received → ExchangeShipped，仅 exchange 类型、仅 Received 状态可走 */
    async exchangeShip(ctx, id, trackingNo, carrier) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${id} not found`);
        if (request.type !== 'exchange') {
            throw new core_1.UserInputError('Only exchange requests can be exchange-shipped');
        }
        if (request.state !== 'Received') {
            throw new core_1.UserInputError(`Cannot exchange-ship from state: ${request.state}`);
        }
        request.exchangeTrackingNo = trackingNo;
        request.exchangeCarrier = carrier;
        // commitState 统一出口：落历史 + 发布事件（顾客收「换货已发货」站内信）
        return this.commitState(ctx, request, 'Received', 'ExchangeShipped');
    }
    /** 换货确认收货（shop 顾客）：ExchangeShipped → Closed，需校验售后单归属 */
    async exchangeReceive(ctx, id) {
        const repo = this.connection.getRepository(ctx, after_sales_request_entity_1.AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id } });
        if (!request)
            throw new core_1.UserInputError(`After-sales request ${id} not found`);
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId || Number(request.customerId) !== customerId) {
            throw new core_1.ForbiddenError();
        }
        if (request.state !== 'ExchangeShipped') {
            throw new core_1.UserInputError(`Cannot exchange-receive from state: ${request.state}`);
        }
        // commitState 统一出口：fromState=ExchangeShipped 的 Closed 事件驱动「换货完成」站内信
        return this.commitState(ctx, request, 'ExchangeShipped', 'Closed');
    }
};
exports.AfterSalesService = AfterSalesService;
/** 凭证图白名单 MIME 及其扩展名（扩展名用于 createFromFileStream 判定 MIME） */
AfterSalesService.EVIDENCE_MIME_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};
/** 单张凭证图解码后大小上限（5MB），边界校验，非业务规则 */
AfterSalesService.EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
// ===== 协商留言（迭代三期） =====
AfterSalesService.MESSAGE_MAX_IMAGES = 3;
AfterSalesService.MESSAGE_MAX_LENGTH = 1000;
exports.AfterSalesService = AfterSalesService = AfterSalesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder])
], AfterSalesService);
//# sourceMappingURL=after-sales.service.js.map