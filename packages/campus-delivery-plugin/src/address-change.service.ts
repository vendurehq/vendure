import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    CustomerService,
    ForbiddenError,
    ID,
    Injector,
    Logger,
    Order,
    OrderService,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { SubscribeMessageService } from '@vendure/wechat-subscribe-message-plugin';
import { IsNull } from 'typeorm';
import { CampusAddressChange } from './campus-address-change.entity';
import { CampusBuilding } from './campus-building.entity';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusZone } from './campus-zone.entity';
import { CapacityService } from './capacity.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { HallService } from './hall.service';
import { CampusNotifyService } from './campus-notify.service';
import { refundablePayments, settleRefundOrMarkFailed } from './refund-payment';
import { quoteZoneFee, readHallBacklog } from './shipping-calculator';
import { parseDynamicPricing, quoteDynamicFee } from './dynamic-pricing';
import { resolveHandoverPoint } from './route-matrix';
import { withAddressLock, withRefundLock } from './refund-lock';
import { ThirdPartyDeliveryService } from './third-party-delivery.service';

const loggerCtx = 'CampusAddressChange';

/** 外部配送已接单/取货后不可改址 */
const THIRD_PARTY_LOCKED = ['accepted', 'pickup', 'delivered'];

/**
 * H4 未结清补差闸门：自助改址不阻断当前订单履约（先服务后补差），
 * 但「其它订单」累计未结清补差达到上限后必须先结清，避免反复改到高价分区后欠费累积。
 */
const MAX_UNPAID_DIFF_CENTS = 1000; // ¥10
const MAX_UNPAID_DIFF_ROWS = 3;

