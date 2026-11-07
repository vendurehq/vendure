import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { In, Not } from 'typeorm';
import { dbNowWallToInstant } from './db-now-wall';
import {
    ID,
    Injector,
    isGraphQlErrorResult,
    ListQueryBuilder,
    ListQueryOptions,
    OrderService,
    CustomerService,
    AssetService,
    Administrator,
    Channel,
    ChannelService,
    ConfigService,
    PaginatedList,
    Payment,
    Refund,
    RequestContext,
    Logger,
    TransactionalConnection,
    EntityNotFoundError,
    EventBus,
    UserInputError,
    ForbiddenError,
    UnauthorizedError,
} from '@vendure/core';

import { loggerCtx, AFTER_SALES_PLUGIN_OPTIONS } from './constants';
import { AfterSalesRequest } from './after-sales-request.entity';
import { AfterSalesMessage, AfterSalesMessageSenderType } from './after-sales-message.entity';
import { AfterSalesStateHistory } from './after-sales-state-history.entity';
import { AfterSalesCustomerRemindEvent, AfterSalesMerchantNotifyEvent, AfterSalesStateTransitionEvent } from './after-sales.events';
import { AfterSalesState, AfterSalesPluginOptions, STATE_TRANSITIONS } from './types';
import { InventoryService } from '@vendure/inventory-plugin';

/** 可退款支付状态：只认已成功支付（Declined/Error/Cancelled 的重试单不可退） */
const REFUNDABLE_PAYMENT_STATES = ['Settled', 'Authorized'];

@Injectable()
export class AfterSalesService {
    private orderService: OrderService | null = null;
    private customerService: CustomerService | null = null;
    private inventoryService: InventoryService | null = null;
    private options: AfterSalesPluginOptions = {};
    private assetService: AssetService | null = null;
    private configService: ConfigService | null = null;
    private channelService: ChannelService | null = null;
    private eventBus: EventBus | null = null;

    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    init(injector: Injector): void {
        this.orderService = injector.get(OrderService);
        this.customerService = injector.get(CustomerService);
        try {
            this.inventoryService = injector.get(InventoryService);
        } catch (e: any) {
            this.inventoryService = null;
            Logger.warn(`InventoryService 不可用，售后回补库存被禁用: ${e?.message ?? e}`, loggerCtx);
        }
        try {
            this.options = injector.get<AfterSalesPluginOptions>(AFTER_SALES_PLUGIN_OPTIONS as any) ?? {};
        } catch {
            this.options = {};
        }
        this.assetService = injector.get(AssetService);
        this.configService = injector.get(ConfigService);
        try {
            this.channelService = injector.get(ChannelService);
        } catch {
            this.channelService = null;
        }
        try {
            this.eventBus = injector.get(EventBus);
        } catch {
            this.eventBus = null;
        }
    }

    /**
     * 当前登录用户对应的 Customer 主键。
     * 说明：ctx.activeUserId 是 User 表主键，而售后单 customerId 存的是 Customer 表主键，
     * 两者是不同实体，必须经 CustomerService.findOneByUserId 桥接，否则过滤永远匹配不到。
     */
    private async resolveCustomerId(ctx: RequestContext): Promise<number | null> {
        if (!ctx.activeUserId || !this.customerService) return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer ? Number(customer.id) : null;
    }

