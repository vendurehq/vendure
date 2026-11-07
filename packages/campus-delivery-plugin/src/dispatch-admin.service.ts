import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Customer,
    ID,
    Injector,
    Logger,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CapacityService } from './capacity.service';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusNotifyService } from './campus-notify.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { HallGrabService } from './hall-grab.service';
import { HallService, ACTIVE_HALL_STATUSES } from './hall.service';
import { refundablePayments, settleRefundOrMarkFailed } from './refund-payment';
import { withRefundLock } from './refund-lock';
import { CREDIT_LIMIT } from './rider-credit.service';

export type ExceptionAction = 'reassign' | 'handled' | 'refund_diff' | 'coupon' | 'refund_all';

/** 骑手在线窗口（与 CapacityService 心跳窗口 5min 对齐） */
const RIDER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** 处置完结 push 文案（公众号模板 thing 字段 ≤20 字符，均已核对） */
const EXCEPTION_NOTIFY_TEXT: Record<ExceptionAction, string> = {
    refund_diff: '异常已处理，差价原路退回',
    coupon: '异常已处理，补偿券已发放',
    refund_all: '订单已全额退款',
    reassign: '平台已重新安排配送',
    handled: '异常已协调处理',
};

export interface DispatchAlert {
    orderId: string;
    orderCode: string;
    type: 'stale_open' | 'sla_breach' | 'slot_full' | 'exception' | 'urged';
    detail: string;
    exceptionNote?: string | null; // 骑手上报说明（plan 3.4 处置卡展示）
    exceptionPhotos?: string[] | null; // 骑手存证照片
}

export interface DispatchRider {
    customerId: string;
    realName: string;
    credit: number;
}

export interface HandedException {
    orderId: string;
    orderCode: string;
    exceptionType: string | null;
    action: string;
    compensation: number | null;
    couponTemplateId: string | null;
    note: string | null;
    handledAt: string | null;
    handledBy: string;
}

/**
 * T3 调度看板 + 手动派单/改派（admin）。
 * board：按渠道拉取 hallStatus 非空订单，分类为大厅/进行中，产出四类告警
 * （stale_open / sla_breach / slot_full / exception）与在线骑手列表；
 * exception_final（已处置完结）不进墙，单独输出 handledOrders 留痕（plan 3.4）。
 * assign：手动强派（复用 grabByRider 事务+悲观锁原语，订单已不在大厅则抛错）。
 * backToHall：改派前置——先回大厅（清骑手指派字段），再由 admin 重新派单。
 * handleException（plan 3.4）：异常单三选一处置——重派回大厅 / 退差价 / 发补偿券 / 全额退单，
 * 全部动作写 exceptionAction* 记录字段留痕。
 */
@Injectable()
export class DispatchAdminService {
    private orderSvc?: OrderService;
    private couponSvc?: { grantCoupon: (ctx: RequestContext, templateId: ID, customerIds: ID[]) => Promise<string[]> } | null;
    private feishuSvc?: FeishuNotifyService | null;

    constructor(
        private connection: TransactionalConnection,
        private grab: HallGrabService,
        private hall: HallService,
        private capacity: CapacityService,
        private moduleRef: ModuleRef,
        private notify: CampusNotifyService,
    ) {}

    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private get injector(): Injector {
        return new Injector(this.moduleRef);
    }

    /** 飞书通知（可选依赖，测试/未启用时返回 null） */
    private getFeishu(): FeishuNotifyService | null {
        if (this.feishuSvc !== undefined) return this.feishuSvc ?? null;
        try {
            this.feishuSvc = this.injector.get(FeishuNotifyService) ?? null;
        } catch {
            this.feishuSvc = null;
        }
        return this.feishuSvc ?? null;
    }