@Injectable()
export class AddressChangeService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private customerService: CustomerService,
        private capacity: CapacityService,
        private notify: CampusNotifyService,
        private thirdParty: ThirdPartyDeliveryService,
        private moduleRef: ModuleRef,
        private hall: HallService,
        private feishu: FeishuNotifyService,
    ) {}

    /** 顾客自助改址（取货前、可跨分区）。差额不阻塞改址，写入台账待运营结算。 */
    async changeByCustomer(
        ctx: RequestContext,
        input: { orderId: ID; zoneId: ID; buildingId: ID; detail?: string },
    ) {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new ForbiddenError();

        const locked = await withAddressLock(this.connection, input.orderId, async () => {
            // 锁内重读：并发双击/两个标签页同时改址时，后到者必须基于最新地址与最新运费计算差额
            const order = await this.loadOrder(ctx, input.orderId);
            if ((order.customer as any)?.id !== customer.id) throw new ForbiddenError();
            this.assertNotCancelledOrDelivered(order);

            const cf = (order.customFields ?? {}) as any;
            if (cf.deliveryStatus === 'in_progress') throw new UserInputError('骑手已取货，无法自助改址，请联系客服');
            if (THIRD_PARTY_LOCKED.includes(cf.thirdPartyState)) throw new UserInputError('外部配送已接单，无法自助改址');

            await this.assertNoUnpaidDiff(ctx, customer.id, Number(order.id));
            const { zone, building } = await this.resolveTarget(ctx, input.zoneId, input.buildingId);
            return this.applyChange(ctx, order, zone, building, input.detail, {
                source: 'customer',
                reason: null,
                changedBy: ctx.activeUserId as any,
                customerId: customer.id,
            });
        });
        if (!locked.ok) throw new UserInputError('该订单正在处理其他改址，请稍后重试');
        return locked.value;
    }

    /**
     * 运营代客改址：C 端取货后锁死，运营可代改（必须填原因，全程留痕）。
     * 仅「已取消 / 已送达」拒绝；骑手取货、外部已接单均允许代改。
     */
    async adminChange(
        ctx: RequestContext,
        input: { orderId: ID; zoneId: ID; buildingId: ID; detail?: string; reason: string },
    ) {
        const reason = (input.reason ?? '').trim();
        if (!reason) throw new UserInputError('请填写代改原因');
        const locked = await withAddressLock(this.connection, input.orderId, async () => {
            const order = await this.loadOrder(ctx, input.orderId);
            if (Number(this.channelIdOf(order, ctx)) !== Number(ctx.channelId)) throw new ForbiddenError();
            this.assertNotCancelledOrDelivered(order);

            const { zone, building } = await this.resolveTarget(ctx, input.zoneId, input.buildingId);
            return this.applyChange(ctx, order, zone, building, input.detail, {
                source: 'admin',
                reason,
                changedBy: (ctx.activeUserId ?? null) as any,
                customerId: ((order.customer as any)?.id ?? null) as any,
            });
        });
        if (!locked.ok) throw new UserInputError('该订单正在处理其他改址，请稍后重试');
        return locked.value;
    }

    /** 改址差额试算（运营端预览：不写台账、不改订单） */
    async quote(ctx: RequestContext, orderId: ID, zoneId: ID) {
        const order = await this.loadOrder(ctx, orderId);
        if (Number(this.channelIdOf(order, ctx)) !== Number(ctx.channelId)) throw new ForbiddenError();
        this.assertNotCancelledOrDelivered(order);
        const zone = await this.connection.getRepository(ctx, CampusZone).findOne({ where: { id: zoneId as any } });
        if (!zone) throw new UserInputError('分区不存在');
        if (Number((zone as any).channelId) !== Number(ctx.channelId)) throw new ForbiddenError();

        const channelId = this.channelIdOf(order, ctx);
        const cfg = await this.connection.rawConnection.getRepository(CampusFulfillmentConfig).findOne({
            where: { channelId: channelId as any },
        });
        const oldFee = await this.effectiveOldFee(ctx, order);
        const q = await quoteZoneFee(this.connection, channelId, { name: zone.name, fee: Number(zone.fee) }, cfg, order);
        const newFee = Number(q?.price ?? oldFee);
        const buildings = await this.connection
            .getRepository(ctx, CampusBuilding)
            .find({ where: { zoneId: (zone as any).id, channelId: channelId as any } });
        return {
            oldFee,
            newFee,
            diff: newFee - oldFee,
            zoneId: (zone as any).id,
            zoneName: zone.name,
            buildings,
        };
    }

    /** 顾客端：本单最近一次改址（差额状态感知，含已结清） */
    async myLatest(ctx: RequestContext, orderId: ID) {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new ForbiddenError();
        const order = await this.loadOrder(ctx, orderId);
        if ((order.customer as any)?.id !== customer.id) throw new ForbiddenError();
        const row = await this.connection
            .getRepository(ctx, CampusAddressChange)
            .findOne({ where: { orderId: Number(order.id) }, order: { createdAt: 'DESC' as any } });
        if (!row) return null;
        return {
            id: row.id,
            diff: row.diff,
            status: row.status,
            settleAction: row.settleAction,
            fromZone: row.fromZone,
            fromBuilding: row.fromBuilding,
            toZone: row.toZone,
            toBuilding: row.toBuilding,
            createdAt: row.createdAt,
        };
    }

    /** 动态计价预览：当前供需 + 各分区试算拆解（后台配置页用） */
    async dynamicPreview(ctx: RequestContext) {
        const channelId = ctx.channelId;
        const cfg = await this.connection.rawConnection.getRepository(CampusFulfillmentConfig).findOne({
            where: { channelId: channelId as any },
        });
        const pricing = parseDynamicPricing(cfg?.dynamicPricing ?? null);
        const zones = (await this.connection.rawConnection.getRepository(CampusZone).find({
            where: { channelId: channelId as any },
            order: { id: 'ASC' as any },
        })) as CampusZone[];
        const backlog = pricing.enabled && pricing.supply ? await readHallBacklog(this.connection, channelId) : 0;
        const onlineRiders = (await this.capacity.listOnlineRiders(ctx)).length;
        const now = new Date();
        // 非分区口径：R5 跑腿起步价（未配置按默认 200）、R2 第三方到校基价（未配置不接管）
        const quoteBase = (key: 'errand' | 'third-party', raw: number | null | undefined, fallback: number | null) => {
            const base = raw ?? fallback;
            if (base == null) return null;
            const q = quoteDynamicFee({ baseFee: Number(base), config: pricing, at: now, backlog, onlineRiders });
            return {
                key,
                configured: raw != null,
                baseFee: q.baseFee,
                price: q.price,
                addFee: q.addFee,
                breakdown: q.breakdown,
            };
        };
        return {
            at: now.toISOString(),
            enabled: pricing.enabled,
            backlog,
            onlineRiders,
            manualMultiplier: pricing.manualMultiplier,
            maxAddFee: pricing.maxAddFee,
            errand: quoteBase('errand', cfg?.errandBaseFee, 200),
            thirdParty: quoteBase('third-party', cfg?.thirdPartyBaseFee, null),
            supply: pricing.supply
                ? {
                      backlogThreshold: pricing.supply.backlogThreshold,
                      riderThreshold: pricing.supply.riderThreshold ?? null,
                      addFee: pricing.supply.addFee,
                  }
                : null,
            peakWindows: pricing.peakWindows,
            zones: zones.map(z => {
                const q = quoteDynamicFee({
                    baseFee: Number(z.fee),
                    config: pricing,
                    at: now,
                    backlog,
                    onlineRiders,
                });
                return {
                    zoneId: (z as any).id,
                    zoneName: z.name,
                    baseFee: q.baseFee,
                    price: q.price,
                    addFee: q.addFee,
                    breakdown: q.breakdown,
                };
            }),
        };
    }

    async list(ctx: RequestContext, opts: { status?: string; orderId?: ID; skip?: number; take?: number } = {}) {
        const qb = this.connection
            .getRepository(ctx, CampusAddressChange)
            .createQueryBuilder('r')
            .where('r.channelId = :cid', { cid: ctx.channelId })
            .orderBy('r.createdAt', 'DESC')
            .skip(Math.max(0, opts.skip ?? 0))
            .take(Math.min(opts.take ?? 50, 200));
        if (opts.status) qb.andWhere('r.status = :st', { st: opts.status });
        if (opts.orderId != null) qb.andWhere('r.orderId = :oid', { oid: Number(opts.orderId) });
        return qb.getMany();
    }

    async stats(ctx: RequestContext) {
        const rows = await this.connection
            .getRepository(ctx, CampusAddressChange)
            .createQueryBuilder('r')
            .select('r.status', 'status')
            .addSelect('COUNT(*)', 'cnt')
            .addSelect('COALESCE(SUM(CASE WHEN r.diff > 0 THEN r.diff ELSE 0 END), 0)', 'collect')
            .addSelect('COALESCE(SUM(CASE WHEN r.diff < 0 THEN -r.diff ELSE 0 END), 0)', 'refund')
            .where('r.channelId = :cid', { cid: ctx.channelId })
            .groupBy('r.status')
            .getRawMany();
        let pendingCount = 0;
        let pendingCollect = 0;
        let pendingRefund = 0;
        let total = 0;
        for (const r of rows) {
            const cnt = Number(r.cnt) || 0;
            total += cnt;
            if (r.status === 'pending') {
                pendingCount += cnt;
                pendingCollect += Number(r.collect) || 0;
                pendingRefund += Number(r.refund) || 0;
            }
        }
        return {
            total,
            pendingCount,
            pendingCollect,
            pendingRefund,
        };
    }

    /** 运营结清：refund=真实退款 / collect=补收（必须填凭证）/ waive=免收 / pending=撤销结清 */
    async settle(ctx: RequestContext, id: ID, action: string, note?: string) {
        if (!['refund', 'collect', 'waive', 'pending'].includes(action)) {
            throw new UserInputError('无效的结清动作');
        }
        const repo = this.connection.getRepository(ctx, CampusAddressChange);
        const row = await repo.findOne({ where: { id: id as any } });
        if (!row) throw new UserInputError('台账记录不存在');
        if (Number(row.channelId) !== Number(ctx.channelId)) throw new ForbiddenError();
        const trimmed = (note ?? '').trim();
        // settleNote 列为 varchar(255)：超长会触发数据库写入失败，提前拦截
        if (trimmed.length > 200) throw new UserInputError('结清备注不能超过 200 字');
        if (action === 'pending') {
            if (row.refundId) throw new UserInputError('该差额已实际退款，无法撤销结清');
            row.status = 'pending';
            row.settledAt = null;
            row.settledBy = null;
            row.settleAction = null;
            row.settleNote = null;
        } else {
            if (action === 'collect') {
                if (Number(row.diff) <= 0) throw new UserInputError('本单无待补收差额，无需补收');
                if (!trimmed) throw new UserInputError('请填写补收凭证（收款方式或流水号）');
            }
            if (action === 'refund') {
                if (Number(row.diff) >= 0) throw new UserInputError('本单不是待退差额，不能按已退款结清');
                if (row.refundId) throw new UserInputError('该差额已退款，请勿重复操作');
                const amount = Math.abs(Number(row.diff));
                if (amount > 0) {
                    // 与商家拒单/T4/异常处置共用订单级退款锁，锁内复查防并发双退；
                    // 台账 refundId 必须在锁内与退款单同临界区落库（CAS：refundId IS NULL），
                    // 否则退款已打款而台账保存失败时会再次退款。
                    const done = await withRefundLock(this.connection, Number(row.orderId), async () => {
                        const fresh = await repo.findOne({ where: { id: id as any } });
                        if (!fresh) throw new UserInputError('台账记录不存在');
                        if (fresh.refundId) throw new UserInputError('该差额已退款，请勿重复操作');
                        const order = await this.loadOrder(ctx, row.orderId);
                        const refund = await this.refundAmount(
                            ctx,
                            order,
                            amount,
                            `address change refund (${row.orderCode})`,
                        );
                        const saved = await repo.update(
                            { id: id as any, refundId: IsNull() } as any,
                            {
                                refundId: refund.id as any,
                                status: 'settled',
                                settledAt: new Date(),
                                settledBy: (ctx.activeUserId ?? null) as any,
                                settleAction: 'refund',
                                settleNote: trimmed || null,
                            } as any,
                        );
                        if (!Number((saved as any)?.affected ?? 0)) {
                            throw new UserInputError('该差额已退款，请勿重复操作');
                        }
                    });
                    if (!done.ok) throw new UserInputError('该订单正在退款处理中，请稍后重试');
                    return repo.findOne({ where: { id: id as any } });
                }
            }
            row.status = 'settled';
            row.settledAt = new Date();
            row.settledBy = (ctx.activeUserId ?? null) as any;
            row.settleAction = action;
            row.settleNote = trimmed || null;
        }
        return repo.save(row);
    }

    /** 部分退款（fork 无 core RefundService，走 OrderService.refundOrder/settleRefund，与 dispatch-admin 同源）。
     * refund 表 shipping/adjustment 列 NOT NULL 必须显式传 0；超额退款抛错。 */
    private async refundAmount(ctx: RequestContext, order: Order, amount: number, reason: string): Promise<Refund> {
        // 只认 Settled/Authorized 且仍有余额的支付单，避免选中失败重试单导致退款失败
        const payments = await refundablePayments(this.connection, Number(order.id));
        if (!payments.length) throw new UserInputError('订单无可退支付余额（可能未支付或已全额退款）');
        const picked = payments.find(p => p.remaining >= amount);
        if (!picked) throw new UserInputError('退款金额超过可退余额（订单可能已全额退款）');
        const created: any = await this.orderService.refundOrder(ctx, {
            paymentId: picked.payment.id,
            amount,
            shipping: 0,
            adjustment: 0,
            reason,
        } as any);
        if (!created || created.errorCode) {
            throw new UserInputError(`退款失败：${created?.errorCode ?? '未知原因'}`);
        }
        // 结算失败必须把退款单置 Failed（与商家拒单/T4/异常处置同一口径），
        // 否则该 Pending 单仍占已退额度，后续重试/拒单退款会少退。
        await settleRefundOrMarkFailed(this.connection, this.orderService, ctx, created.id);
        return created as Refund;
    }

    /**
     * H4：自助改址前的未结清补差闸门。
     * 只统计「其它订单」的待补收差额（本单连续改址允许，顾客改错后仍可纠正），
     * 累计金额或笔数超限时要求先结清，防止反复改到高价分区后一直欠费。
     */
    private async assertNoUnpaidDiff(ctx: RequestContext, customerId: ID, orderId: number): Promise<void> {
        const rows = await this.connection.getRepository(ctx, CampusAddressChange).find({
            where: {
                channelId: ctx.channelId as any,
                customerId: customerId as any,
                status: 'pending',
            } as any,
        });
        const owed = rows.filter(r => Number(r.orderId) !== orderId && Number(r.diff ?? 0) > 0);
        const owedSum = owed.reduce((sum, r) => sum + Number(r.diff ?? 0), 0);
        if (owedSum >= MAX_UNPAID_DIFF_CENTS || owed.length >= MAX_UNPAID_DIFF_ROWS) {
            throw new UserInputError('有未结清的改址差价，请先联系客服结清后再修改地址');
        }
    }

    private async loadOrder(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .leftJoinAndSelect('order.customer', 'customer')
            .where('order.id = :id', { id: orderId })
            .getOne();
        if (!order) throw new UserInputError('订单不存在');
        return order;
    }

    private assertNotCancelledOrDelivered(order: Order) {
        const cf = (order.customFields ?? {}) as any;
        if (order.state === 'Cancelled') throw new UserInputError('订单已取消，无法改址');
        if (cf.deliveredAt) throw new UserInputError('订单已送达，无法改址');
    }

    private async resolveTarget(ctx: RequestContext, zoneId: ID, buildingId: ID) {
        const zone = await this.connection.getRepository(ctx, CampusZone).findOne({
            where: { id: zoneId as any },
        });
        if (!zone) throw new UserInputError('分区不存在');
        // 跨店守卫：分区/楼栋必须属于当前店铺，防止改址到别家渠道的地址
        if (Number((zone as any).channelId) !== Number(ctx.channelId)) throw new UserInputError('分区不属于当前店铺');
        const building = await this.connection.getRepository(ctx, CampusBuilding).findOne({
            where: { id: buildingId as any },
        });
        if (!building) throw new UserInputError('宿舍楼不存在');
        if (Number(building.zoneId) !== Number(zone.id)) throw new UserInputError('楼栋不属于所选分区');
        if (Number((building as any).channelId) !== Number((zone as any).channelId)) throw new UserInputError('楼栋不属于所选分区');
        return { zone, building };
    }

    private async applyChange(
        ctx: RequestContext,
        order: Order,
        zone: CampusZone,
        building: CampusBuilding,
        detail: string | undefined,
        actor: { source: 'customer' | 'admin'; reason: string | null; changedBy: ID | null; customerId: ID | null },
    ) {
        const channelId = this.channelIdOf(order, ctx);
        const cfg = await this.connection.rawConnection.getRepository(CampusFulfillmentConfig).findOne({
            where: { channelId: channelId as any },
        });

        const cf = (order.customFields ?? {}) as any;
        // 差额基准必须取「上一次改址后的生效运费」：order.shippingWithTax 是下单快照且从不回写，
        // 连续改址（A→B→A）会重复记差额。无改址史时退回下单快照。
        const oldFee = await this.effectiveOldFee(ctx, order);
        const quote = await quoteZoneFee(this.connection, channelId, { name: zone.name, fee: Number(zone.fee) }, cfg, order);
        const newFee = Number(quote?.price ?? oldFee);
        const diff = newFee - oldFee;

        const fromZone = String(cf.campusZone ?? '');
        const fromBuilding = String(cf.buildingId ?? '');
        const fromDetail = cf.deliveryDetail ?? null;
        const toDetail = detail?.trim() || fromDetail;

        const route = String(cf.fulfillmentRoute ?? '');
        const hallStatus = String(cf.hallStatus ?? '');
        // 交接点快照联动：R1/R2 按新楼栋坐标重选最近交接点（未配置交接点时为 null，保留旧快照）。
        // 餐已实到交接点（open）或已被骑手取走（grabbed/delivered）时不改快照，否则会把骑手指向错误位置。
        const atHandoverPoint = ['open', 'grabbed', 'delivered'].includes(hallStatus);
        const point =
            (route === 'R1' || route === 'R2') && cfg && !atHandoverPoint
                ? resolveHandoverPoint(
                      route as 'R1' | 'R2',
                      cfg,
                      building.lat != null && building.lng != null
                          ? { lat: Number(building.lat), lng: Number(building.lng) }
                          : null,
                  )
                : null;

        const record = await this.connection.getRepository(ctx, CampusAddressChange).save(
            new CampusAddressChange({
                channelId,
                orderId: Number(order.id),
                orderCode: order.code,
                customerId: actor.customerId as any,
                fromZone,
                fromBuilding,
                fromDetail,
                toZone: zone.name,
                toBuilding: building.name,
                toDetail,
                oldFee,
                newFee,
                diff,
                status: diff === 0 ? 'settled' : 'pending',
                settledAt: diff === 0 ? new Date() : null,
                settleAction: diff === 0 ? 'waive' : null,
                source: actor.source,
                reason: actor.reason,
                changedBy: actor.changedBy as any,
            }),
        );

        try {
            await this.orderService.updateCustomFields(ctx, order.id, {
                buildingId: String((building as any).id),
                campusZone: zone.name,
                deliveryDetail: toDetail,
                // 改址联动（C 组漏项）：R1/R2 按新楼栋坐标重算最近交接点快照，
                // 否则第一段仍会把餐送到旧地址对应的交接点。
                ...(point
                    ? {
                          handoverPointName: point.name,
                          handoverPointAddress: point.address ?? null,
                          handoverPointLat: point.lat,
                          handoverPointLng: point.lng,
                      }
                    : {}),
            } as any);
        } catch (e) {
            // 订单地址未改成功时台账不得残留：否则会留下「已改址待补差额」幽灵记录，
            // 运营按台账退款/补收却从未真正改址。
            await this.connection
                .getRepository(ctx, CampusAddressChange)
                .delete(record.id as any)
                .catch((err: any) =>
                    Logger.error(
                        `address change: rollback record ${record.id} failed for ${order.code}: ${err?.message ?? err}`,
                        loggerCtx,
                    ),
                );
            throw e;
        }

        // 已指派骑手在途 / R1 商户自配送：改址必须触达实际履约方，否则仍按旧地址送达。
        // campusCause 供调度墙展示；骑手订阅消息复用渠道 orderShippedTemplateId（同入厅提醒口径）。
        const riderId = String(cf.deliveryStaffId ?? '');
        const merchantSelfDelivery = route === 'R1';
        if (riderId || merchantSelfDelivery) {
            await this.orderService.updateCustomFields(ctx, order.id, { campusCause: 'address_changed' } as any);
        }
        if (riderId) {
            this.notifyRiderAddressChanged(ctx, order, riderId, zone, building);
        }
        if (merchantSelfDelivery) {
            this.notifyMerchantAddressChanged(ctx, order, record.id as any, zone, building);
        }

        // 外部快递在途（已接单/已取货）：旧运单目的地已失效，取消后回待推送，由运营按新址重推。
        // 未推送（pending_dispatch/未入 third_party）无需处理，重推时自然读取新址。
        const tpState = String(cf.thirdPartyState ?? '');
        const externalInFlight =
            hallStatus === 'third_party'
            && String(cf.deliveryPlan ?? '') === 'external_courier'
            && ['pending', 'accepted', 'pickup'].includes(tpState);
        if (externalInFlight) {
            let cancelled = false;
            try {
                const res = await this.thirdParty.cancel(ctx, Number(order.id), 'address changed');
                cancelled = !!res?.ok;
            } catch (e: any) {
                Logger.error(`address change: cancel external failed for ${order.code}: ${e?.message ?? e}`, loggerCtx);
            }
            if (cancelled) {
                // cancel 按路线回落（R2 待推送 / R3 大厅且 deliveryPlan 改回 campus_rider）；
                // 改址场景统一恢复外部快递计划并回待推送，等运营按新址重推。
                // 条件写：与用户取消并发时不得把已退款单改回待推送（cancel 期间可能已脱厅）
                const moved = await this.hall.transitionFrom(
                    ctx,
                    Number(order.id),
                    ['open', 'pending_dispatch', 'third_party'],
                    {
                        hallStatus: 'pending_dispatch',
                        deliveryPlan: 'external_courier',
                        handoverMode: route === 'R2' ? 'to_campus_rider' : 'direct_to_user',
                        thirdPartyState: 'cancelled',
                        thirdPartyDispatchAt: new Date(),
                        exceptionResolvedAt: null,
                        campusCause: 'address_changed_repush',
                    },
                );
                if (!moved) {
                    Logger.warn(
                        `address change: order ${order.code} already cancelled/left flow, skip repush reset`,
                        loggerCtx,
                    );
                }
            } else {
                // 旧运单未确认取消：仍会按旧地址送达，新址无人处理。留痕给运营人工取消/改址，不可静默。
                await this.orderService.updateCustomFields(ctx, order.id, {
                    campusCause: 'address_change_cancel_failed',
                } as any);
                Logger.error(
                    `address change: external delivery for ${order.code} NOT cancelled, still routed to old address; manual follow-up required`,
                    loggerCtx,
                );
            }
        }

        Logger.info(
            `address change [${actor.source}] order=${order.code} ${fromZone}/${fromBuilding} -> ${zone.name}/${building.name} diff=${diff}`,
            loggerCtx,
        );
        // 改址成功通知（fire-and-forget）：以台账记录 id 作幂等后缀，同一订单多次改址各推一条
        this.notify.user(
            ctx,
            order.id,
            'addressChanged',
            `${zone.name}·${building.name}`,
            cfg?.h5BaseUrl ?? undefined,
            String(record.id),
        );
        return {
            diff,
            oldFee,
            newFee,
            fromZone,
            toZone: zone.name,
            recordId: record.id,
        };
    }

    /** 生效运费：最近一次改址落库的 newFee；无改址史回退下单快照 shippingWithTax */
    private async effectiveOldFee(ctx: RequestContext, order: Order): Promise<number> {
        const latest = await this.connection.getRepository(ctx, CampusAddressChange).findOne({
            where: { orderId: Number(order.id) },
            order: { createdAt: 'DESC' as any, id: 'DESC' as any },
        });
        return latest ? Number(latest.newFee) : Number(order.shippingWithTax ?? 0);
    }

    /** R1 商户自配送改址：推管理群（商户履约方），避免商户仍按旧楼栋配送 */
    private notifyMerchantAddressChanged(
        ctx: RequestContext,
        order: Order,
        recordId: ID,
        zone: CampusZone,
        building: CampusBuilding,
    ) {
        void this.feishu
            .pushEvent(
                'campus_address_changed',
                '订单改址（商户自配送）',
                `订单 ${order.code} 收货地址改为 ${zone.name}·${building.name}，请按新地址配送`,
                order.code,
                String(recordId),
            )
            .catch((e: any) => Logger.warn(`address change: merchant notify failed: ${e?.message ?? e}`, loggerCtx));
    }

    /** 改址定向提醒在途骑手（best-effort，失败不阻塞改址）：复用渠道 orderShippedTemplateId。 */
    private notifyRiderAddressChanged(
        ctx: RequestContext,
        order: Order,
        riderId: string,
        zone: CampusZone,
        building: CampusBuilding,
    ) {
        void (async () => {
            try {
                const templateId = ((ctx.channel as any)?.customFields ?? {}).orderShippedTemplateId as
                    | string
                    | undefined;
                if (!templateId) return;
                const msg = new Injector(this.moduleRef).get(SubscribeMessageService);
                await msg.sendCustomMessage(ctx, riderId as any, templateId, {
                    orderCode: { value: order.code },
                    zone: { value: `${zone.name}·${building.name}` },
                });
            } catch (e: any) {
                Logger.warn(`address change: rider notify failed (${riderId}): ${e?.message ?? e}`, loggerCtx);
            }
        })();
    }

    private channelIdOf(order: Order, ctx: RequestContext): ID {
        const channels = (order as any).channels as Array<{ id: ID; code: string }> | undefined;
        const own = (channels ?? []).find(c => c.code !== '__default_channel__');
        return (own?.id ?? ctx.channelId) as ID;
    }
}