    async findOne(ctx: RequestContext, id: ID): Promise<AfterSalesRequest | undefined> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id as any },
            relations: { order: true, orderLine: true, customer: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } } as any,
        });
        return result ?? undefined;
    }

    /**
     * Shop API 专用：按 customer 过滤，防止越权枚举他人售后单。
     */
    async findOneForCustomer(ctx: RequestContext, id: ID): Promise<AfterSalesRequest | undefined> {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId) {
            throw new UnauthorizedError();
        }
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id as any, customerId },
            relations: { order: true, orderLine: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } } as any,
        });
        if (result) {
            await this.attachMessageCounts(ctx, [result]);
        }
        return result ?? undefined;
    }

    async findMyRequests(
        ctx: RequestContext,
        options?: ListQueryOptions<AfterSalesRequest>,
    ): Promise<PaginatedList<AfterSalesRequest>> {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId) {
            return { items: [], totalItems: 0 };
        }
        return this.listQueryBuilder
            .build(AfterSalesRequest, options, {
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

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<AfterSalesRequest>,
    ): Promise<PaginatedList<AfterSalesRequest>> {
        return this.listQueryBuilder
            .build(AfterSalesRequest, options, {
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

    async createRequest(ctx: RequestContext, input: {
        orderId: ID;
        orderLineId?: ID;
        type: string;
        reason: string;
        description?: string;
        evidenceImages?: string[];
        refundAmount: number;
    }): Promise<AfterSalesRequest> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedError();
        }
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }

        // 1. 校验订单存在且归属当前用户。
        // 注意：order.customer.id 是 Customer 主键，而 ctx.activeUserId 是关联 User 主键，两者不同。
        // 归属校验必须基于 customer.user.id 与 activeUserId 比较。
        let order;
        try {
            order = await this.orderService.findOne(ctx, input.orderId, ['customer', 'customer.user', 'lines'] as any);
        } catch (e: any) {
            throw e;
        }
        if (!order) {
            throw new UserInputError(`Order ${input.orderId} not found`);
        }
        const customerUserId = (order.customer as any)?.user?.id;
        if (!order.customer || customerUserId == null || String(customerUserId) !== String(ctx.activeUserId)) {
            throw new ForbiddenError();
        }

        // 2. 校验订单状态（白名单可配置；外卖单全程 PaymentSettled，由 dev-config 显式放行）
        const allowedStates = this.options?.allowedOrderStates?.length
            ? this.options.allowedOrderStates
            : ['Shipped', 'Delivered', 'PartiallyDelivered', 'Completed', 'Cancelled'];
        if (!allowedStates.includes(order.state)) {
            throw new UserInputError(
                `Cannot create after-sales: order state must be one of ${allowedStates.join('/')}, got ${order.state}`,
            );
        }

        // 3. 售后窗口校验：
        //    afterSalesWindowHours > 0 时按小时窗口（送达时间起算，外卖 24h 场景）；
        //    否则按 maxDays + 15 天质量问题延长逻辑。
        //    计时起点 fulfillmentCompletedAt → fulfillmentDeliveredAt → deliveredAt（外卖骑手送达落库）→ createdAt。
        //    不能用 order.updatedAt：任何订单写回（备注、标签、状态回写等）都会重置时间，使售后窗口被无限延长。
        //    窗口仅对有配送档案的订单生效（外卖/骑手场景专属）；普通快递/自提单（档案字段为空）走 maxDays 分支，
        //    避免 24h 窗口误伤普通单（发货完成 24h 后即不可售后不合理）。
        const cf: Record<string, any> = (order.customFields ?? {}) as any;
        const gate = this.options?.requireOrderCustomField;
        const hasDeliveryArchive = !!gate?.field && cf[gate.field] != null;
        // 口径：前三个 customFields 是 timestamptz（绝对时刻，直接可用）；
        // order.createdAt 是 timestamp + DB DEFAULT now()，库里存 UTC 墙钟，
        // 必须先按 UTC 墙钟还原，否则会被当成 8 小时前，导致售后窗口提前关闭。
        const orderDate: Date = cf.fulfillmentCompletedAt || cf.fulfillmentDeliveredAt || cf.deliveredAt
            || dbNowWallToInstant(order.createdAt);
        const windowHours = this.options?.afterSalesWindowHours ?? 0;
        if (windowHours > 0 && hasDeliveryArchive) {
            const hoursSince = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60);
            if (hoursSince > windowHours) {
                throw new UserInputError(`Cannot create after-sales: exceeded ${windowHours}h window`);
            }
        } else {
            const maxDays = this.options?.maxDaysAfterDelivery ?? 7;
            const daysSince = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince > maxDays + 15) {
                throw new UserInputError(`Cannot create after-sales: exceeded ${maxDays + 15} days limit`);
            }
        }

        // 3.1 送达门槛（外卖/骑手场景）：外卖订单（R1/R2/R3/R5 骑手单、跑腿单）必须已送达才可售后，
        //     防止未送达的骑手单走售后与取消链路双退款；普通快递/自提单/R4 到店自取无骑手配送档案，跳过校验。
        //     不能只在字段有值时校验：未开始配送时 deliveryStatus 为 null，正是最需要拦截的时刻
        //     （旧逻辑下未接单的已支付外卖单可全额退款却不脱厅、不取消订单 → 商家照做、骑手照送，货钱双失）。
        const route = String(cf.fulfillmentRoute ?? '');
        const isCampusDeliveryOrder =
            cf.orderKind === 'errand' || ['R1', 'R2', 'R3', 'R5'].includes(route) || cf.deliveryPlan != null;
        if (gate?.field && (cf[gate.field] != null || isCampusDeliveryOrder)) {
            const actual = cf[gate.field];
            if (String(actual ?? '') !== String(gate.value)) {
                throw new UserInputError(
                    `Cannot create after-sales: order not eligible (${gate.field}=${actual ?? 'null'})`,
                );
            }
        }

        // 4. 退款金额上限校验
        const orderLine = input.orderLineId
            ? order.lines.find(l => String(l.id) === String(input.orderLineId))
            : null;
        if (input.orderLineId && !orderLine) {
            throw new UserInputError(`Order line ${input.orderLineId} not found in order ${input.orderId}`);
        }
        // 下限校验：0/负数金额建单会在执行阶段因 planRefunds 返回空计划而直接置 Refunded，
        // 产生「已退款但实退 0 元」的假结案，必须在建单入口挡住。
        if (!Number.isFinite(input.refundAmount) || input.refundAmount <= 0) {
            throw new UserInputError(`Refund amount must be a positive number, got ${input.refundAmount}`);
        }
        // 含税口径（P1）：proratedLinePrice / order.total 均为不含税额，按此上限会少退税额，
        // 与 createSystemRequest 及实际退款额（支付单实收含税）不一致。优先取含税字段。
        const maxRefund = orderLine
            ? ((orderLine as any).proratedLinePriceWithTax ?? (orderLine as any).proratedLinePrice)
            : ((order as any).totalWithTax
                ?? (order.lines ?? []).reduce((s: number, l: any) => s + (l.proratedLinePriceWithTax ?? l.proratedLinePrice ?? 0), 0));
        // 建单上限还要扣掉历史已退款：否则多笔售后叠加申请、审核通过后执行阶段才因支付单余额不足失败。
        // 无支付单信息（balance < 0）时保持旧行为，仅按订单行/订单金额上限校验。
        const balance = await this.refundableBalance(ctx, order.id as ID);
        const effectiveMax = balance >= 0 ? Math.min(maxRefund, balance) : maxRefund;
        if (input.refundAmount > effectiveMax) {
            throw new UserInputError(`Refund amount ${input.refundAmount} exceeds max ${effectiveMax}`);
        }

        // 4.1 用解码后的实体 ID 存储外键：order.id / line.id 已是数据库内部数字 ID，
        // 不能直接用 GraphQL 编码 ID（T_1）写入 number 外键列，否则触发 FOREIGN KEY 约束失败。
        const entityOrderId = order.id;
        const entityOrderLineId = orderLine ? orderLine.id : null;

        // 5. 重复售后校验：整单售后（无 orderLineId）按订单查重；指定行按行查重（均排除 Closed / Refunded
        //    两个终局态，Rejected 也算占用——被拒单必须走申诉，不允许绕开仲裁重新提单）。
        //    排除 Refunded：退款已完成即可视为本条售后了结，否则同一订单/行永久不能再发起售后。
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        if (entityOrderLineId != null) {
            const existing = await repo.findOne({
                where: { orderLineId: entityOrderLineId as any, state: Not(In(['Closed', 'Refunded'] as any)) },
            });
            if (existing) {
                throw new UserInputError(`After-sales already exists for order line ${input.orderLineId}`);
            }
        } else {
            const existing = await repo.findOne({
                where: { orderId: entityOrderId as any, state: Not(In(['Closed', 'Refunded'] as any)) },
            });
            if (existing) {
                throw new UserInputError(`After-sales already exists for order ${input.orderId}`);
            }
        }
        const request = new AfterSalesRequest({
            orderId: entityOrderId as any,
            orderLineId: entityOrderLineId as any,
            type: (input.type as any) || 'return_refund',
            reason: input.reason,
            description: input.description || null,
            evidenceImages: input.evidenceImages || null,
            refundAmount: input.refundAmount,
            customerId: (order.customer as any).id as any,
        });
        request.channels = [ctx.channel];
        const saved = await this.commitState(ctx, request, null, 'Pending');
        Logger.info(`After-sales request ${saved.id} created by customer ${ctx.activeUserId}`, loggerCtx);
        return this.hydrate(ctx, saved.id);
    }

    /**
     * 系统内部建单（P4 酒店预订取消链路）：绕过顾客门禁（订单状态/送达/窗口白名单），
     * 由后端策略计算退款额后代顾客发起；归属仍落订单顾客，状态历史/事件经统一 commitState 出口。
     * 调用方负责后续审批（refund_only 可直接 approveRequest 走自动退款链）。
     */
    async createSystemRequest(
        ctx: RequestContext,
        input: {
            orderId: ID;
            orderLineId?: ID;
            type: string;
            reason: string;
            description?: string;
            refundAmount: number;
        },
    ): Promise<AfterSalesRequest> {
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const order = await this.orderService.findOne(ctx, input.orderId, ['customer', 'lines'] as any);
        if (!order) {
            throw new UserInputError(`Order ${input.orderId} not found`);
        }
        const orderLine = input.orderLineId
            ? order.lines.find(l => String(l.id) === String(input.orderLineId))
            : undefined;
        if (input.orderLineId && !orderLine) {
            throw new UserInputError(`Order line ${input.orderLineId} not found in order ${input.orderId}`);
        }
        // 下限校验：0/负数金额建单会在执行阶段因 planRefunds 返回空计划而直接置 Refunded，
        // 产生「已退款但实退 0 元」的假结案；系统建单的调用方（酒店取消/改期退差）均为正数。
        if (!Number.isFinite(input.refundAmount) || input.refundAmount <= 0) {
            throw new UserInputError(`Refund amount must be a positive number, got ${input.refundAmount}`);
        }
        const refundAmount = Math.round(input.refundAmount);
        // 含税口径优先（酒店预订等含税价租户：proratedLinePrice 为不含税额，会误拦真实可退额）
        const maxRefund = orderLine
            ? ((orderLine as any).proratedLinePriceWithTax ?? (orderLine as any).proratedLinePrice)
            : ((order as any).totalWithTax ??
                order.lines.reduce(
                    (s: number, l: any) => s + (l.proratedLinePriceWithTax ?? l.proratedLinePrice ?? 0),
                    0,
                ));
        // 与 createRequest 一致：上限还需扣掉历史已退款，避免系统建单超额后执行阶段才失败
        const balance = await this.refundableBalance(ctx, order.id as ID);
        const effectiveMax = balance >= 0 ? Math.min(maxRefund, balance) : maxRefund;
        if (refundAmount > effectiveMax) {
            throw new UserInputError(`Refund amount ${refundAmount} exceeds max ${effectiveMax}`);
        }
        if (!(order as any).customer?.id) {
            throw new UserInputError(`Order ${input.orderId} has no customer`);
        }

        const entityOrderId = order.id;
        const entityOrderLineId = orderLine ? orderLine.id : null;
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        // 行级幂等：同一订单行已有未了结（非 Closed/Refunded）售后单则拒绝（酒店 booking.afterSalesRequestId 亦做去重）
        if (entityOrderLineId != null) {
            const existing = await repo.findOne({
                where: { orderLineId: entityOrderLineId as any, state: Not(In(['Closed', 'Refunded'] as any)) },
            });
            if (existing) {
                throw new UserInputError(`After-sales already exists for order line ${input.orderLineId}`);
            }
        }

        const request = new AfterSalesRequest({
            orderId: entityOrderId as any,
            orderLineId: entityOrderLineId as any,
            type: (input.type as any) || 'refund_only',
            reason: input.reason,
            description: input.description || null,
            evidenceImages: null,
            refundAmount,
            customerId: (order as any).customer.id as any,
        });
        request.channels = [ctx.channel];
        const saved = await this.commitState(ctx, request, null, 'Pending');
        Logger.info(
            `After-sales request ${saved.id} created by system (order ${entityOrderId}, line ${entityOrderLineId ?? '-'})`,
            loggerCtx,
        );
        return this.hydrate(ctx, saved.id);
    }

    /**
     * Shop 侧写操作归属校验：后台（admin）由 Permission.UpdateOrder 兜底，
     * shop 必须确认售后单属于当前登录顾客，否则为越权（IDOR）。
     */
    private async assertCustomerOwnership(ctx: RequestContext, request: AfterSalesRequest): Promise<void> {
        if (ctx.apiType !== 'shop') return;
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId || Number(request.customerId) !== customerId) {
            throw new ForbiddenError();
        }
    }

    async cancelRequest(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
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
    async adminCancelRequest(ctx: RequestContext, id: ID, reason?: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new UserInputError(`After-sales request ${id} not found`);
        if (request.state !== 'Pending') {
            throw new UserInputError(`Cannot close request in state: ${request.state}`);
        }
        const why = String(reason ?? '').trim();
        if (why) request.rejectReason = why.slice(0, 200);
        // commitState 统一出口：落历史 + 发布事件（顾客收「售后已关闭」站内信）
        return this.commitState(ctx, request, 'Pending', 'Closed');
    }

    /**
     * 商家催办顾客：仅进行中单可催（Pending/Approved/Returning/Appealed）。
     * 经事件交由 notification-plugin 落顾客站内信；未装时仅无提醒，不影响返回。
     */
    async remindCustomer(ctx: RequestContext, id: ID, note?: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new UserInputError(`After-sales request ${id} not found`);
        if (!['Pending', 'Approved', 'Returning', 'Appealed'].includes(request.state)) {
            throw new UserInputError(`Cannot remind in state: ${request.state}`);
        }
        const extra = String(note ?? '').trim();
        try {
            await this.eventBus?.publish(new AfterSalesCustomerRemindEvent(
                ctx,
                Number(request.id),
                request.customerId == null ? null : Number(request.customerId),
                '售后处理提醒',
                extra
                    ? extra.slice(0, 200)
                    : '商家提醒您及时处理售后事项（如寄回商品、确认收货），可在售后详情查看最新进展。',
            ));
        } catch (e: any) {
            Logger.warn(`publish AfterSalesCustomerRemindEvent failed for #${id}: ${e?.message ?? e}`, loggerCtx);
        }
        return request;
    }

    /**
     * 退款完成结案：Refunded → Closed。
     * 退款到账后售后单若一直停在 Refunded，该订单/行会被查重逻辑永久占用、后台列表持续堆积，
     * 因此提供显式结案出口（其余终局态如 ExchangeShipped 已有各自关闭路径）。
     */
    async closeRequest(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new EntityNotFoundError('AfterSalesRequest', id);
        if (request.state !== 'Refunded') {
            throw new UserInputError(`Cannot close request in state: ${request.state}`);
        }
        const fromState = request.state;
        const saved = await this.commitState(ctx, request, fromState, 'Closed');
        // 同步回写订单看板状态，避免订单长期挂「已退款」而与实际售后已结案不一致
        await this.updateOrderAfterSalesStatus(ctx, saved.orderId, 'Closed');
        Logger.info(`after-sales#${saved.id} 退款完成结案`, loggerCtx);
        return this.hydrate(ctx, saved.id);
    }

    async updateReturnTracking(ctx: RequestContext, id: ID, trackingNo: string, carrier: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
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

    /** 凭证图白名单 MIME 及其扩展名（扩展名用于 createFromFileStream 判定 MIME） */
    private static readonly EVIDENCE_MIME_EXT: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
    };

    /** 单张凭证图解码后大小上限（5MB），边界校验，非业务规则 */
    private static readonly EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

    /**
     * 顾客端上传售后凭证图。
     * 仅做「边界校验 + 落 Asset」，不创建售后单、不写售后业务数据。
     * 返回绝对值 URL：AssetInterceptorPlugin 只对 GraphQL 类型为 Asset 的字段补绝对前缀，
     * 这里是 [String!]!，必须自行调用 storageStrategy.toAbsoluteUrl（与 Vendure 自身行为一致）。
     */
    async uploadEvidence(ctx: RequestContext, images: string[]): Promise<string[]> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedError();
        }
        if (!Array.isArray(images) || images.length === 0) {
            throw new UserInputError('No evidence image provided');
        }
        if (!this.assetService || !this.configService) {
            throw new Error('AssetService not initialized');
        }
        const urls: string[] = [];
        for (const dataUrl of images) {
            const parsed = AfterSalesService.parseImageDataUrl(dataUrl);
            if (!parsed) {
                throw new UserInputError('Invalid evidence image: only png/jpeg/webp data URL is allowed');
            }
            if (parsed.buffer.length > AfterSalesService.EVIDENCE_MAX_BYTES) {
                throw new UserInputError(
                    `Evidence image too large: ${parsed.buffer.length} bytes exceeds ${AfterSalesService.EVIDENCE_MAX_BYTES} bytes`,
                );
            }
            const filename = `after-sales-evidence-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${parsed.ext}`;
            const asset = await this.assetService.createFromFileStream(Readable.from(parsed.buffer), filename, ctx);
            if (isGraphQlErrorResult(asset)) {
                throw new UserInputError(`Failed to create asset: ${asset.message}`);
            }
            urls.push(this.toAbsoluteAssetUrl(ctx, (asset as any).preview));
        }
        Logger.info(`Uploaded ${urls.length} after-sales evidence image(s) by user ${ctx.activeUserId}`, loggerCtx);
        return urls;
    }

    /** 解析 `data:image/(png|jpeg|webp);base64,xxx`，非法返回 null */
    private static parseImageDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
        if (typeof dataUrl !== 'string') return null;
        const match = /^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
        if (!match) return null;
        const mime = match[1].toLowerCase();
        const ext = AfterSalesService.EVIDENCE_MIME_EXT[mime];
        if (!ext) return null;
        try {
            const buffer = Buffer.from(match[2], 'base64');
            if (buffer.length === 0) return null;
            return { buffer, ext };
        } catch {
            return null;
        }
    }

    /** 与 AssetInterceptorPlugin 同源：用 assetStorageStrategy.toAbsoluteUrl 补绝对前缀 */
    private toAbsoluteAssetUrl(ctx: RequestContext, preview: string | null | undefined): string {
        if (!preview) return '';
        const strategy = this.configService?.assetOptions.assetStorageStrategy as any;
        if (strategy?.toAbsoluteUrl && ctx.req) {
            return strategy.toAbsoluteUrl(ctx.req, preview);
        }
        return preview;
    }

    /**
     * Mutation 保存后重新加载并返回带关系（order/orderLine）的实体。
     * 直接 repo.save() 返回的实体关系未加载，Shop SDL 中 `order: Order!` 非空字段会被自动关系解析取到 null，
     * 触发 "Cannot return null for non-nullable field AfterSalesRequest.order"。
     */
    private async hydrate(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const full = await repo.findOne({
            where: { id: id as any },
            relations: { order: true, orderLine: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } } as any,
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
    private async commitState(
        ctx: RequestContext,
        request: AfterSalesRequest,
        fromState: string | null,
        toState: AfterSalesState,
    ): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        request.state = toState;
        const saved = await repo.save(request);
        await this.recordState(ctx, Number(saved.id), fromState, toState);
        try {
            const full = await repo.findOne({ where: { id: saved.id as any }, relations: { order: true } });
            await this.eventBus?.publish(
                new AfterSalesStateTransitionEvent(
                    ctx,
                    Number(saved.id),
                    Number(saved.orderId),
                    saved.type,
                    fromState,
                    toState,
                    saved.customerId != null ? Number(saved.customerId) : null,
                    full?.order?.code ?? null,
                    new Date(),
                ),
            );
        } catch (e: any) {
            Logger.warn(`publish AfterSalesStateTransitionEvent failed for #${saved.id}: ${e?.message ?? e}`, loggerCtx);
        }
        return saved;
    }

    /** 状态流转历史落库：失败仅告警，绝不阻断主流程 */
    private async recordState(ctx: RequestContext, requestId: number, fromState: string | null, toState: string): Promise<void> {
        try {
            const repo = this.connection.getRepository(ctx, AfterSalesStateHistory);
            await repo.insert({
                requestId,
                fromState: fromState ?? null,
                toState,
                operatorUserId: ctx.activeUserId != null ? Number(ctx.activeUserId) : null,
            });
        } catch (e: any) {
            Logger.warn(`recordState failed for after-sales #${requestId}: ${e?.message ?? e}`, loggerCtx);
        }
    }

    // ===== Admin Operations =====

    async approveRequest(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
        const saved = await this.transitionState(ctx, id, 'Approved');
        // refund_only（外卖）无需退货：审批通过（含 48h 自动同意）即链式 Received → 退款
        if ((request.type as string) === 'refund_only') {
            return this.refundOnlyChain(ctx, id);
        }
        return saved;
    }

    /** refund_only 退款链：Approved → Received（免退货直达）→ executeRefund。
     *  退款失败由 executeRefund 内部落 RefundFailed 可重试，不回滚已到达的 Received。 */
    private async refundOnlyChain(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        await this.transitionState(ctx, id, 'Received');
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id as any },
            relations: ['order', 'order.payments'] as any,
        });
        if (!request) throw new EntityNotFoundError('AfterSalesRequest', id);
        // 余额不足属于事务外前置拒绝，executeRefund 此时不会落 RefundFailed；
        // 若不兜底，售后单会卡在 Received，而后台重试入口只认 RefundFailed，只能人工走 processAfterSalesRefund。
        const plan = await this.planRefunds(ctx, request.orderId, request.refundAmount);
        if (plan == null) {
            const reason = `Cannot refund: insufficient refundable balance for order ${request.orderId}`;
            await this.applyRefundFailed(ctx, request.id, reason, false);
            Logger.warn(`refund_only 链式退款前置拒绝，已置 RefundFailed: ${reason}`, loggerCtx);
            return this.hydrate(ctx, request.id as any);
        }
        return this.executeRefund(ctx, request);
    }

    async rejectRequest(ctx: RequestContext, id: ID, reason: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
        if (!STATE_TRANSITIONS[request.state]?.includes('Rejected')) {
            throw new Error(`Cannot reject from state: ${request.state}`);
        }
        const fromState = request.state;
        request.rejectReason = reason;
        const saved = await this.commitState(ctx, request, fromState, 'Rejected');
        return this.hydrate(ctx, saved.id);
    }

    /** C 端申诉：Rejected → Appealed（仅本人售后单）；申诉说明落入协商留言流（customer），商家/平台可见 */
    async appealRequest(ctx: RequestContext, id: ID, note: string): Promise<AfterSalesRequest> {
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId) throw new UnauthorizedError();
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any, customerId } });
        if (!request) throw new UserInputError(`After-sales request ${id} not found`);
        if (request.state !== 'Rejected') {
            throw new UserInputError(`Cannot appeal request in state: ${request.state}`);
        }
        if (note?.trim()) {
            await this.addMessage(ctx, id, 'customer', note.trim().slice(0, 1000));
        }
        return this.transitionState(ctx, id, 'Appealed');
    }

    /** 平台仲裁：Appealed → Approved（同意；refund_only 链式退款）| Closed（维持拒绝，note 必填写入 rejectReason） */
    async arbitrateRequest(ctx: RequestContext, id: ID, approve: boolean, note?: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
        if (request.state !== 'Appealed') {
            throw new Error(`Cannot arbitrate request in state: ${request.state}`);
        }
        if (!approve) {
            const text = (note ?? '').trim();
            if (!text) throw new UserInputError('维持拒绝必须填写仲裁说明');
            request.rejectReason = text;
            await repo.save(request);
            return this.transitionState(ctx, id, 'Closed');
        }
        if (note?.trim()) {
            // 仲裁说明落入协商留言流（admin 侧），C 端留言卡可见
            await this.addMessage(ctx, id, 'admin', note.trim().slice(0, 1000));
        }
        const saved = await this.transitionState(ctx, id, 'Approved');
        if ((request.type as string) === 'refund_only') {
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
    async confirmReceive(ctx: RequestContext, id: ID, receivedQuantity?: number): Promise<AfterSalesRequest> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const repo = this.connection.getRepository(txCtx, AfterSalesRequest);
            const request = await repo.findOne({
                where: { id: id as any },
                relations: ['orderLine'],
            });
            if (!request) throw new Error('Request not found');
            const allowed = STATE_TRANSITIONS[request.state];
            if (!allowed?.includes('Received')) {
                throw new Error(`Invalid transition: ${request.state} -> Received`);
            }

            // 实收数量：显式传入则记录；否则缺省为订单行数量（全额回补）
            const orderLine = request.orderLine;
            const orderedQty = orderLine ? Number(orderLine.quantity) || 0 : 0;
            if (receivedQuantity != null) {
                request.receivedQuantity = Math.max(0, Math.floor(receivedQuantity));
            }
            const recoverQty = Math.max(
                0,
                Math.min(
                    orderedQty,
                    request.receivedQuantity != null ? request.receivedQuantity : orderedQty,
                ),
            );

            // 部分退货：退款额必须按实收数量收紧，否则「只收回 1 件仍退全额」造成资损。
            // 仅在有订单行、显式传了实收数量且少于订购数量时生效；缺省全收不调整（兼容原全额退款）。
            if (orderLine && orderedQty > 0 && receivedQuantity != null && recoverQty < orderedQty) {
                const lineTax = Number(
                    (orderLine as any).proratedLinePriceWithTax ?? (orderLine as any).proratedLinePrice ?? 0,
                );
                if (lineTax > 0) {
                    const capped = Math.floor((lineTax * recoverQty) / orderedQty);
                    if (capped < Number(request.refundAmount)) {
                        Logger.warn(
                            `after-sales#${request.id} 实收 ${recoverQty}/${orderedQty}，退款额 ${request.refundAmount} → ${capped}`,
                            loggerCtx,
                        );
                        request.refundAmount = capped;
                    }
                }
            }

            // 库存回补：按各仓实际发货比例多仓按包回补（单仓退化原逻辑），落 restockJson 留痕
            if (orderLine && this.inventoryService && recoverQty > 0) {
                try {
                    const restockDetail = await this.inventoryService.applyAfterSalesRestockMulti(
                        txCtx,
                        (orderLine.id as any) as ID,
                        recoverQty,
                        `AS${request.id}`,
                    );
                    request.restockJson = restockDetail.length ? JSON.stringify(restockDetail) : null;
                    Logger.info(
                        `库存回补 after-sales#${request.id}: ${JSON.stringify(restockDetail)}`,
                        loggerCtx,
                    );
                } catch (e: any) {
                    // 回补失败不阻断收退货流程（仍可退款），仅告警便于运维追查
                    Logger.error(
                        `库存回补失败 after-sales#${request.id}: ${e?.message ?? e}`,
                        loggerCtx,
                    );
                }
            } else if (recoverQty === 0) {
                Logger.warn(`after-sales#${request.id} recoverQty=0，跳过库存回补`, loggerCtx);
            } else {
                Logger.warn(
                    `after-sales#${request.id} 无订单行或 InventoryService 不可用，跳过库存回补`,
                    loggerCtx,
                );
            }

            const fromState = request.state;
            const saved = await this.commitState(txCtx, request, fromState, 'Received');
            return this.hydrate(txCtx, saved.id);
        });
    }

    async processRefund(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id as any },
            relations: ['order', 'order.payments'] as any,
        });
        if (!request) {
            throw new EntityNotFoundError('AfterSalesRequest', id);
        }
        if (request.state !== 'Received') {
            throw new UserInputError('Cannot refund: request must be in Received state');
        }
        if (request.type === 'exchange') {
            throw new UserInputError('Cannot refund: exchange requests are not refundable');
        }
        return this.executeRefund(ctx, request);
    }

    /**
     * 退款失败后重试：仅 RefundFailed 允许；复用 executeRefund 退款核心。
     */
    async retryRefund(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        if (!this.orderService) {
            throw new Error('OrderService not initialized');
        }
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({
            where: { id: id as any },
            relations: ['order', 'order.payments'] as any,
        });
        if (!request) {
            throw new EntityNotFoundError('AfterSalesRequest', id);
        }
        if (request.state !== 'RefundFailed') {
            throw new UserInputError('Cannot retry refund: request must be in RefundFailed state');
        }
        return this.executeRefund(ctx, request);
    }

    /**
     * 退款核心：按「新→旧」把退款额拆分到多张可退支付单（组合支付：余额+微信/多笔），
     * 逐笔 refundOrder；停在 Pending 时 settleRefund 推进，只有全部达 Settled 才置 Refunded。
     * 某笔失败时：已成功打款的笔次保留（钱已真实退回，不可回滚），售后单置 RefundFailed，
     * 下次重试会自动按更新后的剩余额度继续退，避免重复退款。
     */
    private async executeRefund(ctx: RequestContext, request: AfterSalesRequest): Promise<AfterSalesRequest> {
        const plan = await this.planRefunds(ctx, request.orderId, request.refundAmount);
        if (plan == null) {
            throw new UserInputError(
                `Cannot refund: insufficient refundable balance for order ${request.orderId}`,
            );
        }
        const fromState = request.state;

        // 事务包裹：退款成功后统一提交（改状态 + 落账 + 回写 order.afterSalesStatus），失败回滚整笔。
        await this.connection.startTransaction(ctx);
        try {
            let settledAmount = 0;
            const transactionIds: string[] = [];
            // 该笔退款未达 Settled：把 Refund 置 Failed，使下次 planRefunds 不计入已退额度（可重试），
            // 与 campus settleRefundOrMarkFailed 同口径。
            const markRefundFailed = async (refund: any) => {
                if (!refund?.id) return;
                try {
                    refund.state = 'Failed';
                    await this.connection.getRepository(ctx, Refund).save(refund);
                } catch (e: any) {
                    Logger.warn(`mark refund ${refund.id} failed error: ${e?.message ?? e}`, loggerCtx);
                }
            };
            const failPartial = async (error: string, reasonMsg: string) => {
                request.refundError = error;
                request.refundedAt = undefined;
                request.actualRefundAmount = (request.actualRefundAmount ?? 0) + settledAmount;
                await this.commitState(ctx, request, fromState, 'RefundFailed');
                await this.updateOrderAfterSalesStatus(ctx, request.orderId, 'RefundFailed');
                await this.connection.commitOpenTransaction(ctx);
                Logger.warn(reasonMsg, loggerCtx);
                return this.hydrate(ctx, request.id as any);
            };

            for (const leg of plan) {
                let refund: any;
                try {
                    const refundResult = await this.orderService!.refundOrder(ctx, {
                        paymentId: leg.paymentId,
                        amount: leg.amount,
                        reason: `After-sales refund #${request.id}`,
                        shipping: 0, // Refund.shipping 为 NOT NULL 列，必须显式置 0
                        adjustment: 0,
                    } as any);
                    if (isGraphQlErrorResult(refundResult)) {
                        return failPartial(
                            `refundOrder 拒绝: ${JSON.stringify(refundResult)}`,
                            `after-sales #${request.id} refundOrder 拒绝 (partial ${settledAmount})`,
                        );
                    }
                    refund = refundResult as any;
                    if (refund.state === 'Pending') {
                        const settled = await this.orderService!.settleRefund(ctx, {
                            id: refund.id as ID,
                            transactionId: refund.transactionId ?? '',
                        } as any);
                        refund.state = (settled as any).state;
                        refund.transactionId = (settled as any).transactionId ?? refund.transactionId;
                    }
                } catch (e: any) {
                    // 该笔未成功（或结算异常）：已成功的笔次保留并提交，剩余额度留给重试
                    await markRefundFailed(refund);
                    return failPartial(
                        `退款异常: ${e?.message ?? e}`,
                        `after-sales #${request.id} refund leg 异常 (partial ${settledAmount}): ${e?.message ?? e}`,
                    );
                }
                if (refund.state !== 'Settled') {
                    await markRefundFailed(refund);
                    return failPartial(
                        `退款未达 Settled，当前 ${refund.state}`,
                        `after-sales #${request.id} 退款终态 ${refund.state}，已置 RefundFailed`,
                    );
                }
                settledAmount += refund.total != null ? Number(refund.total) : leg.amount;
                if (refund.transactionId) transactionIds.push(String(refund.transactionId));
            }

            request.refundTransactionId = transactionIds.length ? transactionIds.join(',') : null;
            request.actualRefundAmount = (request.actualRefundAmount ?? 0) + settledAmount;
            request.refundError = null;
            request.refundedAt = new Date();
            await this.commitState(ctx, request, fromState, 'Refunded');
            await this.updateOrderAfterSalesStatus(ctx, request.orderId, 'Refunded');
            Logger.info(
                `Refund settled for after-sales request #${request.id}, tx=${request.refundTransactionId}`,
                loggerCtx,
            );
            await this.connection.commitOpenTransaction(ctx);
        } catch (e: any) {
            await this.connection.rollBackTransaction(ctx);
            Logger.error(`Refund failed for after-sales #${request.id}: ${e.message}`, loggerCtx);
            // 未知异常：置 RefundFailed 以便重试，而非让事务留下半成品
            await this.applyRefundFailed(ctx, request.id, e.message, false);
            throw e;
        }
        return this.hydrate(ctx, request.id as any);
    }

    /**
     * 订单可退余额（与 planRefunds 同口径）：可退支付单实收合计 − 已退合计（排除 Failed，未真实打款）。
     * 无任何可退支付单时返回 -1，表示「无法计算」，调用方据此跳过收紧、维持原上限校验。
     */
    private async refundableBalance(ctx: RequestContext, orderId: ID): Promise<number> {
        const payments = await this.connection.getRepository(ctx, Payment).find({
            where: { order: { id: orderId } } as any,
            order: { id: 'DESC' } as any,
        });
        const refundable = payments.filter(p => REFUNDABLE_PAYMENT_STATES.includes(String(p.state)));
        if (refundable.length === 0) return -1;
        let balance = 0;
        for (const payment of refundable) {
            const refunded = await this.connection
                .getRepository(ctx, Refund)
                .createQueryBuilder('r')
                .select('COALESCE(SUM(r.total), 0)', 'sum')
                .where('r.paymentId = :pid', { pid: payment.id })
                .andWhere('r.state <> :failed', { failed: 'Failed' })
                .getRawOne();
            balance += Math.max(0, Number(payment.amount) - Number(refunded?.sum ?? 0));
        }
        return balance;
    }

    /**
     * 生成退款计划（新→旧）：每张支付单退「自身剩余额度」，累计到 request.refundAmount 为止。
     * 组合支付（余额+微信/多笔）跨单拆分；总额不足返回 null（调用方拒绝，绝不部分退）。
     * 只认 Settled/Authorized，已退总额排除 Failed（结算失败未真实打款，允许重试）。
     */
    private async planRefunds(
        ctx: RequestContext,
        orderId: ID,
        needAmount: number,
    ): Promise<Array<{ paymentId: ID; amount: number }> | null> {
        if (needAmount <= 0) return [];
        const payments = await this.connection.getRepository(ctx, Payment).find({
            where: { order: { id: orderId } } as any,
            order: { id: 'DESC' } as any,
        });
        const plan: Array<{ paymentId: ID; amount: number }> = [];
        let left = needAmount;
        for (const payment of payments) {
            if (!REFUNDABLE_PAYMENT_STATES.includes(String(payment.state))) continue;
            const refunded = await this.connection
                .getRepository(ctx, Refund)
                .createQueryBuilder('r')
                .select('COALESCE(SUM(r.total), 0)', 'sum')
                .where('r.paymentId = :pid', { pid: payment.id })
                .andWhere('r.state <> :failed', { failed: 'Failed' })
                .getRawOne();
            const remaining = Number(payment.amount) - Number(refunded?.sum ?? 0);
            if (remaining <= 0) continue;
            const take = Math.min(remaining, left);
            plan.push({ paymentId: payment.id as ID, amount: take });
            left -= take;
            if (left <= 0) break;
        }
        return left > 0 ? null : plan;
    }

    /** 幂等地把售后单置为 RefundFailed（不入事务，供 catch 兜底），避免异常路径留下半成品脏数据 */
    private async applyRefundFailed(ctx: RequestContext, idOrRequest: ID | AfterSalesRequest, error: string, inTx: boolean): Promise<void> {
        try {
            const repo = this.connection.getRepository(ctx, AfterSalesRequest);
            const request =
                typeof idOrRequest === 'object' ? idOrRequest : await repo.findOne({ where: { id: idOrRequest as any } });
            if (!request || request.state === 'Refunded') return;
            const fromState = request.state;
            request.refundError = error;
            request.refundedAt = undefined;
            if (fromState !== 'RefundFailed') {
                await this.commitState(ctx, request, fromState, 'RefundFailed');
            } else {
                // 已是 RefundFailed 的重复兜底：只更新错误信息，不再发布事件（防重试风暴）
                await repo.save(request);
            }
            await this.updateOrderAfterSalesStatus(ctx, (request as any).orderId, 'RefundFailed');
        } catch (inner: any) {
            Logger.error(`applyRefundFailed 兜底写入失败: ${inner?.message ?? inner}`, loggerCtx);
        }
    }

    /**
     * 回写 Order customFields.afterSalesStatus。失败仅告警，不影响主流程。
     */
    private async updateOrderAfterSalesStatus(ctx: RequestContext, orderId: ID, status: string): Promise<void> {
        if (!this.orderService) return;
        try {
            await this.orderService.updateCustomFields(ctx, orderId, { afterSalesStatus: status });
        } catch (e: any) {
            Logger.warn(`Failed to update order afterSalesStatus: ${e.message}`, loggerCtx);
        }
    }

    /** Admin 单查：加载 order/orderLine/customer/history（web-admin 详情页专用，替代列表过滤 hack） */
    async findOneForAdmin(ctx: RequestContext, id: ID): Promise<AfterSalesRequest | undefined> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const result = await repo.findOne({
            where: { id: id as any },
            relations: { order: true, orderLine: true, customer: true, channels: true, history: true },
            order: { history: { createdAt: 'ASC' } } as any,
        });
        if (result) {
            await this.attachMessageCounts(ctx, [result]);
        }
        return result ?? undefined;
    }

    /** 批量同意：复用单条方法逐条执行，单条失败不中断整批。上限 50。 */
    async batchApprove(ctx: RequestContext, ids: ID[]): Promise<Array<{ id: string; success: boolean; state: string; message: string }>> {
        if (!Array.isArray(ids) || ids.length === 0) throw new UserInputError('ids is required');
        if (ids.length > 50) throw new UserInputError(`Batch limit is 50, got ${ids.length}`);
        const results: Array<{ id: string; success: boolean; state: string; message: string }> = [];
        for (const id of ids) {
            try {
                const r = await this.approveRequest(ctx, id);
                results.push({ id: String(id), success: true, state: r.state, message: '' });
            } catch (e: any) {
                results.push({ id: String(id), success: false, state: '', message: e?.message ?? String(e) });
            }
        }
        return results;
    }

    /** 批量拒绝：同 batchApprove，整批共用一个 reason。 */
    async batchReject(ctx: RequestContext, ids: ID[], reason: string): Promise<Array<{ id: string; success: boolean; state: string; message: string }>> {
        if (!Array.isArray(ids) || ids.length === 0) throw new UserInputError('ids is required');
        if (ids.length > 50) throw new UserInputError(`Batch limit is 50, got ${ids.length}`);
        const results: Array<{ id: string; success: boolean; state: string; message: string }> = [];
        for (const id of ids) {
            try {
                const r = await this.rejectRequest(ctx, id, reason);
                results.push({ id: String(id), success: true, state: r.state, message: '' });
            } catch (e: any) {
                results.push({ id: String(id), success: false, state: '', message: e?.message ?? String(e) });
            }
        }
        return results;
    }

    /** 读当前渠道售后寄回地址（Admin/Shop 共用；未配置返回空串） */
    async getReturnAddress(ctx: RequestContext): Promise<string> {
        const repo = this.connection.getRepository(ctx, Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId as any } });
        return (channel?.customFields as any)?.afterSalesReturnAddress ?? '';
    }

    /** 写当前渠道售后寄回地址（走 ChannelService.update，免开 ChannelService 权限） */
    async updateReturnAddress(ctx: RequestContext, address: string): Promise<boolean> {
        if (!this.channelService) throw new Error('ChannelService not initialized');
        await this.channelService.update(ctx, {
            id: ctx.channelId as any,
            customFields: { afterSalesReturnAddress: address },
        } as any);
        return true;
    }

    /**
     * 售后数据看板聚合（三期设计 §四）：窗口申请总数 / 仍 Pending / 实退总额 / 平均处理时长 / 按日 / 按状态 / 按类型。
     * from/to 接受 'YYYY-MM-DD' 或完整 ISO 串（纯日期的 to 按当日 23:59:59.999 收口）。
     * 分日聚合用 SUBSTR(createdAt,1,10)（sqlite/mysql 均支持）；平均处理时长用 JS 计算避免跨库 AVG 精度差异。
     */
    async stats(ctx: RequestContext, from: string, to: string): Promise<any> {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            throw new UserInputError('Invalid from/to date');
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) {
            toDate.setHours(23, 59, 59, 999);
        }
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);

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
        const totalRefundAmount = Number(refundRow?.total ?? 0);

        // 按日聚合在 JS 完成（DB 无关）：直接截取 createdAt 原始串的日期前缀，避免时区换算漂移。
        const dailyMap = new Map<string, number>();
        for (const row of createdRows) {
            const date = String((row as any).createdAt ?? '').slice(0, 10);
            if (!date) continue;
            dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
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
                (r: any) =>
                    (new Date(r.refundedAt).getTime() - dbNowWallToInstant(r.createdAt).getTime()) / 3600000,
            )
            .filter((h: number) => Number.isFinite(h) && h >= 0);
        const avgHandleHours = hours.length
            ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 100) / 100
            : null;

        return {
            totalRequests,
            pendingCount,
            totalRefundAmount,
            avgHandleHours,
            daily,
            byState: stateRows.map((row: any) => ({
                key: String(row.key),
                count: Number(row.count),
                amount: Number(row.amount),
            })),
            byType: typeRows.map((row: any) => ({
                key: String(row.key),
                count: Number(row.count),
                amount: Number(row.amount),
            })),
        };
    }

    private async transitionState(ctx: RequestContext, id: ID, toState: AfterSalesState): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new Error('Request not found');
        const allowed = STATE_TRANSITIONS[request.state];
        if (!allowed?.includes(toState)) {
            throw new Error(`Invalid transition: ${request.state} -> ${toState}`);
        }
        const saved = await this.commitState(ctx, request, request.state, toState);
        return this.hydrate(ctx, saved.id);
    }

    // ===== 协商留言（迭代三期） =====

    private static readonly MESSAGE_MAX_IMAGES = 3;
    private static readonly MESSAGE_MAX_LENGTH = 1000;

    /**
     * 追加一条协商留言。senderType=customer 供顾客发送（addAfterSalesMessage），admin 供商家回复（replyAfterSalesMessage）。
     * 售后单关闭（Closed）后禁止继续留言；图片 ≤3 张、正文 ≤1000 字。
     */
    async addMessage(
        ctx: RequestContext,
        requestId: ID,
        senderType: AfterSalesMessageSenderType,
        content: string,
        images?: string[] | null,
    ): Promise<AfterSalesMessage> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedError();
        }
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: requestId as any } });
        if (!request) throw new UserInputError(`After-sales request ${requestId} not found`);
        // 顾客留言必须校验归属；商家回复走 Permission.UpdateOrder，不在此列
        if (senderType === 'customer') {
            await this.assertCustomerOwnership(ctx, request);
        }
        if (request.state === 'Closed') {
            // ForbiddenError 是 I18nError，自定义文案会被丢弃，故用 UserInputError 透传禁言提示
            throw new UserInputError('After-sales request is closed: messaging disabled');
        }
        const trimmed = (content ?? '').trim();
        if (!trimmed) {
            throw new UserInputError('Message content is required');
        }
        if (trimmed.length > AfterSalesService.MESSAGE_MAX_LENGTH) {
            throw new UserInputError(`Message content exceeds ${AfterSalesService.MESSAGE_MAX_LENGTH} characters`);
        }
        const imgs = Array.isArray(images) ? images : [];
        if (imgs.length > AfterSalesService.MESSAGE_MAX_IMAGES) {
            throw new UserInputError(`Message images exceed limit of ${AfterSalesService.MESSAGE_MAX_IMAGES}`);
        }
        const senderName = await this.resolveSenderName(ctx, senderType);
        const msgRepo = this.connection.getRepository(ctx, AfterSalesMessage);
        const message = await msgRepo.save(
            new AfterSalesMessage({
                requestId: Number(requestId),
                senderType,
                senderUserId: Number(ctx.activeUserId),
                senderName,
                content: trimmed,
                images: imgs.length ? imgs : null,
            }),
        );
        Logger.info(
            `After-sales message added: request=${requestId} sender=${senderType} user=${ctx.activeUserId}`,
            loggerCtx,
        );
        // 顾客留言 → 商家站内信提醒（notification-plugin 订阅；未装时事件无人消费，仅不提醒）
        if (senderType === 'customer' && this.eventBus) {
            try {
                this.eventBus.publish(new AfterSalesMerchantNotifyEvent(
                    ctx,
                    Number(requestId),
                    '售后有新留言',
                    `顾客在售后单（订单 ${request.orderId}）发来新留言，请及时回复。`,
                ));
            } catch (e: any) {
                Logger.warn(`publish AfterSalesMerchantNotifyEvent failed for #${requestId}: ${e?.message ?? e}`, loggerCtx);
            }
        }
        return message;
    }

    /** 发送人显示名：管理员取 Administrator、顾客取 Customer（姓名拼接），失败兜底 'user' */
    private async resolveSenderName(ctx: RequestContext, senderType: AfterSalesMessageSenderType): Promise<string> {
        if (!ctx.activeUserId) return 'user';
        try {
            if (senderType === 'admin') {
                const adminRepo = this.connection.getRepository(ctx, Administrator);
                const admin = await adminRepo.findOne({
                    where: { user: { id: ctx.activeUserId as any } } as any,
                    relations: { user: true },
                });
                if (admin) return `${admin.firstName} ${admin.lastName}`.trim();
            } else if (this.customerService) {
                const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
                if (customer) return `${customer.firstName} ${customer.lastName}`.trim();
            }
        } catch (e: any) {
            Logger.warn(`resolveSenderName failed: ${e?.message ?? e}`, loggerCtx);
        }
        return 'user';
    }

    /**
     * 售后单留言列表（createdAt 正序，skip/take 常规分页）。
     * senderType=customer 时校验售后单归属当前顾客，防止越权读他人留言。
     */
    async listMessages(
        ctx: RequestContext,
        requestId: ID,
        senderType: AfterSalesMessageSenderType,
        options?: { skip?: number; take?: number },
    ): Promise<PaginatedList<AfterSalesMessage>> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: requestId as any } });
        if (!request) throw new UserInputError(`After-sales request ${requestId} not found`);
        if (senderType === 'customer') {
            const customerId = await this.resolveCustomerId(ctx);
            if (!customerId || Number(request.customerId) !== customerId) {
                throw new ForbiddenError();
            }
        }
        const msgRepo = this.connection.getRepository(ctx, AfterSalesMessage);
        const take = Math.min(Math.max(options?.take ?? 50, 1), 100);
        const skip = Math.max(options?.skip ?? 0, 0);
        const [items, totalItems] = await msgRepo.findAndCount({
            where: { requestId: Number(requestId) },
            order: { createdAt: 'ASC' },
            skip,
            take,
        });
        return { items, totalItems };
    }

    /** 批量统计各售后单留言条数并附加到 messageCount 非持久化属性 */
    private async attachMessageCounts(ctx: RequestContext, requests: AfterSalesRequest[]): Promise<void> {
        if (!requests.length) return;
        const ids = requests.map((r) => Number(r.id));
        const msgRepo = this.connection.getRepository(ctx, AfterSalesMessage);
        const rows = await msgRepo
            .createQueryBuilder('m')
            .select('m.requestId', 'requestId')
            .addSelect('COUNT(*)', 'count')
            .where('m.requestId IN (:...ids)', { ids })
            .groupBy('m.requestId')
            .getRawMany<{ requestId: number; count: string }>();
        const map = new Map(rows.map((r) => [Number(r.requestId), Number(r.count)]));
        for (const r of requests) {
            r.messageCount = map.get(Number(r.id)) ?? 0;
        }
    }

    // ===== 换货闭环（迭代三期） =====

    /** 换货发货（admin）：Received → ExchangeShipped，仅 exchange 类型、仅 Received 状态可走 */
    async exchangeShip(ctx: RequestContext, id: ID, trackingNo: string, carrier: string): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new UserInputError(`After-sales request ${id} not found`);
        if (request.type !== 'exchange') {
            throw new UserInputError('Only exchange requests can be exchange-shipped');
        }
        if (request.state !== 'Received') {
            throw new UserInputError(`Cannot exchange-ship from state: ${request.state}`);
        }
        request.exchangeTrackingNo = trackingNo;
        request.exchangeCarrier = carrier;
        // commitState 统一出口：落历史 + 发布事件（顾客收「换货已发货」站内信）
        return this.commitState(ctx, request, 'Received', 'ExchangeShipped');
    }

    /** 换货确认收货（shop 顾客）：ExchangeShipped → Closed，需校验售后单归属 */
    async exchangeReceive(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repo = this.connection.getRepository(ctx, AfterSalesRequest);
        const request = await repo.findOne({ where: { id: id as any } });
        if (!request) throw new UserInputError(`After-sales request ${id} not found`);
        const customerId = await this.resolveCustomerId(ctx);
        if (!customerId || Number(request.customerId) !== customerId) {
            throw new ForbiddenError();
        }
        if (request.state !== 'ExchangeShipped') {
            throw new UserInputError(`Cannot exchange-receive from state: ${request.state}`);
        }
        // commitState 统一出口：fromState=ExchangeShipped 的 Closed 事件驱动「换货完成」站内信
        return this.commitState(ctx, request, 'ExchangeShipped', 'Closed');
    }
}