    async board(ctx: RequestContext) {
        const cfg = await this.connection
            .getRepository(ctx, CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId as any } });
        // 渠道过滤：Order 无标量 channelId，join order.channels（同 core findOneInChannel 模式）。
        // customFields 为嵌入式物理列，QueryBuilder 必须用 embedded 路径 order.customFields.hallStatus。
        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId as any })
            .andWhere('order.customFields.hallStatus IS NOT NULL')
            .getMany();
        const now = Date.now();
        const alerts: DispatchAlert[] = [];
        const hallOrders: Order[] = [];
        const activeOrders: Order[] = [];
        const handled: Order[] = [];
        for (const o of orders) {
            const cf = o.customFields as any;
            if (cf.hallStatus === 'exception_final') {
                // 已处置完结（plan 3.4）：不进调度墙，进留痕列表。
                // 但若「已认领处置」却未写 exceptionHandledAt（赔付/留痕前宕机），必须继续告警让人工补处理，
                // 否则订单被静默吞掉（骑手异常上报无下文）。
                if (cf.deliveryStatus === 'exception' && !cf.exceptionHandledAt) {
                    alerts.push({
                        orderId: String(o.id),
                        orderCode: o.code,
                        type: 'exception',
                        detail: '异常处置未完成（已标记但未赔付/未留痕），请人工核对补处理',
                        exceptionNote: cf.exceptionNote ?? null,
                        exceptionPhotos: cf.exceptionPhotos ?? null,
                    });
                }
                handled.push(o);
                continue;
            }
            // 终态单不进墙：取消 / 无人接退款完结 / 已送达（含历史脏数据仅 deliveryStatus=delivered 的单）
            if (cf.hallStatus === 'cancelled' || cf.hallStatus === 'no_rider_final' || cf.hallStatus === 'delivered') continue;
            if (cf.deliveryStatus === 'delivered') continue;
            if (cf.hallStatus === 'scheduled') continue; // 预约单未放量，不进调度墙（商家工作台可见，plan 3.1）
            // 无人接单自动退款失败：非终态但也退出自动扫描，必须常驻告警等人工退款/取消，
            // 否则已付款未送达的单在大厅/商家台/调度墙同时消失（历史静默事故根因）
            if (cf.hallStatus === 'refund_failed') {
                alerts.push({
                    orderId: String(o.id),
                    orderCode: o.code,
                    type: 'exception',
                    detail: '无人接单自动退款失败，请人工退款/取消',
                });
                activeOrders.push(o);
                continue;
            }
            // 改址后原外部配送单未确认取消：旧运单仍会送到旧地址，必须常驻告警人工取消并按新址重推
            if (cf.campusCause === 'address_change_cancel_failed') {
                alerts.push({
                    orderId: String(o.id),
                    orderCode: o.code,
                    type: 'exception',
                    detail: '改址后原外部配送单未取消（仍会送至旧地址），请人工取消并按新址重推',
                });
            }
            if (cf.hallStatus === 'open') {
                hallOrders.push(o);
                if (cf.campusCause === 'slot_full') {
                    alerts.push({
                        orderId: String(o.id),
                        orderCode: o.code,
                        type: 'slot_full',
                        detail: '预约时段锁位失败（运力满），需人工跟进',
                    });
                }
                const enteredAt = cf.hallEnteredAt;
                if (enteredAt && now - new Date(enteredAt).getTime() > (cfg?.autoAssignMinutes ?? 10) * 60_000) {
                    alerts.push({
                        orderId: String(o.id),
                        orderCode: o.code,
                        type: 'stale_open',
                        detail: `大厅滞留超 ${cfg?.autoAssignMinutes ?? 10} 分钟，自动派单未完成`,
                    });
                }
            } else if (cf.deliveryStatus === 'in_progress') {
                activeOrders.push(o);
                const at = cf.pickedUpAt ?? cf.assignedAt ?? cf.hallEnteredAt;
                if (at && now - new Date(at).getTime() > (cfg?.inProgressSlaMinutes ?? 45) * 60_000) {
                    const over2x = now - new Date(at).getTime() > (cfg?.inProgressSlaMinutes ?? 45) * 2 * 60_000;
                    alerts.push({
                        orderId: String(o.id),
                        orderCode: o.code,
                        type: 'sla_breach',
                        detail: over2x
                            ? `配送超 2×SLA，已转人工介入（系统不再自动回收）`
                            : `配送超 SLA（>${cfg?.inProgressSlaMinutes ?? 45} 分钟）`,
                    });
                }
            } else if (cf.deliveryStatus === 'exception') {
                const reportedAt = cf.exceptionReportedAt ? new Date(cf.exceptionReportedAt).getTime() : NaN;
                const overdue = !Number.isNaN(reportedAt)
                    && now - reportedAt > (cfg?.inProgressSlaMinutes ?? 45) * 60_000;
                alerts.push({
                    orderId: String(o.id),
                    orderCode: o.code,
                    type: 'exception',
                    detail: overdue
                        ? `${cf.exceptionType ?? '骑手上报异常'}（超 SLA 未处置，已转人工介入）`
                        : (cf.exceptionType ?? '骑手上报异常'),
                    exceptionNote: cf.exceptionNote ?? null,
                    exceptionPhotos: cf.exceptionPhotos ?? null,
                });
            } else {
                activeOrders.push(o);
            }
            // 顾客催单（plan 2.4）：30 分钟内有效，覆盖待接单/大厅/配送中全部活跃阶段
            if (cf.urged && cf.urgedAt && now - new Date(cf.urgedAt).getTime() < 30 * 60_000) {
                alerts.push({
                    orderId: String(o.id),
                    orderCode: o.code,
                    type: 'urged',
                    detail: '顾客催单，请优先处理',
                });
            }
        }
        const riders = await this.capacity.listOnlineRiders(ctx);
        const ridersOnline: DispatchRider[] = riders.map(r => ({
            customerId: String(r.id),
            realName: (r.customFields as any).riderRealName ?? '',
            credit: (r.customFields as any).riderCredit ?? 100,
        }));
        const handledOrders: HandedException[] = handled
            .sort((a, b) => {
                const ta = new Date((a.customFields as any).exceptionHandledAt ?? 0).getTime();
                const tb = new Date((b.customFields as any).exceptionHandledAt ?? 0).getTime();
                return tb - ta;
            })
            .slice(0, 10)
            .map(o => {
                const cf = o.customFields as any;
                return {
                    orderId: String(o.id),
                    orderCode: o.code,
                    exceptionType: cf.exceptionType ?? null,
                    action: cf.exceptionAction ?? '',
                    compensation: cf.exceptionCompensation ?? null,
                    couponTemplateId: cf.exceptionCouponTemplateId ?? null,
                    note: cf.exceptionHandledNote ?? null,
                    // 显式 ISO：datetime 自定义字段按 String 标量输出时会退化成毫秒数，前端格式化得 NaN:NaN
                    handledAt: cf.exceptionHandledAt ? new Date(cf.exceptionHandledAt).toISOString() : null,
                    handledBy: cf.exceptionHandledBy ?? '',
                };
            });
        return { paused: cfg?.paused ?? false, alerts, hallOrders, activeOrders, ridersOnline, handledOrders };
    }

    /** 手动派单/改派：目标骑手须在职（approved）且信用分达标，避免把单派给封禁/低分骑手。
     * 跨店守卫：只能操作本渠道订单（与 address-change 同源校验）。
     * grabByRider 返回 false 表示订单已不在大厅（已被抢/已退款）。 */
    async assign(ctx: RequestContext, orderId: ID, riderCustomerId: ID) {
        await this.assertOrderInChannel(ctx, orderId);
        const rider = await this.connection.getRepository(ctx, Customer).findOne({
            where: { id: riderCustomerId as any },
        });
        if (!rider) throw new UserInputError('骑手不存在');
        const rcf = (rider.customFields ?? {}) as any;
        if (rcf.riderStatus !== 'approved') throw new UserInputError('该骑手未通过审核或已停用');
        if ((rcf.riderCredit ?? 100) < CREDIT_LIMIT) throw new UserInputError('该骑手信用分不足，无法派单');
        // 在线校验（与 CapacityService 在线窗口一致）：离线骑手派单必然 15min 未取货回厅
        const onlineAt = rcf.riderOnlineAt ? new Date(rcf.riderOnlineAt).getTime() : 0;
        if (!onlineAt || Date.now() - onlineAt > RIDER_ONLINE_WINDOW_MS) {
            throw new UserInputError('该骑手当前不在线，无法派单');
        }
        const ok = await this.grab.grabByRider(ctx, orderId, { id: riderCustomerId });
        if (!ok) throw new UserInputError('派单失败：订单已不在大厅（已被抢/已退款）');
        return { assigned: true };
    }

    /** 回大厅（改派前置）：清骑手指派字段，hallStatus 复位 open。
     * 条件写：已取消/已终态单不可回厅，返回失败让前端明确提示（不能假装成功）。
     * 骑手已取货（in_progress）时强制回厅等于让其白跑，必须带交接说明并留痕（transferNote/transferAt）。 */
    async backToHall(ctx: RequestContext, orderId: ID, note?: string) {
        const order = await this.assertOrderInChannel(ctx, orderId);
        const cf = (order.customFields ?? {}) as any;
        const trimmed = String(note ?? '').trim();
        if (cf.deliveryStatus === 'in_progress' && !trimmed) {
            throw new UserInputError('骑手已取货，强制回大厅需填写交接说明');
        }
        const extra: Record<string, unknown> = trimmed
            ? {
                  transferNote: trimmed.slice(0, 200),
                  transferAt: new Date(),
                  campusCause: 'admin_force_back',
              }
            : {};
        const moved = await this.hall.backToHall(ctx, orderId as any, extra);
        if (!moved) throw new UserInputError('订单已取消或已不在履约流程中，无法回大厅');
        return { backToHall: true };
    }

    /** 异常处置（plan 3.4）：仅 deliveryStatus='exception' 的订单可处置。
     * reassign：回大厅（可再抢/强派）；refund_diff：部分退款完结；coupon：发补偿券完结；
     * refund_all：全额退款+取消订单完结。完结单 hallStatus='exception_final' 退出调度墙，
     * 全部动作写 exceptionAction* 记录留痕。 */
    async handleException(
        ctx: RequestContext,
        orderId: ID,
        action: ExceptionAction,
        amount?: number,
        couponTemplateId?: ID,
        note?: string,
    ) {
        const order = await this.assertOrderInChannel(ctx, orderId);
        const cf = order.customFields as any;
        if ((order as any).state === 'Cancelled') throw new UserInputError('订单已取消，无法处置');
        if (cf.deliveryStatus !== 'exception') {
            throw new UserInputError('仅骑手上报异常的订单可处置');
        }
        const origHallStatus = String(cf.hallStatus ?? '');
        // 幂等认领：原子消费异常态（重派=清 deliveryStatus；完结=置 exception_final），
        // 防重复点击/并发重复赔付（补偿券无累计上限，退款也可多次小额）。
        const claimed = action === 'reassign'
            ? await this.claimException(
                  'UPDATE "order" SET "customFieldsDeliverystatus" = NULL '
                  + 'WHERE id = $1 AND "customFieldsDeliverystatus" = $2 RETURNING id',
                  [orderId, 'exception'],
              )
            : await this.claimException(
                  'UPDATE "order" SET "customFieldsHallstatus" = $1 '
                  + 'WHERE id = $2 AND "customFieldsDeliverystatus" = $3 '
                  + 'AND COALESCE("customFieldsHallstatus", \'\') <> $1 RETURNING id',
                  ['exception_final', orderId, 'exception'],
              );
        if (!claimed) throw new UserInputError('该异常已处置，请刷新后重试');
        // 回滚认领也走条件写：期间若订单已取消（state=Cancelled）则不再恢复异常态（避免复活）
        const restore = action === 'reassign'
            ? () => this.hall.transitionFrom(ctx, Number(order.id), ACTIVE_HALL_STATUSES, { deliveryStatus: 'exception' })
            : () => this.hall.transitionFrom(ctx, Number(order.id), ['exception_final'], {
                  hallStatus: origHallStatus,
                  deliveryStatus: 'exception',
              });
        // 退差价金额归一化后落留痕（避免把小数/原始入参写进 exceptionCompensation）
        let refundDiffAmount: number | null = null;
        // 退款/退单失败已置 refund_failed 时不再回滚认领（回滚会把单子拉回可自动重试态，掩盖客户未退款）
        let refundFailureMarked = false;
        try {
            switch (action) {
                case 'reassign': {
                    const moved = await this.hall.backToHall(ctx, order.id as any);
                    if (!moved) throw new UserInputError('订单已取消，无法重新派送');
                    // 重置入厅时间：否则同轮 T4 会按旧 hallEnteredAt 立即自动退款。
                    // 条件写（仅 open）：并发取消时不得把已取消单改回履约态/写调度字段。
                    const reset = await this.hall.transitionFrom(ctx, Number(order.id), ['open'], {
                        hallEnteredAt: new Date(),
                        campusCause: 'exception_reassign',
                    });
                    if (!reset) {
                        Logger.warn(`Order ${order.code} reassign 后状态已变更，入厅时间未重置`, 'CampusDispatch');
                    }
                    break;
                }
                case 'refund_diff': {
                    if (!amount || amount <= 0) throw new UserInputError('赔付金额必须大于 0');
                    // 金额必须为整数分且不超过订单实付：防小数/超额导致部分退款异常或重复套现
                    const diff = Math.floor(Number(amount));
                    if (!Number.isInteger(diff) || diff <= 0) throw new UserInputError('赔付金额必须为正整数（分）');
                    if (diff > Number((order as any).totalWithTax ?? 0)) {
                        throw new UserInputError('赔付金额不能超过订单实付金额');
                    }
                    refundDiffAmount = diff;
                    let done;
                    try {
                        done = await withRefundLock(this.connection, Number(order.id), () =>
                            this.refundAmount(ctx, order, diff, `exception diff refund (${order.code})`),
                        );
                    } catch (e) {
                        refundFailureMarked = await this.markExceptionRefundFailed(ctx, order, action, e);
                        throw e;
                    }
                    if (!done.ok) throw new UserInputError('该订单正在退款处理中，请稍后重试');
                    break;
                }
                case 'coupon': {
                    if (!couponTemplateId) throw new UserInputError('请选择补偿券模板');
                    const coupon = this.getCouponService();
                    if (!coupon) throw new UserInputError('券服务不可用');
                    if (!order.customerId) throw new UserInputError('订单无客户信息，无法发券');
                    await coupon.grantCoupon(ctx, couponTemplateId, [order.customerId as any]);
                    break;
                }
                case 'refund_all': {
                    let done;
                    try {
                        done = await withRefundLock(this.connection, Number(order.id), () =>
                            this.refundAllAndCancel(ctx, order),
                        );
                    } catch (e) {
                        refundFailureMarked = await this.markExceptionRefundFailed(ctx, order, action, e);
                        throw e;
                    }
                    if (!done.ok) throw new UserInputError('该订单正在退款处理中，请稍后重试');
                    break;
                }
                case 'handled': {
                    // 群内运营已电话/微信跟客户沟通完毕，无需退款/补偿，仅标记处置完结
                    break;
                }
                default:
                    throw new UserInputError('未知处置动作');
            }
        } catch (e) {
            // 处置失败回滚认领，保留异常态供重试（避免「标记已处置但钱未退/券未发」）；
            // 退款失败已置 refund_failed 的不回滚，等人工对账（重试仍可从 refund_failed 再次认领）
            if (!refundFailureMarked) await restore().catch(() => undefined);
            throw e;
        }
        const patch: any = {
            exceptionAction: action,
            exceptionCompensation: action === 'refund_diff' ? refundDiffAmount : null,
            exceptionCouponTemplateId: action === 'coupon' ? String(couponTemplateId) : null,
            exceptionHandledNote: note ?? null,
            exceptionHandledAt: new Date(),
            exceptionHandledBy: String(ctx.activeUserId ?? ''),
        };
        if (action !== 'reassign') {
            patch.hallStatus = 'exception_final';
            if (action === 'refund_all') patch.campusCause = 'exception_refund';
        }
        // 留痕条件写：期间订单被取消/已离开预期状态时不写处置记录（终态优先，不覆盖取消）
        const recorded = await this.hall.transitionFrom(
            ctx,
            Number(order.id),
            action === 'reassign' ? ACTIVE_HALL_STATUSES : ['exception_final'],
            patch,
        );
        if (!recorded) {
            Logger.warn(
                `Order ${order.code} exception handled (${action}) but hall state changed; record skipped`,
                'CampusDispatch',
            );
        }
        Logger.info(`Order ${order.code} exception handled: ${action}`, 'CampusDispatch');
        // 处置完结 push（fire-and-forget，plan 3.4 补全）：按 action 带动态文案通知下单用户
        // dedupe 后缀用本次异常上报时间：重派后再次异常处置各推一条（固定键会把第二次吞掉）
        const occurrence = cf.exceptionReportedAt ? new Date(cf.exceptionReportedAt).getTime() : Date.now();
        this.notify.user(
            ctx,
            order.id,
            'exceptionHandled',
            EXCEPTION_NOTIFY_TEXT[action],
            undefined,
            String(occurrence),
        );
        return { ok: true, action };
    }

    /** 异常处置原子认领：仅首次调用返回 true（并发/重复点击只有一路能消费掉异常态） */
    private async claimException(sql: string, params: any[]): Promise<boolean> {
        const res: any = await this.connection.rawConnection.query(sql, params);
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        return Array.isArray(rows) && rows.length > 0;
    }

    /** 跨店守卫：订单必须属于当前渠道（调度写操作统一入口校验） */
    private async assertOrderInChannel(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['channels'],
        });
        if (!order) throw new UserInputError('订单不存在');
        const inChannel = (order.channels ?? []).some(c => String(c.id) === String(ctx.channelId));
        if (!inChannel) throw new UserInputError('订单不属于当前店铺');
        return order;
    }

    /** 部分退款（fork 无 core RefundService，走 OrderService.refundOrder/settleRefund，与 T4 同源）。
     * refund 表 shipping/adjustment 列 NOT NULL 必须显式传 0；
     * 幂等保护：累计已退 + 本次 ≤ payment.amount，超额抛错。 */
    private async refundAmount(ctx: RequestContext, order: Order, amount: number, reason: string) {
        const orderSvc = this.getOrderService();
        // 只认 Settled/Authorized 且余额足够的支付单，避免选中失败重试单导致退款失败
        const payments = await refundablePayments(this.connection, Number(order.id));
        if (!payments.length) throw new UserInputError('订单无可退支付余额（可能未支付或已全额退款）');
        const picked = payments.find(p => p.remaining >= amount);
        if (!picked) throw new UserInputError('退款金额超过可退余额（订单可能已全额退款）');
        const created = await orderSvc.refundOrder(ctx, {
            paymentId: picked.payment.id,
            amount,
            shipping: 0,
            adjustment: 0,
            reason,
        } as any);
        if (!created || (created as any).errorCode) {
            throw new Error(`refundOrder failed: ${(created as any)?.errorCode ?? 'no result'}`);
        }
        // 结算失败置 Failed：否则未真实打款的退款单仍计入已退总额，重试会跳过退款直接取消订单
        await settleRefundOrMarkFailed(this.connection, orderSvc, ctx, (created as any).id);
    }

    /** 全额退单：退剩余未退部分 + cancelOrder（行取消+状态转换，同 T4） */
    private async refundAllAndCancel(ctx: RequestContext, order: Order) {
        const orderSvc = this.getOrderService();
        // 覆盖多支付单场景：逐张退剩余（单支付单订单等价于原「退剩余」）
        for (const picked of await refundablePayments(this.connection, Number(order.id))) {
            await this.refundAmount(ctx, order, picked.remaining, `exception full refund (${order.code})`);
        }
        let cancelled = await orderSvc.cancelOrder(ctx, {
            orderId: order.id as any,
            reason: `exception full refund cancel (${order.code})`,
        } as any);
        // 退款已发生，取消失败会让订单停在 Processing；重试一次后交给人工（勿重复退款）
        if (cancelled && (cancelled as any).errorCode) {
            cancelled = await orderSvc.cancelOrder(ctx, {
                orderId: order.id as any,
                reason: `exception full refund cancel retry (${order.code})`,
            } as any);
        }
        if (cancelled && (cancelled as any).errorCode) {
            throw new Error(`cancelOrder failed: ${(cancelled as any).errorCode}`);
        }
    }

    /**
     * 退款/退单处置失败兜底：不能只回滚认领——退款单可能已创建但客户未到账。
     * 与 T4 一致置 refund_failed 退出自动重试并推飞书，人工对账后仍可再次处置
     * （deliveryStatus 保持 exception，重新处置会重新认领）。条件写防覆盖已取消单。
     */
    private async markExceptionRefundFailed(
        ctx: RequestContext,
        order: Order,
        action: ExceptionAction,
        e: any,
    ): Promise<boolean> {
        try {
            const marked = await this.hall.transitionFrom(ctx, Number(order.id), ['exception_final'], {
                hallStatus: 'refund_failed',
                campusCause: 'refund_failed',
            });
            if (!marked) {
                Logger.warn(`Order ${order.code} 退款失败但订单状态已变更，refund_failed 未写入`, 'CampusDispatch');
                return false;
            }
            void this.getFeishu()?.pushEvent(
                'exception',
                '异常处置退款失败',
                `订单 ${order.code} 异常处置（${action}）退款/退单失败，客户可能未收到退款，请人工核对。原因：${e?.message ?? e}`,
                order.code,
                `exception_refund_failed:${order.code}`,
            );
            return true;
        } catch (e2: any) {
            Logger.error(`Order ${order.code} 退款失败兜底写入异常：${e2?.message ?? e2}`, 'CampusDispatch');
            return false;
        }
    }

    private getOrderService(): OrderService {
        if (!this.orderSvc) this.orderSvc = this.injector.get(OrderService);
        return this.orderSvc;
    }

    /** 补偿券服务：coupon-plugin 为可选依赖，动态 require + Injector 解析（同 dispatch-job），
     * 未安装/未启用/解析失败返回 null。 */
    private getCouponService():
        | { grantCoupon: (ctx: RequestContext, templateId: ID, customerIds: ID[]) => Promise<string[]> }
        | null {
        if (this.couponSvc !== undefined) return this.couponSvc ?? null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod: any = require('@vendure/coupon-plugin');
            this.couponSvc = mod?.CouponService ? this.injector.get(mod.CouponService) : null;
        } catch {
            this.couponSvc = null;
        }
        return this.couponSvc ?? null;
    }
}
