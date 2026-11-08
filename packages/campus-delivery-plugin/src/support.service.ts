import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Customer,
    CustomerService,
    ForbiddenError,
    ID,
    Injector,
    Logger,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AfterSalesRequest, AfterSalesService } from '@vendure/after-sales-plugin';
import { In, Not } from 'typeorm';
import { CampusRiderAppeal, CampusBlacklist, CampusSupportTicket } from './support.entities';
import { RiderCreditService } from './rider-credit.service';
import { FeishuNotifyService, FeishuPushTarget } from './feishu/feishu-notify.service';
import { PrivacyNumberService } from './privacy-number.service';
import { dutyAssigneeAt, DutyEntry } from './after-sales-duty';

const loggerCtx = 'CampusSupport';

export const TICKET_CATEGORIES = ['order', 'delivery', 'refund', 'invoice', 'other'];
export const TICKET_STATUSES = ['open', 'replied', 'closed'];
/** 工单来源：顾客提交 / 外部运单异常自动建单 */
export const TICKET_SOURCES = ['customer', 'third_party_exception', 'refund_retry_exhausted'];
export const APPEAL_STATUSES = ['pending', 'approved', 'rejected'];
const MAX_CONTENT = 500;
const MAX_REPLY = 500;
const MAX_IMAGES = 6;
const MAX_TAKE = 200;

function clampSkip(v?: number) {
    return Math.max(0, Number(v ?? 0) || 0);
}
function clampTake(v?: number) {
    const n = Number(v ?? 50) || 50;
    return Math.min(Math.max(n, 1), MAX_TAKE);
}
function normalizeImages(images?: string[] | null): string[] {
    const list = (images ?? []).map(v => String(v ?? '').trim()).filter(Boolean);
    if (list.length > MAX_IMAGES) throw new UserInputError(`最多上传 ${MAX_IMAGES} 张图片`);
    return list;
}

/**
 * 客服工单 + 骑手申诉 + 下单黑名单（站内留言制，非实时 IM）。
 * C 端（shop-api）只操作自己的记录；后台（admin-api）按当前渠道隔离处理。
 */
