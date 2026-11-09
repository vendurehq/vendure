import { Injectable, Logger } from '@nestjs/common';
import {
    ForbiddenError,
    ID,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    Customer,
} from '@vendure/core';
import { getCouponBalancePort } from '@vendure/coupon-plugin';
import { CampusBuilding } from './campus-building.entity';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusDedupeService } from './campus-dedupe.service';
import { CampusNotifyService } from './campus-notify.service';
import { ERRAND_TIP_SURCHARGE_DESC } from './errand.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { isHandoverCodeExpired, generateHandoverCode } from './handover-code';
import { HallService } from './hall.service';
import { PrivacyNumberService } from './privacy-number.service';
import { CREDIT_COMPLETE, RiderCreditService } from './rider-credit.service';
import { RiderEarning } from './rider-earning.entity';
import { RiderService } from './rider.service';
import { CodCollectionService } from './cod-receipt.service';

/** 校园骑手平均速度（m/s）：约 15km/h，用于 ETA 粗估 */
const RIDER_SPEED_MPS = 4.2;

/** 交接码连续错误上限 / 锁定时长（进程内计数，pm2 单实例足够）；有效期见 handover-code.ts */
const HANDOVER_MAX_FAILS = 5;
const HANDOVER_LOCK_MS = 10 * 60_000;

/** 骑手异常上报类型白名单（与 H5 上报面板四类一致）：防任意字符串污染调度墙与追责记录 */
const EXCEPTION_TYPES = ['merchant_issue', 'no_recipient', 'food_spilled', 'other'];

/** 球面直线距离（米），gcj02 下作为短距离估算足够 */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

@Injectable()
export class RiderTaskService {
    /** A3：骑手主动重发交接码的限频窗口（同单 3 分钟）；跨实例用 dedupe，未注入时退回进程内 Map */
    static readonly HANDOVER_RIDER_RESEND_MS = 3 * 60_000;

    /** 交接码连续错误计数 / 锁止截止时间（orderId 维度；M5 经 dedupe 跨实例，未注入时退回进程内 Map） */
    private handoverFails = new Map<number, number>();
    private handoverLockUntil = new Map<number, number>();
    /** 进程内重发限频（未注入 dedupe 时使用） */
    private riderResendAt = new Map<number, number>();

