import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Injector, Logger, Order, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { SubscribeMessageService } from '@vendure/wechat-subscribe-message-plugin';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusBuilding } from './campus-building.entity';
import { CampusDedupeService } from './campus-dedupe.service';
import { CapacityService } from './capacity.service';
import { CampusNotifyService } from './campus-notify.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { SlotLockService } from './slot-lock.service';
import { resolveHandoverPoint, resolveRoutePlan } from './route-matrix';

/** 仍在履约链路上的大厅状态（取消脱厅/回厅/条件状态迁移共用）。
 * 终态（delivered/cancelled/no_rider_final/exception_final）不在其中，任何写入都不应把终态单改回流转态。 */
export const ACTIVE_HALL_STATUSES = [
    'open', 'pending_merchant', 'accepted', 'scheduled', 'grabbed', 'third_party',
    'merchant_delivering', 'owned_pool', 'owned_dispatched', 'pending_dispatch',
];

/** customFields 字段名 → 物理列名（Vendure 规则：customFields + 首字母大写 + 其余小写）
 * 例：hallStatus → customFieldsHallstatus；thirdPartyDispatchAt → customFieldsThirdpartydispatchat */
const orderColumn = (field: string) => `"customFields${field.charAt(0).toUpperCase()}${field.slice(1).toLowerCase()}"`;

/**
 * 入厅服务：跑腿单（orderKind='errand'）或路线 R1/R3 的订单在**支付成功后**自动进入抢单大厅。
 * 含预约时段锁位（T0 前置）：锁位失败标 campusCause='slot_full'，靠调度告警人工跟进。
 * 支付闸门：由插件订阅 PaymentStateTransitionEvent（Authorized/Settled）触发，未支付订单不进大厅、不可被抢。
 */
@Injectable()
export class HallService {
    /** 预约单放量窗口：scheduledFor 前 30min 才进入商家确认/抢单大厅（plan 3.1） */
    static readonly SCHEDULE_RELEASE_MIN = 30;

    /** R5 交接码重发限流：同单 10 分钟一次（M4 经 dedupe 跨实例；未注入时退回进程内 Map） */
    static readonly HANDOVER_RESEND_INTERVAL_MS = 10 * 60_000;
    private handoverResendAt = new Map<number, number>();

    constructor(
        private connection: TransactionalConnection,
        private slotLock: SlotLockService,
        private moduleRef: ModuleRef,
        private capacity: CapacityService,
        private feishu?: FeishuNotifyService,
        private notify?: CampusNotifyService,
        /** M4 跨实例限频（多实例部署时同单重发不串号）；未注入退回进程内 Map */
        private dedupe?: CampusDedupeService,
    ) {}

    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private get injector(): Injector {
        return new Injector(this.moduleRef);
    }

    /** 收货楼栋坐标（用于挑最近交接点）；楼栋未配坐标返回 null */
    private async resolveDestPoint(
        ctx: RequestContext,
        order: Order,
    ): Promise<{ lat: number; lng: number } | null> {
        const cf = order.customFields as any;
        const buildingId = cf?.buildingId ?? (order.shippingAddress?.customFields as any)?.buildingId;
        if (!buildingId) return null;
        const b = await this.connection
            .getRepository(ctx, CampusBuilding)
            .findOne({ where: { id: Number(buildingId) as any } });
        if (!b || b.lat == null || b.lng == null) return null;
        return { lat: Number(b.lat), lng: Number(b.lng) };
    }