@Injectable()
export class SupportService {
    /** 售后插件为可选依赖：未安装时工单仍可用，仅“工单↔售后”联动降级 */
    private afterSalesSvc?: AfterSalesService | null;

    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private credit: RiderCreditService,
        private feishu: FeishuNotifyService,
        private moduleRef?: ModuleRef,
        /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响工单主流程 */
        private privacy?: PrivacyNumberService,
    ) {}

    /** 展示号转换器：启用号码保护时脱敏，未启用/依赖缺失时退回原文 */
    private async phoneDisplayer(ctx: RequestContext): Promise<(p: string | null | undefined) => string | null> {
        if (this.privacy) return this.privacy.displayer(ctx, ctx.channelId);
        return p => {
            const raw = String(p ?? '').trim();
            return raw || null;
        };
    }

    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private getAfterSales(): AfterSalesService | null {
        if (this.afterSalesSvc !== undefined) return this.afterSalesSvc ?? null;
        try {
            this.afterSalesSvc = this.moduleRef ? new Injector(this.moduleRef).get(AfterSalesService) : null;
        } catch (e: any) {
            this.afterSalesSvc = null;
            Logger.warn(`AfterSalesService 不可用，工单与售后联动降级: ${e?.message ?? e}`, loggerCtx);
        }
        return this.afterSalesSvc ?? null;
    }

    private async requireCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new ForbiddenError();
        return customer;
    }

    /** 飞书提醒：仅记录日志、绝不阻塞主流程（未启用时 pushEvent 直接返回 true） */
    private async pushFeishu(
        scene: string,
        title: string,
        content: string,
        orderCode?: string | null,
        dedupeKey?: string,
        target?: FeishuPushTarget,
    ): Promise<void> {
        try {
            await this.feishu.pushEvent(scene, title, content, orderCode ?? undefined, dedupeKey, target);
        } catch (e: any) {
            Logger.warn(`飞书提醒失败 scene=${scene}: ${e?.message ?? e}`, loggerCtx);
        }
    }

    /**
     * 站内信：复用 message-plugin 的 Message/MessageDelivery（invoice-plugin / coupon-plugin 已落地范式）；
     * 未装 message-plugin 时实体不存在，静默跳过，绝不阻塞工单/申诉主流程。
     */
    private async sendInAppMessage(ctx: RequestContext, customerId: ID, title: string, body: string): Promise<void> {
        try {
            const msgRepo = this.connection.getRepository(ctx, 'Message' as any);
            const deliveryRepo = this.connection.getRepository(ctx, 'MessageDelivery' as any);
            const message = await msgRepo.save(
                msgRepo.create({
                    title,
                    body,
                    deliveryChannel: 'inapp',
                    audienceType: 'all',
                    status: 'sent',
                    totalTarget: 1,
                    totalSent: 1,
                    channels: [ctx.channel],
                }),
            );
            await deliveryRepo.save(
                deliveryRepo.create({
                    messageId: message.id,
                    customerId: Number(customerId),
                    deliveryStatus: 'sent',
                    channels: [ctx.channel],
                }),
            );
        } catch (e: any) {
            Logger.warn(`站内信发送失败 customer=${customerId}: ${e?.message ?? e}`, loggerCtx);
        }
    }

    // ---------------- 客服工单 ----------------

    /**
     * 工单→售后打通：按订单号解析订单（校验归属与本店渠道）并挂接该订单在途售后单。
     * 订单号解析不到时保持宽松（工单仍可提交，仅不关联），避免顾客写错一位订单号就投诉无门；
     * 但订单存在且不属于本人时明确拒绝，防止工单被挂到他人订单上造成误处理。
     */
    private async resolveOrderLink(
        ctx: RequestContext,
        customerId: ID,
        orderCode: string | null,
    ): Promise<{ orderId: number | null; afterSalesRequestId: number | null }> {
        if (!orderCode) return { orderId: null, afterSalesRequestId: null };
        let order: any = null;
        try {
            order = await this.connection.getRepository(ctx, Order).findOne({
                where: { code: orderCode as any },
                relations: ['customer', 'channels'] as any,
            });
        } catch (e: any) {
            Logger.warn(`工单关联订单解析失败 code=${orderCode}: ${e?.message ?? e}`, loggerCtx);
            return { orderId: null, afterSalesRequestId: null };
        }
        if (!order) return { orderId: null, afterSalesRequestId: null };
        const channelIds = Array.isArray(order.channels) ? order.channels.map((c: any) => Number(c.id)) : [];
        const owned = order.customer != null && String(order.customer.id) === String(customerId);
        if (!owned || (channelIds.length > 0 && !channelIds.includes(Number(ctx.channelId)))) {
            throw new UserInputError('订单号不存在或不属于本人');
        }
        return {
            orderId: Number(order.id),
            afterSalesRequestId: await this.findActiveAfterSalesId(ctx, Number(order.id)),
        };
    }

    /** 该订单最新一条未关闭售后单（未装售后插件/实体未注册时返回 null，绝不阻断工单） */
    private async findActiveAfterSalesId(ctx: RequestContext, orderId: number): Promise<number | null> {
        try {
            const row = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
                where: { orderId: orderId as any, state: Not('Closed') as any },
                order: { id: 'DESC' } as any,
            });
            return row ? Number(row.id) : null;
        } catch (e: any) {
            Logger.warn(`售后单关联查询失败 order=${orderId}: ${e?.message ?? e}`, loggerCtx);
            return null;
        }
    }

    /** 批量取售后单摘要（工单列表回显用）：按工单已关联 id ∪ 订单号反查，返回 [售后单 id, 订单 id] 两级索引 */
    private async loadAfterSalesSummaries(
        ctx: RequestContext,
        tickets: CampusSupportTicket[],
    ): Promise<{ byId: Map<number, any>; latestByOrderId: Map<number, any> }> {
        const byId = new Map<number, any>();
        const latestByOrderId = new Map<number, any>();
        const ids = tickets.map(t => t.afterSalesRequestId).filter((v): v is number => v != null).map(Number);
        const orderIds = tickets.map(t => t.orderId).filter((v): v is number => v != null).map(Number);
        if (!ids.length && !orderIds.length) return { byId, latestByOrderId };
        try {
            const rows = await this.connection.getRepository(ctx, AfterSalesRequest).find({
                where: [
                    ...(ids.length ? [{ id: In(ids) }] : []),
                    ...(orderIds.length ? [{ orderId: In(orderIds) }] : []),
                ] as any,
                order: { id: 'DESC' } as any,
            });
            for (const row of rows) {
                byId.set(Number(row.id), row);
                const orderKey = Number(row.orderId);
                // rows 按 id 倒序：首次出现即该订单最新一单
                if (!latestByOrderId.has(orderKey)) latestByOrderId.set(orderKey, row);
            }
        } catch (e: any) {
            Logger.warn(`售后单批量查询失败: ${e?.message ?? e}`, loggerCtx);
        }
        return { byId, latestByOrderId };
    }

    private static afterSalesView(row: any | null | undefined) {
        if (!row) {
            return {
                afterSalesRequestId: null,
                afterSalesState: null,
                afterSalesType: null,
                afterSalesRefundAmount: null,
                afterSalesActualRefundAmount: null,
            };
        }
        return {
            afterSalesRequestId: Number(row.id),
            afterSalesState: row.state ?? null,
            afterSalesType: row.type ?? null,
            afterSalesRefundAmount: row.refundAmount == null ? null : Number(row.refundAmount),
            afterSalesActualRefundAmount:
                row.actualRefundAmount == null ? null : Number(row.actualRefundAmount),
        };
    }

    async createTicket(
        ctx: RequestContext,
        input: { category: string; content: string; images?: string[] | null; orderCode?: string | null },
    ) {
        const customer = await this.requireCustomer(ctx);
        const category = String(input.category ?? '');
        if (!TICKET_CATEGORIES.includes(category)) throw new UserInputError('工单类型不合法');
        const content = String(input.content ?? '').trim();
        if (!content) throw new UserInputError('请填写问题描述');
        if (content.length > MAX_CONTENT) throw new UserInputError(`问题描述不能超过 ${MAX_CONTENT} 个字符`);
        const orderCode = input.orderCode == null ? null : String(input.orderCode).trim() || null;
        const { orderId, afterSalesRequestId } = await this.resolveOrderLink(ctx, customer.id, orderCode);
        const ticket = await this.connection.getRepository(ctx, CampusSupportTicket).save({
            channelId: ctx.channelId,
            customerId: customer.id,
            orderCode,
            orderId,
            afterSalesRequestId,
            category,
            content,
            images: normalizeImages(input.images),
            status: 'open',
            source: 'customer',
            dedupeKey: null,
        } as any);
        // 运营提醒：新工单推当前店铺群（channel 定向；平台群始终接收），无群也不影响提交
        const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '-';
        // H2：飞书群消息会长期留存，顾客号码按号码保护口径脱敏
        const display = await this.phoneDisplayer(ctx);
        const phoneText = display(customer.phoneNumber);
        void this.pushFeishu(
            'support_ticket',
            '新客服工单',
            [
                `类型：${category}`,
                orderCode ? `订单：${orderCode}` : '',
                afterSalesRequestId
                    ? `售后单：#${afterSalesRequestId}（已自动关联）`
                    : category === 'refund'
                        ? '售后单：未关联（顾客尚未发起售后申请）'
                        : '',
                `顾客：${name}${phoneText ? `（${phoneText}）` : ''}`,
                `内容：${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`,
            ].filter(Boolean).join('\n'),
            orderCode,
            `ticket:${ticket.id}`,
            { channel: ctx.channel?.code },
        );
        // 自动关联成功时回显真实售后摘要（状态/金额），避免建单响应显示空状态
        const summary = afterSalesRequestId == null
            ? null
            : (await this.loadAfterSalesSummaries(ctx, [ticket])).byId.get(Number(afterSalesRequestId)) ?? null;
        return { ...ticket, ...SupportService.afterSalesView(summary) };
    }

    /**
     * R7 系统工单（外部运单异常等）：不依赖顾客登录态，幂等键保证同一异常只建一张。
     * 返回已存在/新建的工单 id，调用方据此在告警文案中带上工单号。
     */
    async createSystemTicket(
        ctx: RequestContext,
        input: {
            /** 工单幂等键（source + 单号 + 外部运单号），重复调用不会再建单 */
            dedupeKey: string;
            orderCode: string;
            orderId: number | null;
            category: string;
            source: string;
            content: string;
            channelId?: ID;
        },
    ): Promise<{ id: number | null; created: boolean }> {
        const repo = this.connection.getRepository(ctx, CampusSupportTicket);
        const existing = await repo.findOne({ where: { dedupeKey: input.dedupeKey } as any });
        if (existing) return { id: Number(existing.id), created: false };
        const channelId = input.channelId ?? ctx.channelId;
        // G3 自动指派值班：系统工单按本店「售后值班表」落到当班管理员，飞书文案带上值班人
        const duty = await this.resolveDutyAssignee(channelId);
        try {
            const ticket = await repo.save({
                channelId,
                customerId: null,
                orderCode: input.orderCode,
                orderId: input.orderId,
                afterSalesRequestId: null,
                category: input.category,
                content: input.content.slice(0, MAX_CONTENT),
                images: null,
                status: 'open',
                source: input.source,
                dedupeKey: input.dedupeKey,
                assigneeId: duty?.id ?? null,
            } as any);
            const dutyLine = duty ? `值班：${duty.name ?? duty.id}` : '值班：未排班（请人工认领）';
            void this.pushFeishu(
                'support_ticket',
                '系统工单：外部运单异常',
                [
                    `订单：${input.orderCode}`,
                    `来源：${input.source}`,
                    dutyLine,
                    `内容：${input.content.slice(0, 160)}`,
                ].join('\n'),
                input.orderCode,
                `ticket:${ticket.id}`,
            );
            return { id: Number(ticket.id), created: true };
        } catch (e: any) {
            // 并发下唯一索引冲突：视为已存在，回查返回，不阻断调度
            const again = await repo.findOne({ where: { dedupeKey: input.dedupeKey } as any });
            if (!again) Logger.warn(`系统工单建单失败：${e?.message ?? e}`, loggerCtx);
            return { id: again ? Number(again.id) : null, created: false };
        }
    }

    /** 当前值班人（§100 值班排班；表不存在/查询失败按无人值班处理，不阻断建单） */
    private async resolveDutyAssignee(channelId: ID): Promise<{ id: number; name: string | null } | null> {
        try {
            const rows: any = await this.connection.rawConnection.query(
                `SELECT d.weekday, d."startMin", d."endMin", d."userId",
                        TRIM(COALESCE(ad."firstName", '') || COALESCE(ad."lastName", '')) AS "userName"
                   FROM campus_after_sales_duty d
                   LEFT JOIN administrator ad ON ad."userId" = d."userId"
                  WHERE d."channelId" = $1`,
                [Number(channelId)],
            );
            const list: any[] = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : Array.isArray(rows) ? rows : [];
            if (!list.length) return null;
            const entries: DutyEntry[] = list.map(r => ({
                weekday: Number(r.weekday),
                startMin: Number(r.startMin),
                endMin: Number(r.endMin),
                userId: Number(r.userId),
            }));
            const uid = dutyAssigneeAt(entries, Date.now());
            if (!uid) return null;
            const name = list.find(r => Number(r.userId) === uid)?.userName;
            return { id: uid, name: name ? String(name).trim() || null : null };
        } catch (e: any) {
            Logger.debug?.(`读取值班表失败：${e?.message ?? e}`, loggerCtx);
            return null;
        }
    }

    async myTickets(ctx: RequestContext, skip?: number, take?: number) {
        const customer = await this.requireCustomer(ctx);
        const items = await this.connection.getRepository(ctx, CampusSupportTicket).find({
            where: { customerId: customer.id as any, channelId: ctx.channelId as any },
            order: { createdAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take),
        });
        if (!items.length) return items;
        // 售后进度回显：顾客在工单列表即可看到关联售后单当前状态，不必跳转售后中心
        const { byId, latestByOrderId } = await this.loadAfterSalesSummaries(ctx, items);
        return items.map(t =>
            this.withAfterSalesView(
                t,
                byId.get(Number(t.afterSalesRequestId)) ??
                    (t.orderId != null ? latestByOrderId.get(Number(t.orderId)) : null),
            ),
        );
    }

    /** 工单行 + 售后摘要（无关联时各字段为 null） */
    private withAfterSalesView(ticket: CampusSupportTicket, row: any | null | undefined) {
        return {
            ...ticket,
            ...SupportService.afterSalesView(row),
            // 无显式关联但按订单反查到售后单时，回显解析出的 id，便于前端跳转
            afterSalesRequestId: ticket.afterSalesRequestId ?? (row ? Number(row.id) : null),
        };
    }

    async adminTickets(
        ctx: RequestContext,
        status?: string,
        skip?: number,
        take?: number,
        source?: string,
        assigneeId?: ID,
    ) {
        const where: Record<string, unknown> = { channelId: ctx.channelId };
        if (status) {
            if (!TICKET_STATUSES.includes(status)) throw new UserInputError('工单状态不合法');
            where.status = status;
        }
        if (source) {
            if (!TICKET_SOURCES.includes(source)) throw new UserInputError('工单来源不合法');
            where.source = source;
        }
        // G3 系统工单自动指派：运营可按值班人过滤（只看「我的工单」）
        if (assigneeId != null) {
            const id = Number(assigneeId);
            if (!Number.isInteger(id) || id <= 0) throw new UserInputError('值班人 id 不合法');
            where.assigneeId = id;
        }
        const [items, total] = await this.connection.getRepository(ctx, CampusSupportTicket).findAndCount({
            where: where as any,
            order: { createdAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take),
        });
        const customerIds = items.map(i => i.customerId).filter((id): id is number => id != null);
        const customers = customerIds.length
            ? await this.connection.getRepository(ctx, Customer).findByIds(customerIds.map(String) as any)
            : [];
        const byId = new Map(customers.map(c => [String(c.id), c]));
        // 工单与售后打通：列表直接回显关联售后单状态/金额，运营无需另开售后列表对照
        const { byId: asById, latestByOrderId } = await this.loadAfterSalesSummaries(ctx, items);
        // H2：后台工单列表顾客号码按号码保护口径展示
        const display = await this.phoneDisplayer(ctx);
        return {
            items: items.map(t => {
                const c = byId.get(String(t.customerId));
                const view = this.withAfterSalesView(
                    t,
                    asById.get(Number(t.afterSalesRequestId)) ??
                        (t.orderId != null ? latestByOrderId.get(Number(t.orderId)) : null),
                );
                return {
                    ...view,
                    customerName: [c?.firstName, c?.lastName].filter(Boolean).join(' ') || '-',
                    customerPhone: display(c?.phoneNumber),
                };
            }),
            total,
        };
    }

    /**
     * 运营手工关联售后单（建单自动关联未命中时使用，如售后单在工单之后才发起）。
     * 校验同一店铺、同一订单，防止把工单挂到无关售后单。
     */
    async linkTicketAfterSales(ctx: RequestContext, id: ID, afterSalesRequestId: ID) {
        const ticket = await this.connection.getRepository(ctx, CampusSupportTicket).findOne({
            where: { id: id as any, channelId: ctx.channelId as any },
        });
        if (!ticket) throw new UserInputError('工单不存在或不属于当前店铺');
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id: (Number(afterSalesRequestId) || afterSalesRequestId) as any },
            relations: ['channels'] as any,
        });
        if (!request) throw new UserInputError('售后单不存在');
        const channelIds = Array.isArray(request.channels) ? request.channels.map(c => Number(c.id)) : [];
        if (channelIds.length && !channelIds.includes(Number(ctx.channelId))) {
            throw new UserInputError('售后单不属于当前店铺');
        }
        // 顾客一致性：工单无订单号时无法靠订单比对，必须校验售后单归属顾客，
        // 否则可把顾客 A 的工单挂到同店铺顾客 B 的售后单，A 的工单列表会回显 B 的退款信息。
        if (ticket.customerId != null && request.customerId != null
            && Number(request.customerId) !== Number(ticket.customerId)) {
            throw new UserInputError('售后单与工单不属于同一顾客');
        }
        if (ticket.orderId != null && Number(ticket.orderId) !== Number(request.orderId)) {
            throw new UserInputError('售后单与工单关联订单不一致');
        }
        await this.connection.getRepository(ctx, CampusSupportTicket).update(ticket.id, {
            afterSalesRequestId: Number(request.id),
            // 工单未关联订单时以售后单订单补齐，便于列表按订单追溯
            orderId: ticket.orderId ?? Number(request.orderId),
        } as any);
        return this.withAfterSalesView(
            {
                ...ticket,
                orderId: ticket.orderId ?? Number(request.orderId),
                afterSalesRequestId: Number(request.id),
            } as any,
            request,
        );
    }

    /**
     * 售后状态联动：售后单退款到账后自动关闭关联工单（回复留痕），
     * 避免工单长期 open、运营重复联系顾客。仅处理 Refunded，其余状态工单保持原状交给运营跟。
     */
    async onAfterSalesStateChange(ctx: RequestContext, requestId: number, toState: string): Promise<void> {
        if (toState !== 'Refunded') return;
        try {
            const repo = this.connection.getRepository(ctx, CampusSupportTicket);
            const open = await repo.find({
                where: { afterSalesRequestId: requestId as any, status: Not('closed') as any },
            });
            for (const t of open) {
                const note = '售后退款已到账，工单自动关闭';
                await repo.update(t.id, {
                    status: 'closed',
                    reply: t.reply ? `${t.reply}；${note}` : note,
                    repliedBy: 'system',
                    repliedAt: new Date(),
                } as any);
            }
        } catch (e: any) {
            Logger.warn(`工单售后联动关单失败 request=${requestId}: ${e?.message ?? e}`, loggerCtx);
        }
    }

    /** 运营回复（replied）/ 关闭（closed）；回复内容必填（关闭时可选沿用原回复） */
    async replyTicket(ctx: RequestContext, id: ID, reply: string | undefined, status?: string) {
        const target = String(status ?? 'replied');
        if (!['replied', 'closed'].includes(target)) throw new UserInputError('工单状态不合法');
        const ticket = await this.connection.getRepository(ctx, CampusSupportTicket).findOne({
            where: { id: id as any, channelId: ctx.channelId as any },
        });
        if (!ticket) throw new UserInputError('工单不存在或不属于当前店铺');
        const text = String(reply ?? '').trim();
        if (target === 'replied' && !text) throw new UserInputError('请填写回复内容');
        if (text.length > MAX_REPLY) throw new UserInputError(`回复不能超过 ${MAX_REPLY} 个字符`);
        await this.connection.getRepository(ctx, CampusSupportTicket).update(ticket.id, {
            status: target,
            reply: text || ticket.reply,
            repliedBy: String(ctx.activeUserId ?? ''),
            repliedAt: new Date(),
        } as any);
        const title = target === 'closed' ? '客服工单已关闭' : '客服工单已回复';
        const body = target === 'closed'
            ? `工单 #${ticket.id} 已关闭${text ? `：${text}` : ''}`
            : `工单 #${ticket.id} 回复：${text}`;
        // 站内信：回复/关闭都通知顾客（C 端消息中心红点）；系统工单无顾客时跳过
        if (ticket.customerId != null) {
            await this.sendInAppMessage(ctx, ticket.customerId, title, body);
        }
        // R7 关闭联动：外部运单异常工单关闭 → 回写订单已处置标记，调度不再重复告警
        if (target === 'closed' && ticket.source === 'third_party_exception' && ticket.orderId != null) {
            try {
                await this.connection.getRepository(ctx, Order).update(ticket.orderId, {
                    customFields: { exceptionResolvedAt: new Date() },
                    campusCause: 'third_party_exception_resolved',
                } as any);
            } catch (e: any) {
                Logger.warn(`工单关闭回写订单异常已处置失败 order=${ticket.orderId}: ${e?.message ?? e}`, loggerCtx);
            }
        }
        // 工单与售后打通：已关联售后单时，回复同时写入售后协商留言，顾客在售后单里也能看到同一结论
        if (ticket.afterSalesRequestId != null) {
            await this.forwardReplyToAfterSales(ctx, Number(ticket.afterSalesRequestId), text || body);
        }
        return { ...ticket, status: target, reply: text || ticket.reply };
    }

    /** 回复同步到售后协商留言（售后单已关闭/插件未装时仅告警，不影响工单处理） */
    private async forwardReplyToAfterSales(ctx: RequestContext, requestId: number, content: string): Promise<void> {
        const svc = this.getAfterSales();
        if (!svc) return;
        try {
            await svc.addMessage(ctx, requestId as any, 'admin', content.slice(0, 1000));
        } catch (e: any) {
            Logger.warn(`工单回复同步售后留言失败 request=${requestId}: ${e?.message ?? e}`, loggerCtx);
        }
    }

    // ---------------- 骑手申诉 ----------------

    async createAppeal(
        ctx: RequestContext,
        input: { orderId?: ID | null; reason: string; images?: string[] | null },
    ) {
        const customer = await this.requireCustomer(ctx);
        if (String((customer.customFields as any)?.riderStatus ?? '') !== 'approved') throw new ForbiddenError();
        const reason = String(input.reason ?? '').trim();
        if (!reason) throw new UserInputError('请填写申诉理由');
        if (reason.length > MAX_CONTENT) throw new UserInputError(`申诉理由不能超过 ${MAX_CONTENT} 个字符`);
        let orderId: number | null = null;
        let orderCode: string | null = null;
        if (input.orderId != null && input.orderId !== '') {
            const order = await this.connection.getRepository(ctx, Order).findOne({
                where: { id: input.orderId as any },
            });
            // 只允许对本人配送过的订单申诉（防越权查看/关联他人订单）
            if (!order || String((order.customFields as any)?.deliveryStaffId ?? '') !== String(customer.id)) {
                throw new UserInputError('订单不存在或不属于本人配送');
            }
            orderId = Number(order.id);
            orderCode = order.code;
        }
        const pending = await this.connection.getRepository(ctx, CampusRiderAppeal).findOne({
            where: { riderCustomerId: customer.id as any, status: 'pending' as any },
        });
        if (pending) throw new UserInputError('已有待审核的申诉，请等待处理');
        const appeal = await this.connection.getRepository(ctx, CampusRiderAppeal).save({
            channelId: ctx.channelId,
            riderCustomerId: customer.id,
            orderId,
            orderCode,
            reason,
            images: normalizeImages(input.images),
            status: 'pending',
            creditDelta: 0,
        } as any);
        // 运营提醒：新申诉推当前店铺群 + 平台群，后台「运营中心」待办
        const riderName = (customer.customFields as any)?.riderRealName ?? customer.firstName ?? '-';
        void this.pushFeishu(
            'rider_appeal',
            '新骑手申诉',
            [
                `骑手：${riderName}${customer.phoneNumber ? `（${customer.phoneNumber}）` : ''}`,
                orderCode ? `订单：${orderCode}` : '订单：未关联',
                `理由：${reason.slice(0, 120)}${reason.length > 120 ? '…' : ''}`,
            ].join('\n'),
            orderCode,
            `appeal:${appeal.id}`,
            { channel: ctx.channel?.code },
        );
        return appeal;
    }

    async myAppeals(ctx: RequestContext, skip?: number, take?: number) {
        const customer = await this.requireCustomer(ctx);
        return this.connection.getRepository(ctx, CampusRiderAppeal).find({
            where: { riderCustomerId: customer.id as any, channelId: ctx.channelId as any },
            order: { createdAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take),
        });
    }

    async adminAppeals(ctx: RequestContext, status?: string, skip?: number, take?: number) {
        const where: Record<string, unknown> = { channelId: ctx.channelId };
        if (status) {
            if (!APPEAL_STATUSES.includes(status)) throw new UserInputError('申诉状态不合法');
            where.status = status;
        }
        const [items, total] = await this.connection.getRepository(ctx, CampusRiderAppeal).findAndCount({
            where: where as any,
            order: { createdAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take),
        });
        const customers = items.length
            ? await this.connection.getRepository(ctx, Customer).findByIds(items.map(i => String(i.riderCustomerId)) as any)
            : [];
        const byId = new Map(customers.map(c => [String(c.id), c]));
        return {
            items: items.map(a => {
                const c = byId.get(String(a.riderCustomerId));
                return {
                    ...a,
                    riderName: (c?.customFields as any)?.riderRealName ?? c?.firstName ?? '-',
                    riderPhone: c?.phoneNumber ?? null,
                };
            }),
            total,
        };
    }

    /** 审核申诉：通过则按 creditDelta 回补信用分（默认 10），拒绝不回补 */
    async reviewAppeal(
        ctx: RequestContext,
        id: ID,
        approve: boolean,
        creditDelta?: number | null,
        note?: string | null,
    ) {
        const appeal = await this.connection.getRepository(ctx, CampusRiderAppeal).findOne({
            where: { id: id as any, channelId: ctx.channelId as any },
        });
        if (!appeal) throw new UserInputError('申诉不存在或不属于当前店铺');
        if (appeal.status !== 'pending') throw new UserInputError('该申诉已处理');
        const delta = approve ? Math.min(20, Math.max(1, Number(creditDelta ?? 10) || 10)) : 0;
        await this.connection.getRepository(ctx, CampusRiderAppeal).update(appeal.id, {
            status: approve ? 'approved' : 'rejected',
            creditDelta: delta,
            reviewNote: String(note ?? '').trim() || null,
            reviewedBy: String(ctx.activeUserId ?? ''),
            reviewedAt: new Date(),
        } as any);
        if (delta > 0) {
            await this.credit.adjust(ctx, appeal.riderCustomerId as any, delta, 'appeal_approved', appeal.orderId ?? undefined);
        }
        // 站内信：审核结果通知骑手（C 端消息中心红点）
        const noteText = String(note ?? '').trim();
        await this.sendInAppMessage(
            ctx,
            appeal.riderCustomerId,
            approve ? '骑手申诉已通过' : '骑手申诉未通过',
            approve
                ? `申诉已通过${appeal.orderCode ? `（订单 ${appeal.orderCode}）` : ''}，信用分 +${delta}${noteText ? `；说明：${noteText}` : ''}`
                : `申诉未通过${appeal.orderCode ? `（订单 ${appeal.orderCode}）` : ''}，信用分不变${noteText ? `；说明：${noteText}` : ''}`,
        );
        return { ...appeal, status: approve ? 'approved' : 'rejected', creditDelta: delta };
    }

    // ---------------- 黑名单 ----------------

    async listBlacklist(ctx: RequestContext, skip?: number, take?: number) {
        const [items, total] = await this.connection.getRepository(ctx, CampusBlacklist).findAndCount({
            where: { channelId: ctx.channelId as any },
            order: { createdAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take),
        });
        return { items, total };
    }

    async addBlacklist(ctx: RequestContext, input: { type: string; value: string; reason?: string | null }) {
        const type = String(input.type ?? '');
        if (!['user', 'phone'].includes(type)) throw new UserInputError('黑名单类型不合法');
        const raw = String(input.value ?? '').trim();
        if (!raw) throw new UserInputError('请填写用户 ID 或手机号');
        let customerId: number | null = null;
        let phone: string | null = null;
        if (type === 'user') {
            customerId = Number(raw);
            if (!Number.isFinite(customerId) || customerId <= 0) throw new UserInputError('用户 ID 不合法');
            const inChannel = await this.connection.getRepository(ctx, Customer).createQueryBuilder('customer')
                .leftJoin('customer.channels', 'channel')
                .where('customer.id = :id', { id: customerId })
                .andWhere('channel.id = :ch', { ch: ctx.channelId as any })
                .getOne();
            if (!inChannel) throw new UserInputError('用户不存在或不属于当前店铺');
        } else {
            phone = raw.replace(/[^\d+]/g, '');
            if (phone.length < 6 || phone.length > 20) throw new UserInputError('手机号不合法');
        }
        const exists = await this.connection.getRepository(ctx, CampusBlacklist).findOne({
            where: {
                channelId: ctx.channelId as any,
                type,
                ...(type === 'user' ? { customerId: customerId as any } : { phone: phone as any }),
            } as any,
        });
        if (exists) {
            if (exists.active) throw new UserInputError('该用户/手机号已在黑名单');
            await this.connection.getRepository(ctx, CampusBlacklist).update(exists.id, {
                active: true,
                reason: String(input.reason ?? '').trim() || null,
            } as any);
            return { ...exists, active: true };
        }
        return this.connection.getRepository(ctx, CampusBlacklist).save({
            channelId: ctx.channelId,
            type,
            customerId,
            phone,
            reason: String(input.reason ?? '').trim() || null,
            createdBy: String(ctx.activeUserId ?? ''),
            active: true,
        } as any);
    }

    /**
     * 批量导入黑名单（P3-2）：type=phone 时 values 为手机号列表；type=user 时为用户 ID 列表。
     * 去重后逐条入库；已存在且生效的计入 skipped，格式非法/不属于本店铺的计入 invalid。
     * 单次上限 500 条，避免一次性长事务。
     */
    async importBlacklist(
        ctx: RequestContext,
        type: string,
        values: string[],
        reason?: string | null,
    ): Promise<{ added: number; skipped: number; invalid: number }> {
        const t = String(type ?? '');
        if (!['user', 'phone'].includes(t)) throw new UserInputError('黑名单类型不合法');
        const raw = (values ?? []).map(v => String(v ?? '').trim()).filter(Boolean);
        if (!raw.length) throw new UserInputError('请粘贴要导入的用户 ID 或手机号');
        if (raw.length > 500) throw new UserInputError('单次最多导入 500 条');
        const lines = Array.from(new Set(raw));
        const reasonText = String(reason ?? '').trim() || '批量导入';
        const repo = this.connection.getRepository(ctx, CampusBlacklist);
        let added = 0;
        let skipped = 0;
        let invalid = 0;

        if (t === 'user') {
            const ids = lines.map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
            invalid += lines.length - ids.length;
            const valid = new Set<number>();
            if (ids.length) {
                const rows = await this.connection.getRepository(ctx, Customer).createQueryBuilder('customer')
                    .leftJoin('customer.channels', 'channel')
                    .where('customer.id IN (:...ids)', { ids })
                    .andWhere('channel.id = :ch', { ch: ctx.channelId as any })
                    .getMany();
                rows.forEach(r => valid.add(Number(r.id)));
            }
            invalid += ids.filter(id => !valid.has(id)).length;
            for (const customerId of valid) {
                const exists = await repo.findOne({
                    where: { channelId: ctx.channelId as any, type: 'user', customerId: customerId as any } as any,
                });
                if (exists?.active) { skipped += 1; continue; }
                if (exists) {
                    await repo.update(exists.id, { active: true, reason: reasonText } as any);
                } else {
                    await repo.save({
                        channelId: ctx.channelId,
                        type: 'user',
                        customerId,
                        phone: null,
                        reason: reasonText,
                        createdBy: String(ctx.activeUserId ?? ''),
                        active: true,
                    } as any);
                }
                added += 1;
            }
            return { added, skipped, invalid };
        }

        const phones = lines
            .map(v => v.replace(/[^\d+]/g, ''))
            .filter(p => p.length >= 6 && p.length <= 20);
        invalid += lines.length - phones.length;
        for (const phone of Array.from(new Set(phones))) {
            const exists = await repo.findOne({
                where: { channelId: ctx.channelId as any, type: 'phone', phone: phone as any } as any,
            });
            if (exists?.active) { skipped += 1; continue; }
            if (exists) {
                await repo.update(exists.id, { active: true, reason: reasonText } as any);
            } else {
                await repo.save({
                    channelId: ctx.channelId,
                    type: 'phone',
                    customerId: null,
                    phone,
                    reason: reasonText,
                    createdBy: String(ctx.activeUserId ?? ''),
                    active: true,
                } as any);
            }
            added += 1;
        }
        // phones 去重后与 lines 数量差异（重复行）不计 invalid，直接视为跳过
        skipped += Math.max(0, lines.length - invalid - phones.length - added - skipped);
        return { added, skipped, invalid };
    }

    async removeBlacklist(ctx: RequestContext, id: ID) {
        const row = await this.connection.getRepository(ctx, CampusBlacklist).findOne({
            where: { id: id as any, channelId: ctx.channelId as any },
        });
        if (!row) throw new UserInputError('记录不存在或不属于当前店铺');
        await this.connection.getRepository(ctx, CampusBlacklist).delete(row.id);
        return { ok: true };
    }
}