    constructor(
        private connection: TransactionalConnection,
        private riderService: RiderService,
        private credit: RiderCreditService,
        private hall: HallService,
        private notify: CampusNotifyService,
        private privacy: PrivacyNumberService,
        private feishu?: FeishuNotifyService,
        /** M5 跨实例交接码防爆破（多实例下失败计数与锁止共享）；未注入退回进程内 Map */
        private dedupe?: CampusDedupeService,
        /** COD 现金收款台账；未注入时送达不做收款登记（降级） */
        private codCollection?: CodCollectionService,
    ) {}

    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，真实号不出服务端。
     * 未开启号码保护时返回真实号（行为与旧版一致），前端统一用 display/callable 展示与拨号。 */
    async customerContact(ctx: RequestContext, orderId: ID) {
        const order = await this.assertOwner(ctx, orderId);
        const withCustomer = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: order.id as any },
            relations: ['customer'],
        });
        const phone = withCustomer?.customer?.phoneNumber ?? null;
        return this.privacy.resolve(ctx, {
            channelId: ctx.channelId,
            orderCode: withCustomer?.code ?? order.code,
            phone,
        });
    }

    /** 订单骑手卡信息：C 端订单跟踪轮询用。未指派返回 null。
     * 位置（plan 2.2）：仅配送中（assigned/in_progress）返回，送达/异常/转单不暴露（隐私）。
     * 跟踪页：附带目标楼栋坐标与直线距离/ETA（楼栋无坐标时均为 null，前端降级）。
     * 归属校验：仅下单人本人可查（原实现可越权读任意订单骑手位置）。 */
    async orderRider(ctx: RequestContext, orderId: ID) {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const order = await this.connection
            .getRepository(ctx, Order)
            .findOne({ where: { id: orderId as any }, relations: ['customer'] });
        if (!order) return null;
        // Customer 实体无 userId 标量属性（user 关系 eager），归属比对取 user.id
        if (order.customer?.user?.id !== ctx.activeUserId) throw new ForbiddenError();
        const cf = (order.customFields ?? {}) as any;
        const riderId = Number(cf.deliveryStaffId ?? NaN);
        if (!riderId) return null;
        const rider = await this.connection.getRepository(ctx, Customer).findOne({ where: { id: riderId } });
        if (!rider) return null;
        const rcf = (rider.customFields ?? {}) as any;
        const locating = cf.deliveryStatus === 'assigned' || cf.deliveryStatus === 'in_progress';
        // 显式判空：Number(null) === 0 会把「从未上报」误判为 (0,0)
        const hasReport = cf.riderLat != null && cf.riderLng != null;
        const lat = hasReport ? Number(cf.riderLat) : NaN;
        const lng = hasReport ? Number(cf.riderLng) : NaN;
        const location = locating && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

        const buildingId = Number(cf.buildingId ?? NaN);
        let destination: { name: string; detail: string | null; lat: number; lng: number } | null = null;
        if (buildingId) {
            const building = await this.connection
                .getRepository(ctx, CampusBuilding)
                .findOne({ where: { id: buildingId as any } });
            if (building && building.lat != null && building.lng != null) {
                destination = {
                    name: building.name,
                    detail: building.detail ?? null,
                    lat: Number(building.lat),
                    lng: Number(building.lng),
                };
            }
        }
        const distanceMeters = location && destination ? Math.round(haversineMeters(location, destination)) : null;
        // 快速估算：校园电瓶车约 15km/h（4.2m/s）；<30m 视为即将送达
        const etaMinutes =
            distanceMeters == null ? null : distanceMeters < 30 ? 0 : Math.max(1, Math.ceil(distanceMeters / RIDER_SPEED_MPS / 60));

        return {
            realName: rcf.riderRealName ?? '骑手',
            credit: rcf.riderCredit ?? 100,
            // 隐私：骑手手机号不向顾客侧透出，与 resolver 契约「姓名+信用分，不含联系方式」保持一致
            phone: null,
            location,
            destination,
            distanceMeters,
            etaMinutes,
            deliveryStatus: cf.deliveryStatus ?? null,
        };
    }

    /** 骑手位置上报：本人订单 + 仅 assigned/in_progress 可写（plan 2.2，10s/次）。 */
    async reportLocation(ctx: RequestContext, orderId: ID, lat: number, lng: number) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new UserInputError('位置坐标不合法');
        }
        const order = await this.assertOwner(ctx, orderId);
        const cf = (order.customFields ?? {}) as any;
        // 条件写（P3）：与改派/取消并发时，旧骑手不得覆盖新骑手位置，也不得写已终态单
        const res: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsRiderlat" = $1, "customFieldsRiderlng" = $2 '
            + 'WHERE id = $3 AND "customFieldsDeliverystaffid" = $4 '
            + 'AND "customFieldsDeliverystatus" = ANY($5::text[]) AND "state" <> \'Cancelled\' RETURNING id',
            [lat, lng, order.id, String(cf.deliveryStaffId ?? ''), ['assigned', 'in_progress']],
        );
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new UserInputError('订单已被取消或改派，无法上报位置');
        }
        // P8-4 轨迹留痕：实时位置（Order.customFields）送达即清空，历史点位落 campus_rider_location。
        // 同单 5s 内重复上报不落库（骑手端 10s/次，防重试/多端并发撑大表）；
        // 留痕失败绝不影响实时上报（C 端跟踪优先），仅告警供排查。
        try {
            await this.connection.rawConnection.query(
                'INSERT INTO campus_rider_location '
                + '("createdAt", "updatedAt", "channelId", "orderId", "riderCustomerId", lat, lng, "reportedAt") '
                + 'SELECT now(), now(), $1, $2, $3, $4, $5, now() '
                + 'WHERE NOT EXISTS (SELECT 1 FROM campus_rider_location '
                + `WHERE "orderId" = $2 AND "reportedAt" > now() - interval '5 seconds')`,
                [ctx.channelId, order.id, Number(cf.deliveryStaffId), lat, lng],
            );
        } catch (e: any) {
            Logger.warn(`骑手轨迹留痕失败 order=${order.id}: ${e?.message ?? e}`, 'RiderTask');
        }
        return order;
    }

    /** 用户催单（plan 2.4）：仅下单人本人；校园履约单未终态可催（含待接单/大厅阶段）；10min 内重复催单拒绝。
     * 一期催单不推送骑手（骑手端任务卡轮询读 customFields.urged 显示提醒），大厅阶段由调度墙「顾客催单」告警提示运营。 */
    async urgeOrder(ctx: RequestContext, orderId: ID) {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const order = await this.connection
            .getRepository(ctx, Order)
            .findOne({ where: { id: orderId as any }, relations: ['customer'] });
        const cf = (order?.customFields ?? {}) as any;
        const hallStatus = String(cf.hallStatus ?? '');
        const activeHall = [
            'scheduled', 'pending_merchant', 'accepted', 'open', 'grabbed',
            'pending_dispatch', 'third_party', 'owned_pool', 'owned_dispatched', 'merchant_delivering',
        ].includes(hallStatus);
        if (!order || (!cf.deliveryStatus && !activeHall)) {
            throw new UserInputError('订单不存在或不在配送流程中');
        }
        // Customer 实体无 userId 标量属性（user 关系 eager），归属比对取 user.id
        if (order.customer?.user?.id !== ctx.activeUserId) {
            throw new ForbiddenError();
        }
        const status = cf.deliveryStatus as string;
        if (status === 'delivered' || status === 'exception' || hallStatus === 'delivered'
            || hallStatus === 'cancelled' || hallStatus === 'no_rider_final' || hallStatus === 'exception_final') {
            throw new UserInputError('当前状态无需催单');
        }
        const last = cf.urgedAt ? new Date(cf.urgedAt).getTime() : 0;
        if (Date.now() - last < 10 * 60 * 1000) {
            throw new UserInputError('已收到催单，请耐心等待');
        }
        await this.connection.getRepository(ctx, Order).update(order.id, {
            customFields: { urged: true, urgedAt: new Date() },
        } as any);
        return order;
    }

    /** 我的任务：本骑手名下已进入配送流程的订单，按下单时间倒序。
     * customFields 为嵌入式物理列，QueryBuilder 用 embedded 路径 order.customFields.deliveryStaffId
     * （与 delivery-plugin 写法一致），裸列 order.deliveryStaffId 在 PG 不存在。
     * 渠道过滤：Order 无标量 channelId，join order.channels 过滤 channel.id（同 hall()）。 */
    async myTasks(ctx: RequestContext, status?: string) {
        const rider = await this.riderService.assertApprovedRider(ctx);
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId as any })
            .andWhere('order.customFields.deliveryStaffId = :id', { id: String(rider.id) })
            .andWhere('order.customFields.deliveryStatus IS NOT NULL');
        if (status) {
            qb.andWhere('order.customFields.deliveryStatus = :s', { s: status });
        }
        return qb.orderBy('order.createdAt', 'DESC').getMany();
    }

    /** 转单回大厅：assigned 未取货直接回；in_progress 已取货必须拍照交接存证。
     * 回大厅复用 backToHall（清骑手指派、hallStatus 复位 open），存证写 transferPhotos。
     * 一期转单不扣信用分（规则后续租户可配）。 */
    async transfer(ctx: RequestContext, orderId: ID, photos: string[], note?: string) {
        const order = await this.assertOwner(ctx, orderId);
        const status = (order.customFields as any).deliveryStatus;
        if (status === 'in_progress' && !photos?.length) {
            throw new UserInputError('已取货转单需拍照交接');
        }
        if (status !== 'assigned' && status !== 'in_progress') {
            throw new UserInputError('当前状态不允许转单');
        }
        // 条件回厅：订单若已被取消/退款脱厅（hallStatus 已终态），不得再改回 open 复活。
        // 位置残留/交接存证与回厅字段同语句写入（CAS 单次 UPDATE），避免两次写之间被取消/改派插入造成半更新。
        const back = await this.hall.backToHall(ctx, order.id as any, {
            // 转单即清除位置残留（plan 2.2 隐私：位置只跟随当前配送骑手）
            riderLat: null,
            riderLng: null,
            ...(photos?.length
                ? {
                    // transferPhotos 是 string[] 自定义字段（物理列为 simple-array，逗号分隔）：
                    // 走原生 SQL 必须自己按该格式序列化，不能传数组（transitionFrom 会 JSON 序列化导致回读异常）
                    transferPhotos: photos.join(','),
                    transferNote: note ?? null,
                    transferAt: new Date(),
                }
                : {}),
        });
        if (!back) throw new UserInputError('订单已被取消或改派，无法转单');
        return order;
    }

    /** 开始配送：assigned → in_progress。
     * 两段接力单（R1/R2 第一段已送达交接点并生成了 handoverCode）必须校验交接码，防丢餐扯皮。 */
    async start(ctx: RequestContext, orderId: ID, code?: string) {
        const order = await this.assertOwner(ctx, orderId, 'assigned');
        const cf = (order.customFields ?? {}) as any;
        const expected = String(cf.handoverCode ?? '');
        if (expected) {
            const orderKey = Number(order.id);
            if (isHandoverCodeExpired(cf.handoverCodeAt)) {
                throw new UserInputError('交接码已过期，请联系交接点重新核对');
            }
            if (await this.handoverLocked(orderKey)) {
                throw new UserInputError('交接码错误次数过多，请 10 分钟后再试');
            }
            if (String(code ?? '').trim() !== expected) {
                await this.recordHandoverFail(orderKey);
                throw new UserInputError('交接码不正确，请与交接点核对后重试');
            }
            await this.clearHandoverGuard(orderKey);
        }
        // 条件写（P2-3）：与用户取消/运营改派并发时，不得把已脱厅/已取消单改成 in_progress
        const res: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsDeliverystatus" = $1 '
            + 'WHERE id = $2 AND "customFieldsDeliverystatus" = $3 '
            + 'AND "customFieldsDeliverystaffid" = $4 AND "customFieldsHallstatus" = $5 '
            + `AND "state" <> 'Cancelled' RETURNING id`,
            ['in_progress', order.id, 'assigned', String(cf.deliveryStaffId ?? ''), 'grabbed'],
        );
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new UserInputError('订单已被取消或改派，无法开始配送');
        }
        return order;
    }

    /** R5 交接码重发后清空该单错误计数与锁定（新码生效，旧失败次数不应继续累计） */
    async resetHandoverGuard(orderId: ID): Promise<void> {
        await this.clearHandoverGuard(Number(orderId));
    }

    /** 是否处于交接码锁止期（跨实例：dedupe 优先，未注入退回进程内 Map） */
    private async handoverLocked(orderKey: number): Promise<boolean> {
        if (this.dedupe) return this.dedupe.seen(`handover_lock:${orderKey}`, HANDOVER_LOCK_MS);
        const until = this.handoverLockUntil.get(orderKey);
        return until != null && until > Date.now();
    }

    /** 记一次交接码错误；达到阈值转为 10 分钟锁止 */
    private async recordHandoverFail(orderKey: number): Promise<void> {
        if (this.dedupe) {
            const fails = await this.dedupe.incr(`handover_fail:${orderKey}`, HANDOVER_LOCK_MS);
            if (fails >= HANDOVER_MAX_FAILS) {
                await this.dedupe.mark(`handover_lock:${orderKey}`, HANDOVER_LOCK_MS);
                await this.dedupe.del(`handover_fail:${orderKey}`);
            }
            return;
        }
        const fails = (this.handoverFails.get(orderKey) ?? 0) + 1;
        if (fails >= HANDOVER_MAX_FAILS) {
            this.handoverFails.delete(orderKey);
            this.handoverLockUntil.set(orderKey, Date.now() + HANDOVER_LOCK_MS);
        } else {
            this.handoverFails.set(orderKey, fails);
        }
    }

    private async clearHandoverGuard(orderKey: number): Promise<void> {
        this.handoverFails.delete(orderKey);
        this.handoverLockUntil.delete(orderKey);
        if (this.dedupe) {
            await this.dedupe.del(`handover_fail:${orderKey}`);
            await this.dedupe.del(`handover_lock:${orderKey}`);
        }
    }

    /** 交接码读取（R1/R2 第二段起送必填）：仅本单骑手、assigned/in_progress 可读。
     *  原实现交接码只写入不暴露，骑手只能线下向交接点口头索取，取不到就卡在 grabbed 直到超时回厅。 */
    async handoverCode(ctx: RequestContext, orderId: ID): Promise<string | null> {
        const order = await this.assertOwner(ctx, orderId);
        const cf = (order.customFields ?? {}) as any;
        if (cf.deliveryStatus !== 'assigned' && cf.deliveryStatus !== 'in_progress') return null;
        return cf.handoverCode ? String(cf.handoverCode) : null;
    }

    /**
     * A3：骑手在「已派单、未取餐」时主动重发交接码。
     * - 复用 A2 同一生成器与 TTL（新码 10 分钟内有效）；
     * - 单条 CAS 覆盖 handoverCode/handoverCodeAt：旧码即刻失效，不存在新旧码同时可用；
     * - 限频：同单 3 分钟内只能重发一次（dedupe 跨实例计数，未注入退回进程内 Map），防无限刷新；
     * - 成功后清空交接码错误计数/锁止，避免旧码连错 5 次的锁止影响新码。
     * 仅本单骑手（assertOwner 校验归属与 assigned 状态）。
     */
    async resendHandoverCode(ctx: RequestContext, orderId: ID): Promise<string> {
        const order = await this.assertOwner(ctx, orderId, 'assigned');
        const cf = (order.customFields ?? {}) as any;
        if (!cf.handoverCode) throw new UserInputError('该订单无需交接码（非两段接力单）');
        const orderKey = Number(order.id);
        await this.claimRiderResendWindow(orderKey);
        const code = generateHandoverCode();
        const res: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsHandovercode" = $1, "customFieldsHandovercodeat" = $2 '
            + 'WHERE id = $3 AND "customFieldsDeliverystatus" = $4 '
            + 'AND "customFieldsDeliverystaffid" = $5 AND "customFieldsHallstatus" = $6 '
            + `AND "state" <> 'Cancelled' RETURNING id`,
            [code, new Date(), orderKey, 'assigned', String(cf.deliveryStaffId ?? ''), 'grabbed'],
        );
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            // 状态已变（已取餐/取消/改派）：不占用限频窗口
            await this.releaseRiderResendWindow(orderKey);
            throw new UserInputError('订单已开始配送、已取消或已改派，无法重发交接码');
        }
        await this.clearHandoverGuard(orderKey);
        Logger.log(`骑手重发交接码 order=${orderKey} rider=${cf.deliveryStaffId}（明文不落日志）`, 'RiderTask');
        return code;
    }

    /** 同单 3 分钟限频：dedupe 走原子计数（跨实例），未注入退回进程内 Map */
    private async claimRiderResendWindow(orderKey: number): Promise<void> {
        if (this.dedupe) {
            const n = await this.dedupe.incr(
                `handover_rider_resend:${orderKey}`,
                RiderTaskService.HANDOVER_RIDER_RESEND_MS,
            );
            if (n > 1) throw new UserInputError('交接码重发过于频繁，请 3 分钟后再试');
            return;
        }
        const last = this.riderResendAt.get(orderKey);
        if (last != null && Date.now() - last < RiderTaskService.HANDOVER_RIDER_RESEND_MS) {
            throw new UserInputError('交接码重发过于频繁，请 3 分钟后再试');
        }
        this.riderResendAt.set(orderKey, Date.now());
    }

    private async releaseRiderResendWindow(orderKey: number): Promise<void> {
        this.riderResendAt.delete(orderKey);
        if (this.dedupe) await this.dedupe.del(`handover_rider_resend:${orderKey}`);
    }

    /** 送达：拍照必传 → delivered → 分成入余额（0 分成单跳过入账）；COD 单需填实收金额并落收款台账 */
    async deliver(ctx: RequestContext, orderId: ID, photos: string[], note?: string, cashAmount?: number) {
        if (!photos?.length) throw new UserInputError('送达需至少一张照片');
        const order = await this.assertOwner(ctx, orderId, 'in_progress');
        const rider = await this.riderService.assertApprovedRider(ctx);
        // COD 单：送达前必须先确认实收金额（金额必填），否则不落 delivered（防「已送达但无收款」）
        const cashRequired = this.codCollection ? await this.codCollection.requiresCash(ctx, order.id) : false;
        const collected = cashAmount == null ? null : Math.round(Number(cashAmount));
        if (cashRequired && (!collected || collected <= 0)) {
            throw new UserInputError('货到付款单送达需填写实收金额（单位：分）');
        }
        // 小费以实际收取的 surcharge 为准：customFields.tip 可能因写入失败未真正计费，
        // 按 cf.tip 计分成会虚高（平台多发钱）。
        const tip = this.actualTip(order);
        const earning = this.calcEarning(order, await this.getConfig(ctx, order), tip);
        const deliveredAt = new Date();
        // 单条原子 UPDATE 完成「认领 + 终态」：deliveryStatus 条件更新与 hallStatus/照片/分成/位置清空
        // 同语句落库（原两步写在两步之间宕机会留下 delivered 但 hallStatus 仍旧态的半完成单）。
        // RETURNING id 取 affected 行数，防并发双送达 → 双分成入账（对齐 grab() 的锁语义）。
        const claimed: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsDeliverystatus" = $1, "customFieldsDeliveredat" = $2, '
            + '"customFieldsHallstatus" = $3, "customFieldsDeliveryphotos" = $4, "customFieldsDeliverynote" = $5, '
            + '"customFieldsRiderearning" = $6, "customFieldsRiderlat" = NULL, "customFieldsRiderlng" = NULL '
            // 已取消单绝不落 delivered（否则取消退款后仍会算作送达并入账分成）；
            // 同时锚定「当前仍是本人的 grabbed 单」，防改派窗口内旧骑手完成送达并领分成。
            + `WHERE id = $7 AND "customFieldsDeliverystatus" = $8 AND "customFieldsDeliverystaffid" = $9 `
            + `AND "customFieldsHallstatus" = $10 AND "state" <> 'Cancelled' RETURNING id`,
            ['delivered', deliveredAt, 'delivered', JSON.stringify(photos), note ?? null, earning, order.id, 'in_progress',
                String((order.customFields as any).deliveryStaffId ?? ''), 'grabbed'],
        );
        const claimedRows = Array.isArray(claimed) ? claimed[0] : claimed;
        if (!claimedRows?.length) throw new UserInputError('订单已被取消或处理，无法送达');
        // COD 收款台账：已送达即现金已收，登记 confirmed 收款并结算支付；失败不回滚送达（留痕待补录）
        if (cashRequired && collected && this.codCollection) {
            try {
                await this.codCollection.register(ctx, order.id, {
                    amount: collected,
                    source: 'delivery_confirm',
                    collectedByRole: 'rider',
                    collectedById: rider.id as number,
                    collectedByName:
                        [rider.firstName, rider.lastName].filter(Boolean).join(' ').trim() || null,
                    handoverCode: (order.customFields as any)?.handoverCode ?? null,
                    note: '骑手送达确认实收',
                });
            } catch (e: any) {
                Logger.error(
                    `COD 收款登记失败（订单 ${order.code ?? order.id}，实收 ${collected} 分，需人工补录）：${e?.message ?? e}`,
                    'RiderTask',
                );
                void this.feishu?.pushEvent(
                    'alert',
                    'COD 收款记录落库失败',
                    `订单 ${order.code ?? order.id} 已送达，但实收 ${collected} 分未落收款台账，请人工补录。原因：${e?.message ?? e}`,
                    order.code,
                    `cod_receipt_failed:${order.code ?? order.id}`,
                );
            }
        }
        if (earning === 0) {
            // 0 分成单：不写 earning 不调 addBalance（余额端口对 0 金额入账会抛错，
            // 且 0 金额 pending 行会在钱包补账时永久重试报错）。
            // 判据只看 earning（小费已计入 calcEarning），避免 earning=0 但 tip>0 时仍落 0 元 pending。
            Logger.log(`订单 ${order.code ?? order.id} 0 分成，跳过入账`, 'RiderTask');
        } else {
            // 先落 earning（pending），入账成功才置 credited：addBalance 失败时订单已终态、
            // 骑手重试会被状态机挡住，留 pending 供 myRiderWallet 读取时补账（避免「有分成记录但钱未到」）。
            // 外层兜底：earning 行落库失败时订单已送达（客户端重试会被状态机挡住），只记错误日志供人工补账。
            try {
                const earningRow = await this.connection.getRepository(ctx, RiderEarning).save({
                    orderId: order.id,
                    riderCustomerId: rider.id,
                    amount: earning,
                    tip,
                    status: 'pending',
                    channelId: ctx.channelId,
                } as any);
                // 行级认领后再入账（P1）：防「入账成功但置 credited 失败 → 钱包补账再次入账」与并发补账双加；
                // 认领失败说明另一路已在处理，直接跳过。
                const claimed: any = await this.connection.rawConnection.query(
                    'UPDATE rider_earning SET status = $1 WHERE id = $2 AND status = $3 RETURNING id',
                    ['crediting', earningRow.id, 'pending'],
                );
                const claimedRows = Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed;
                if (!Array.isArray(claimedRows) || !claimedRows.length) {
                    Logger.warn(`分成 ${earningRow.id} 已被另一路认领，跳过本次入账`, 'RiderTask');
                } else {
                    const port = getCouponBalancePort();
                    if (port) {
                        try {
                            await port.addBalance(ctx, rider.id as number, earning);
                            await this.connection.getRepository(ctx, RiderEarning).update(earningRow.id, {
                                status: 'credited',
                            } as any);
                        } catch (e: any) {
                            // 回 pending 供钱包补账重试（crediting 需等待超时才可重试）
                            await this.connection.getRepository(ctx, RiderEarning)
                                .update(earningRow.id, { status: 'pending' } as any)
                                .catch(() => undefined);
                            Logger.error(`分成入账失败（earning ${earningRow.id} 留 pending 待补账）：${e?.message ?? e}`, 'RiderTask');
                        }
                    } else {
                        Logger.warn('余额端口未注册，分成未入账', 'RiderTask');
                        await this.connection.getRepository(ctx, RiderEarning)
                            .update(earningRow.id, { status: 'pending' } as any)
                            .catch(() => undefined);
                    }
                }
            } catch (e: any) {
                Logger.error(
                    `分成落库失败（订单已送达 ${order.code ?? order.id}，需人工补账 ${earning} 分）：${e?.message ?? e}`,
                    'RiderTask',
                );
                // 订单已送达不可重试，分成只能人工补：仅日志会静默丢钱，必须推运营群
                void this.feishu?.pushEvent(
                    'alert',
                    '骑手分成落库失败',
                    `订单 ${order.code ?? order.id} 已送达，但分成 ${earning} 分未落库，请人工补账。原因：${e?.message ?? e}`,
                    order.code,
                    `earning_persist_failed:${order.code ?? order.id}`,
                );
            }
        }
        // 完单信用加分（+2）；非资金项，失败不阻断送达
        try {
            await this.credit.adjust(ctx, rider.id as any, CREDIT_COMPLETE, 'complete', order.id as any);
        } catch (e: any) {
            Logger.warn(`完单信用加分失败：${e?.message ?? e}`, 'RiderTask');
        }
        // 通知下单用户已送达（fire-and-forget）
        this.notify.user(ctx, order.id as any, 'orderDelivered');
        return order;
    }

    /** 异常上报：仅配送中（已接单/配送中）可上报，记录上报时间供调度扫描超时升级 */
    async reportException(ctx: RequestContext, orderId: ID, type: string, photos: string[], note?: string) {
        if (!EXCEPTION_TYPES.includes(String(type ?? ''))) {
            throw new UserInputError('异常类型不合法');
        }
        const order = await this.assertOwner(ctx, orderId);
        const status = (order.customFields as any)?.deliveryStatus;
        if (status !== 'assigned' && status !== 'in_progress') {
            throw new UserInputError('当前状态不允许上报异常');
        }
        // 条件写：并发取消/改派时不得把非本人/已终态单改成 exception（原先读后写存在竞态）
        const res: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsDeliverystatus" = $1, "customFieldsExceptiontype" = $2, '
            + '"customFieldsExceptionphotos" = $3, "customFieldsExceptionnote" = $4, '
            + '"customFieldsExceptionreportedat" = $5 '
            + 'WHERE id = $6 AND "customFieldsDeliverystatus" = ANY($7::text[]) '
            + 'AND "customFieldsDeliverystaffid" = $8 AND "state" <> \'Cancelled\' RETURNING id',
            ['exception', type, JSON.stringify(photos ?? []), note ?? null, new Date(), order.id,
                ['assigned', 'in_progress'], String((order.customFields as any)?.deliveryStaffId ?? '')],
        );
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new UserInputError('订单已被取消或改派，无法上报异常');
        }
        return order;
    }

    /** 实收跑腿小费：以订单小费 surcharge 合计为准（0 元小费在 errand.service 只清不加） */
    private actualTip(order: Order): number {
        const list = ((order as any).surcharges ?? []) as Array<{ description?: string; listPrice?: number }>;
        return list
            .filter(s => s?.description === ERRAND_TIP_SURCHARGE_DESC)
            .reduce((sum, s) => sum + Number(s?.listPrice ?? 0), 0);
    }

    private calcEarning(order: Order, cfg: CampusFulfillmentConfig, tip: number): number {
        // 跑腿单：跑腿费在 orderLines 单价中（虚拟商品 0 元时全在 shipping）；统一取 shipping + 实收小费
        const shipping = order.shipping || 0;
        return Math.floor(((shipping + tip) * cfg.riderCommissionRate) / 100);
    }

    /** 配送配置按订单所属渠道解析（P2）：跨店骑手请求头渠道与订单渠道不一致时，佣金比例必须锚定订单渠道 */
    private async getConfig(ctx: RequestContext, order?: Order) {
        const orderChannelId = Number(((order as any)?.channels ?? [])[0]?.id ?? NaN);
        const channelId = Number.isFinite(orderChannelId) && orderChannelId > 0 ? orderChannelId : ctx.channelId;
        const cfg = await this.connection
            .getRepository(ctx, CampusFulfillmentConfig)
            .findOne({ where: { channelId: channelId as any } });
        if (!cfg) throw new UserInputError('校园履约未配置');
        return cfg;
    }

    private async assertOwner(ctx: RequestContext, orderId: ID, expect?: string) {
        const rider = await this.riderService.assertApprovedRider(ctx);
        const order = await this.connection
            .getRepository(ctx, Order)
            .findOne({ where: { id: orderId as any }, relations: ['customer', 'channels', 'surcharges'] });
        const cf = order?.customFields as any;
        if (!order || cf?.deliveryStaffId !== String(rider.id)) throw new ForbiddenError();
        if (expect && cf?.deliveryStatus !== expect) {
            throw new UserInputError(`当前状态不允许该操作（期望 ${expect}）`);
        }
        return order;
    }
}