    /** 预约单时段文本（'2026-10-06 11:00-11:30' 或 '11:00-11:30'）解析时长；无法解析返回 null。
     *  支持跨天时段（如 '23:30-00:10'）：结束时间不大于开始时间时视为次日。 */
    static slotSpanMinutes(text: string): number | null {
        const m = /(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})/.exec(text);
        if (!m) return null;
        const start = Number(m[1]) * 60 + Number(m[2]);
        const end = Number(m[3]) * 60 + Number(m[4]);
        const span = (end <= start ? end + 24 * 60 : end) - start;
        return span > 0 && span <= 12 * 60 ? span : null;
    }

    /**
     * 承诺送达时间（支付时固化，超时赔付判定基准）：
     * - 预约单：时段结束时间（文本解析失败退回「时段开始 + 配送时长」）
     * - 即时单：支付时间 + 店铺配送时长（未配置按 40min）
     */
    private resolvePromise(cf: any, cfg?: CampusFulfillmentConfig | null): { at: Date; source: string } {
        const minutes = Math.max(10, Number(cfg?.deliveryMinutes ?? 40));
        const start = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
        if (!Number.isNaN(start)) {
            const span = HallService.slotSpanMinutes(String(cf.deliverySlotText ?? ''));
            return { at: new Date(start + (span ?? minutes) * 60_000), source: span ? 'slot' : 'slot_estimate' };
        }
        return { at: new Date(Date.now() + minutes * 60_000), source: 'store_minutes' };
    }

    async onOrderPlaced(ctx: RequestContext, orderInput: Order) {
        // 支付事件（Authorized → Settled）可能连发两次：以 DB 当前值为准做幂等闸，
        // 事件里的实体快照不含上一次订阅写入的 customFields。
        // 读不到时退回事件实体（正常流程订单必然存在，兜底避免事件对象为空导致漏入厅）。
        // shippingAddress 在本 fork 中被改为 simple-json 列（非 relation），
        // 放进 relations 会抛 EntityPropertyNotFoundError；普通列默认随查询返回，直接读即可。
        const fresh = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderInput.id as any },
        });
        const order = fresh ?? orderInput;
        if (order.state === 'Cancelled') return;
        const cf = order.customFields as any;
        if (cf.hallStatus) return; // 已入厅（或已挂 scheduled），幂等跳过
        const isErrand = cf.orderKind === 'errand';
        const route = String(cf.fulfillmentRoute ?? (isErrand ? 'R5' : ''));
        // 需要派单的只有 R1/R2/R3；R4 到店自取、R5 跑腿走原链路
        if (!isErrand && !['R1', 'R2', 'R3'].includes(route)) return;

        const cfg = await this.connection
            .getRepository(ctx, CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId as any } });
        const plan = resolveRoutePlan(route, cfg ?? {});
        // R1/R2 恒接力，必须有校园交接点；缺失则降级为传信者到店取餐直送（不能让订单卡住）
        const needsPoint = route === 'R1' || route === 'R2';
        // 多交接点时按收货楼栋坐标取最近；楼栋无坐标退回该路线默认点
        const dest = needsPoint ? await this.resolveDestPoint(ctx, order) : null;
        const point = needsPoint ? resolveHandoverPoint(route as 'R1' | 'R2', cfg ?? {}, dest) : null;
        const degrade = needsPoint && !point;
        const promise = this.resolvePromise(cf, cfg);
        // 履约快照：下单时冻结，后续配置变更不影响在途单
        const snapshot = {
            deliveryPlan: degrade ? 'campus_rider' : (plan?.leg1 ?? 'campus_rider'),
            handoverMode: degrade ? '' : (plan?.handover ?? ''),
            thirdPartyProvider: '',
            handoverPointName: point?.name ?? '',
            handoverPointAddress: point?.address ?? '',
            handoverPointLat: point?.lat ?? null,
            handoverPointLng: point?.lng ?? null,
            promisedAt: promise.at,
            promiseSource: promise.source,
            ...(degrade ? { campusCause: 'no_handover_point' } : {}),
        };
        // 降级不能静默（P1）：运费按 R1/R2 收、实际按 campus_rider 直送，必须让运营可见并人工兜底。
        if (degrade) {
            Logger.error(
                `Order ${order.code} ${route} degraded to campus_rider: no usable handover point`,
                'CampusHall',
            );
            void this.feishu?.pushEvent(
                'alert',
                '交接点缺失，订单已降级',
                `订单 ${order.code}（${route}）缺少 ${route} 校园交接点，已降级为传信者到店直送。请补齐交接点配置，并视情况退还运费差价。`,
                order.code,
                `degrade:${order.code}`,
            );
        }
        const locked = await this.slotLock.lock(ctx, order);
        const scheduledAt = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
        const deferred =
            !Number.isNaN(scheduledAt) && scheduledAt - Date.now() > HallService.SCHEDULE_RELEASE_MIN * 60_000;
        // 入厅条件写（CAS）：仅当 hallStatus 仍为空且订单未取消才写入。
        // 先读后写的无条件 update 会与用户取消并发：取消事件把 hallStatus 置 cancelled 后，
        // 本次写入仍会把已退款单复活成 open/pending_merchant，商家工作台按 hallStatus 查询即会显示已取消单。
        const enter = async (patch: Record<string, unknown>): Promise<boolean> => {
            const entered = await this.transitionFrom(ctx, Number(order.id), [''], {
                ...snapshot,
                ...(locked || snapshot.campusCause ? {} : { campusCause: 'slot_full' }),
                ...patch,
            });
            if (!entered) {
                // 已取消/已入厅：归还本次可能占用的时段容量，避免取消竞态造成名额泄漏
                await this.slotLock.unlock(ctx, Number(order.id)).catch(() => undefined);
                Logger.warn(`Order ${order.code} enter hall skipped (cancelled or already entered)`, 'CampusHall');
            }
            return entered;
        };

        // R1：商户/自营快递先完成第一段（送到校园交接点），出餐后由商家工作台分流
        if (route === 'R1' && !degrade) {
            if (deferred) {
                await enter({ hallStatus: 'scheduled' });
                return;
            }
            if (await enter({ hallStatus: 'pending_merchant' })) {
                Logger.info(`Order ${order.code} awaiting merchant (R1/${snapshot.deliveryPlan})`, 'CampusHall');
            }
            return;
        }

        // R2：固定外部快递，但必须先经商户接单/出餐（出餐闸门），cookingDone 后才推送外部快递
        if (route === 'R2' && !degrade) {
            if (await enter({ hallStatus: deferred ? 'scheduled' : 'pending_merchant' })) {
                Logger.info(`Order ${order.code} awaiting merchant (R2 cooking gate)`, 'CampusHall');
            }
            return;
        }

        // R3：一段到底，按第一段进入对应池
        const leg1 = String(snapshot.deliveryPlan);
        if (deferred) {
            await enter({ hallStatus: 'scheduled' });
            return;
        }
        if (leg1 === 'external_courier') {
            if (await enter({ hallStatus: 'pending_dispatch' })) {
                Logger.info(`Order ${order.code} awaiting external push (R3)`, 'CampusHall');
            }
            return;
        }
        if (leg1 === 'owned') {
            if (await enter({ hallStatus: 'owned_pool' })) {
                Logger.info(`Order ${order.code} in owned pool (R3)`, 'CampusHall');
            }
            return;
        }
        if (cfg?.merchantConfirmEnabled) {
            await enter({ hallStatus: 'pending_merchant' });
            return;
        }
        if (!(await enter({ hallStatus: 'open', hallEnteredAt: new Date() }))) return;
        Logger.info(`Order ${order.code} entered hall (${route}, slotLocked=${locked})`, 'CampusHall');
        this.notifyRiders(ctx, order);
    }

    /** 预约单放量（调度 job 调用，plan 3.1）：按路由/快照分流。
     * 放量即写 hallEnteredAt 作为「商家/运力计时锚点」：预约单 createdAt 可能早于放量数小时甚至数天，
     * 若下游超时兜底沿用 createdAt，一放量就会被判定超时（R1 直接转自营、R2 直接进大厅、跳过商家确认）。
     * 条件写（仅 scheduled 态）：与用户取消并发时不把已取消单复活。返回是否真正放量。 */
    async releaseScheduled(ctx: RequestContext, order: Order, cfg: CampusFulfillmentConfig | null): Promise<boolean> {
        const cf = order.customFields as any;
        const next = HallService.releaseTarget(cf, cfg);
        const released = await this.transitionFrom(ctx, Number(order.id), ['scheduled'], {
            hallStatus: next,
            hallEnteredAt: new Date(),
        });
        if (!released) {
            Logger.info(`Order ${order.code} scheduled release skipped (hall status changed)`, 'CampusHall');
            return false;
        }
        Logger.info(`Order ${order.code} scheduled → ${next}`, 'CampusHall');
        // 无人接单的渠道保持原行为：放量即提醒在线骑手
        if (next === 'open' || next === 'owned_pool') this.notifyRiders(ctx, order);
        return true;
    }

    /** 放量目标态（put 与调度 job 共用；job 用它在内存里同步订单快照，避免同轮二次误判） */
    static releaseTarget(cf: any, cfg: CampusFulfillmentConfig | null): string {
        const route = String(cf.fulfillmentRoute ?? '');
        if (route === 'R1' || route === 'R2') return 'pending_merchant'; // 出餐闸门：先等商户接单/出餐
        if (cf.deliveryPlan === 'external_courier') return 'pending_dispatch';
        if (cf.deliveryPlan === 'owned') return 'owned_pool';
        return cfg?.merchantConfirmEnabled ? 'pending_merchant' : 'open';
    }

    /** 第一段交接完成：订单进校园抢单大厅（R1/R2 接力上楼）。
     * 条件写（CAS）：仅当 hallStatus 仍在 from 集合内（本段确实在途）才入厅并生成交接码，
     * 否则说明订单已被取消/已入厅（并发回调），返回空串由调用方决定是否报错。
     * extra 承载调用方需要同语句落库的附加字段（如 handoverAt/thirdPartyState），避免两步写。
     * 同时生成 4 位交接码（第二段骑手取货时校验，防丢餐扯皮），返回码值供调用方通知用户。 */
    async enterHallForHandover(
        ctx: RequestContext,
        orderId: number,
        cause: string,
        from: string[] = ['third_party', 'merchant_delivering', 'owned_dispatched'],
        extra: Record<string, unknown> = {},
    ): Promise<string> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['channels'],
        });
        if (!order) {
            Logger.warn(`enterHallForHandover 订单不存在 #${orderId}`, 'CampusHall');
            return '';
        }
        const handoverCode = String(Math.floor(1000 + Math.random() * 9000));
        const moved = await this.transitionFrom(ctx, orderId, from, {
            ...extra,
            hallStatus: 'open',
            hallEnteredAt: new Date(),
            deliveryStatus: 'pending',
            assignedAt: null,
            deliveryStaffId: null,
            campusCause: cause,
            handoverCode,
            handoverCodeAt: new Date(),
        });
        if (!moved) {
            Logger.warn(
                `订单 ${order.code} 交接入厅被跳过（已取消或状态已变更，from=${from.join('/')}）`,
                'CampusHall',
            );
            return '';
        }
        this.notifyRiders(ctx, order);
        // 第一段交接完成：给顾客一个明确节点（餐/包裹已到校园交接点，等待骑手接力）
        const point = String((order.customFields as any)?.handoverPointName ?? '校园交接点');
        this.notify?.user(ctx, order.id, 'arrivedHandover', point);
        Logger.info(`订单 ${order.code} 交接完成进入大厅 (${cause})，交接码已生成并脱敏`, 'CampusHall');
        return handoverCode;
    }

    /**
     * R5 交接码重发（飞书指令 / 顾客侧共用）。
     * 条件写（CAS）：仅当 hallStatus='open' 且订单未取消才更新，避免把已完成/已脱厅订单的码改掉。
     * 限流：同单 10 分钟一次；返回新码（调用方自行决定是否展示，日志不落明文）。
     */
    async resendHandoverCode(ctx: RequestContext, orderId: number): Promise<string> {
        const key = Number(orderId);
        await this.claimResendWindow(key);
        const handoverCode = String(Math.floor(1000 + Math.random() * 9000));
        const res: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsHandovercode" = $1, "customFieldsHandovercodeat" = $2 '
            + 'WHERE id = $3 AND "customFieldsHallstatus" = $4 AND "state" <> $5 RETURNING id',
            [handoverCode, new Date(), key, 'open', 'Cancelled'],
        );
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            // 状态不符不占用限流窗口（与原「成功后登记」语义一致）
            await this.dedupe?.del(`handover_resend:${key}`);
            throw new UserInputError('订单当前不在待交接状态，无法重发交接码');
        }
        this.handoverResendAt.set(key, Date.now());
        Logger.info(`订单 #${key} 交接码已重发（脱敏）`, 'CampusHall');
        return handoverCode;
    }

    /** 同单 10min 限流：dedupe 走原子计数（跨实例），未注入退回进程内 Map */
    private async claimResendWindow(orderId: number): Promise<void> {
        if (!this.dedupe) {
            const last = this.handoverResendAt.get(orderId);
            if (last != null && Date.now() - last < HallService.HANDOVER_RESEND_INTERVAL_MS) {
                throw new UserInputError('交接码重发过于频繁，请 10 分钟后再试');
            }
            return;
        }
        const n = await this.dedupe.incr(
            `handover_resend:${orderId}`,
            HallService.HANDOVER_RESEND_INTERVAL_MS,
        );
        if (n > 1) throw new UserInputError('交接码重发过于频繁，请 10 分钟后再试');
    }

    /** R5 顾客侧重发：先校验订单归属当前登录顾客，再复用同一条件写。 */
    async resendHandoverCodeForCustomer(ctx: RequestContext, orderId: number): Promise<string> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['customer', 'customer.user'],
        });
        const ownerUserId = (order?.customer as any)?.user?.id;
        if (!order || ownerUserId == null || Number(ownerUserId) !== Number(ctx.activeUserId)) {
            throw new UserInputError('订单不存在或不属于当前顾客');
        }
        const code = await this.resendHandoverCode(ctx, orderId);
        // G4 审计：顾客自助重发留痕（不记录明文交接码）
        Logger.info(`顾客重发交接码 order=${orderId} user=${ctx.activeUserId}`, 'CampusHall');
        return code;
    }

    /** 回大厅：清骑手指派字段，hallStatus 复位 open（拒单/超时改派共用）。
     *  条件写：仅活跃流转态可回厅，已取消/已终态单不被复活；extra 与复位字段同语句落库（后台强制回厅留痕）。
     *  返回是否命中。 */
    async backToHall(
        ctx: RequestContext,
        orderId: number,
        extra?: Record<string, unknown>,
    ): Promise<boolean> {
        return this.transitionFrom(ctx, orderId, ACTIVE_HALL_STATUSES, {
            ...(extra ?? {}),
            hallStatus: 'open',
            deliveryStaffId: null,
            deliveryStatus: null,
            assignedAt: null,
        });
    }

    /**
     * 条件状态迁移（CAS）：仅当 hallStatus 仍在 from 集合内、且订单未被取消时才写入 patch，返回 affected>0。
     * 调度扫描/商家操作都是「先读后写」，若期间用户取消并脱厅（hallStatus=cancelled），
     * 无条件 update 会把已退款单改回 open/pending_merchant 重新进入大厅被抢。
     * 额外加 state != 'Cancelled'：取消事件异步写完 hallStatus 前仍有窗口，仅凭 hallStatus 条件不足。
     * 用单条 UPDATE + 条件把「校验与写入」合并成一个原子动作。
     */
    async transitionFrom(
        _ctx: RequestContext,
        orderId: number,
        from: string[],
        patch: Record<string, unknown>,
    ): Promise<boolean> {
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (!entries.length || !from.length) return false;
        const sets = entries.map(([k], i) => `${orderColumn(k)} = $${i + 2}`).join(', ');
        const values = entries.map(([, v]) => (Array.isArray(v) ? JSON.stringify(v) : v));
        const out: any = await this.connection.rawConnection.query(
            `UPDATE "order" SET ${sets} `
            + `WHERE id = $1 AND COALESCE("customFieldsHallstatus", '') = ANY($${entries.length + 2}::text[]) `
            + `AND "state" <> 'Cancelled' `
            + 'RETURNING id',
            [orderId, ...values, from],
        );
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        return Array.isArray(rows) && rows.length > 0;
    }

    /** 取消脱厅（3.3 冒烟实测缺陷）：订单取消终态时清 hallStatus，使其退出大厅/打包扫描/整组抢单/调度台。
     * 单条条件写：仅活跃流转态可脱厅——先读后写会被 T4 mark() 写 no_rider_final 的竞态覆盖；
     * grabbed 单连带清骑手指派字段（CASE 表达式读同一语句的旧值）。 */
    async exitHall(_ctx: RequestContext, order: Order) {
        const hsCol = orderColumn('hallStatus');
        const clearIfGrabbed = (field: string) =>
            `${orderColumn(field)} = CASE WHEN ${hsCol} = 'grabbed' THEN NULL ELSE ${orderColumn(field)} END`;
        const out: any = await this.connection.rawConnection.query(
            `UPDATE "order" SET ${hsCol} = 'cancelled', `
            + `${clearIfGrabbed('deliveryStaffId')}, ${clearIfGrabbed('deliveryStatus')}, `
            + `${clearIfGrabbed('assignedAt')} `
            + `WHERE id = $1 AND COALESCE(${hsCol}, '') = ANY($2::text[]) RETURNING id`,
            [order.id, ACTIVE_HALL_STATUSES],
        );
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        if (!Array.isArray(rows) || !rows.length) return;
        Logger.info(`Order ${order.code} exited hall (→ cancelled)`, 'CampusHall');
    }

    /** 通用订单更新（T4 退款终态标记等复用） */
    updateOrder(ctx: RequestContext, orderId: number, patch: any) {
        return this.connection.getRepository(ctx, Order).update(orderId, patch as any);
    }

    /** T0: 新单入厅即提醒在线骑手（订阅消息），失败只记日志不阻塞入厅。
     * 模板 ID 复用渠道 orderShippedTemplateId（wechat 插件未定义 campus 专用模板字段），
     * 未配置则跳过；逐骑手发送，单个失败不影响其余骑手。 */
    private notifyRiders(ctx: RequestContext, order: Order) {
        void (async () => {
            try {
                const templateId = ((ctx.channel as any)?.customFields ?? {}).orderShippedTemplateId as
                    | string
                    | undefined;
                if (!templateId) {
                    Logger.debug(
                        `Channel ${ctx.channelId} has no orderShippedTemplateId, skip rider notify`,
                        'CampusHall',
                    );
                    return;
                }
                const msg = this.injector.get(SubscribeMessageService);
                const riders = await this.capacity.listOnlineRiders(ctx);
                for (const r of riders) {
                    try {
                        await msg.sendCustomMessage(ctx, r.id as any, templateId, {
                            orderCode: { value: order.code },
                            zone: { value: (order.customFields as any).campusZone ?? '' },
                        });
                    } catch (e: any) {
                        Logger.warn(`rider notify failed (customer ${r.id}): ${e?.message}`, 'CampusHall');
                    }
                }
            } catch (e: any) {
                Logger.warn(`rider notify failed: ${e?.message}`, 'CampusHall');
            }
        })();
    }
}
