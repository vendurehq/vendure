import { Injectable } from '@nestjs/common';
import {
    Channel,
    ID,
    Logger,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';
import { RiderService } from './rider.service';
import { CampusNotifyService } from './campus-notify.service';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusRiderShift } from './rider-ops.entities';
import { addDays, localDateKey, shiftCoversNow } from './rider-shift-window';

/** F5 聚合大厅单量上限（超限截断 + 告警，防单量增长拖垮小机） */
const HALL_ALL_LIMIT = 500;

@Injectable()
export class HallGrabService {
    constructor(
        private connection: TransactionalConnection,
        private riderService: RiderService,
        private notify: CampusNotifyService,
    ) {}

    /** 抢单：事务 + pessimistic_write，hallStatus 非 open 即抛「手慢了」。
     * 同时写 delivery customFields（deliveryStaffId/deliveryStatus=assigned），复用其任务体系。
     * 事务内查询与更新均使用事务 em，保证读写同一事务。
     * 注：lock.tables 指定 "order" 表，避免 FOR UPDATE 作用于 customer 外连接的可空侧（PG 报错）。
     * 多单顺路（plan 3.3）：主单带 routeGroupId 时，同组 hallStatus='open' 的单在同一事务内
     * 一并锁定并写同一骑手（整组接走）；组内骑手自己的单跳过留在大厅。组内查询按 id 升序
     * FOR UPDATE，保证并发抢同组两单时加锁顺序一致，避免 PG 死锁（败者整体回滚重试）。 */
    async grab(ctx: RequestContext, orderId: ID): Promise<Order> {
        const rider = await this.riderService.assertApprovedRider(ctx);
        await this.assertShiftAllowed(ctx, rider.id);
        const grabbed = await this.connection.rawConnection.transaction(async em => {
            const order = await em.getRepository(Order).findOne({
                where: { id: orderId as any },
                relations: ['customer'],
                lock: { mode: 'pessimistic_write', tables: ['order'] },
            });
            const cf = order?.customFields as any;
            if (!order || cf?.hallStatus !== 'open') throw new UserInputError('手慢了，该订单已被抢');
            if ((order as any).state === 'Cancelled') throw new UserInputError('该订单已取消');
            if (order.customer?.id === rider.id) throw new UserInputError('不能抢自己的订单');
            // 整组抢单：同组 open 单按 id 升序锁定（主单已在锁内，重复锁无害）。
            // 注意：单表查询直接 FOR UPDATE 即可——setLock 的 lockTables 第三参
            // 在 TypeORM 中是原样 join 不加引号（" OF " + tables.join），别名 order
            // 是 PG 保留字会触发 syntax error（单测 mock 不暴露，生产实测踩坑）。
            let mates: Order[] = [];
            if (cf.routeGroupId) {
                mates = await em.getRepository(Order).createQueryBuilder('order')
                    .where('order.customFields.routeGroupId = :gid', { gid: cf.routeGroupId })
                    .andWhere('order.customFields.hallStatus = :s', { s: 'open' })
                    .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
                    .orderBy('order.id', 'ASC')
                    .setLock('pessimistic_write')
                    .getMany();
            }
            const targets = [order, ...mates.filter(m => m.id !== order.id && m.customerId !== rider.id)];
            const patch = {
                customFields: {
                    hallStatus: 'grabbed',
                    deliveryStaffId: String(rider.id),
                    deliveryStatus: 'assigned',
                    assignedAt: new Date(),
                },
            };
            for (const t of targets) {
                await em.getRepository(Order).update(t.id, patch as any);
            }
            return { order, targetIds: targets.map(t => t.id) };
        });
        // 事务提交后通知下单用户（fire-and-forget，不影响抢单主流程）：整组逐单通知各自用户
        // dedupe 后缀带骑手 id + 时间戳：改派/回厅重抢时不与首次接单通知撞同一幂等键
        for (const id of grabbed.targetIds) {
            this.notify.user(ctx, id, 'riderAssigned', undefined, undefined, `r${rider.id}_${Date.now()}`);
        }
        return grabbed.order;
    }

    /** T2/T3 强派原语：hallStatus='open' → 'grabbed'（事务+悲观锁，与 grab 同款防双抢）。
     * 目标骑手须 approved；低信用分在调用方（DispatchJobService）过滤。 */
    async grabByRider(ctx: RequestContext, orderId: ID, rider: { id: ID }): Promise<boolean> {
        const ok = await this.connection.rawConnection.transaction(async em => {
            const order = await em.getRepository(Order).findOne({
                where: { id: orderId as any },
                // 锁限主表：Order eager relations 会产生 LEFT JOIN，不限表时
                // FOR UPDATE 落 nullable side 直接报错（生产 8:06 实锤），对齐 grab 同款
                lock: { mode: 'pessimistic_write', tables: ['order'] },
            });
            const cf = order?.customFields as any;
            if (!order || cf?.hallStatus !== 'open') return false;
            if ((order as any).state === 'Cancelled') return false;
            await em.getRepository(Order).update(order.id, {
                customFields: {
                    hallStatus: 'grabbed',
                    deliveryStaffId: String(rider.id),
                    deliveryStatus: 'assigned',
                    assignedAt: new Date(),
                },
            } as any);
            return true;
        });
        // 事务提交后通知下单用户（T2 自动强派/手动强派共用此触点）；后缀带骑手 id + 时间戳防改派被去重吞掉
        if (ok) this.notify.user(ctx, orderId, 'riderAssigned', undefined, undefined, `r${rider.id}_${Date.now()}`);
        return ok;
    }

    /**
     * 大厅列表：当前渠道 open 状态订单（含跑腿单）。
     * T1: 滞留 > 5min 加急置顶，其次小费降序，再按入厅时间升序（JS 排序，避免 customFields
     * 物理列名在 SQL 排序中的风险）。customFields 为嵌入式物理列，QueryBuilder 中必须用
     * embedded 路径 order.customFields.hallStatus（TypeORM 解析改写）。
     * 渠道过滤：Order 无标量 channelId 列，channels 为多对多关联（同 core findOneInChannel 模式），
     * 故 join order.channels 过滤 channel.id = ctx.channelId。
     */
    async hall(ctx: RequestContext) {
        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId as any })
            .andWhere('order.customFields.hallStatus = :s', { s: 'open' })
            // 取消事件异步脱厅存在窗口：已取消单即使 hallStatus 仍为 open 也绝不进大厅
            .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
            .getMany();
        return this.sortHall(orders);
    }

    /**
     * F5 聚合大厅：一次带回全部营业中店铺渠道的 open 单（替代骑手端「店铺列表 + N 渠道逐请求」的 N+1 轮询）。
     * 范围与骑手端 activeChannels 对齐：有履约配置、非默认渠道、未暂停。
     * 返回 plain object：每单附加 channelId/channelName（M1：不再下发 channelToken，
     * 骑手端按 channelId 从店铺列表换取 token 后再回传抢单 mutation）。
     * 排序与单渠道 hall() 一致（跨渠道合并后统一排）；超 HALL_ALL_LIMIT 截断 + 告警。
     */
    async hallAll(ctx: RequestContext) {
        const configs = await this.connection.getRepository(ctx, CampusFulfillmentConfig).find();
        const paused = new Set(configs.filter(c => c.paused).map(c => Number(c.channelId)));
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const stores = channels.filter(ch =>
            ch.code !== '__default_channel__'
            && configs.some(c => Number(c.channelId) === Number(ch.id))
            && !paused.has(Number(ch.id)));
        if (!stores.length) return [];
        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('channel.id IN (:...ids)', { ids: stores.map(s => s.id) })
            .andWhere('order.customFields.hallStatus = :s', { s: 'open' })
            // 取消事件异步脱厅存在窗口：已取消单绝不进骑手大厅
            .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
            // PG LIMIT 无 ORDER BY 时截断集不确定：按创建时间升序（最老最紧急优先）固定截断口径，
            // 且保证 sortHall 的小费降序作用于确定的候选集（不会漏掉高小费单）
            .orderBy('order.createdAt', 'ASC')
            .take(HALL_ALL_LIMIT)
            .getMany();
        if (orders.length >= HALL_ALL_LIMIT) {
            Logger.warn(`hallAll truncated at ${HALL_ALL_LIMIT} open orders`, 'CampusHall');
        }
        return this.sortHall(orders)
            .map(o => {
                const hit = stores.find(s => (o.channels ?? []).some(c => Number(c.id) === Number(s.id)));
                if (!hit) return null;
                return {
                    id: o.id,
                    code: o.code,
                    total: o.total,
                    shipping: o.shipping,
                    createdAt: o.createdAt,
                    channelId: String(hit.id),
                    channelName: hit.code,
                    customFields: (o.customFields ?? {}) as any,
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
    }

    /**
     * P3-1 接单班次联动：店铺开启 shiftCheckEnabled 后，骑手仅能在后台登记的排班时段内抢单。
     * 默认关闭（不改变既有抢单行为）；跨零点班次按「开始日 + 次日结束」判定。
     */
    private async assertShiftAllowed(ctx: RequestContext, riderId: ID): Promise<void> {
        const config = await this.connection.getRepository(ctx, CampusFulfillmentConfig).findOne({
            where: { channelId: ctx.channelId as any },
        });
        if (!config?.shiftCheckEnabled) return;
        const now = new Date();
        const today = localDateKey(now);
        const shifts = await this.connection.getRepository(ctx, CampusRiderShift).find({
            where: {
                channelId: ctx.channelId as any,
                riderCustomerId: riderId as any,
                shiftDate: In([today, addDays(today, -1)]),
            },
        });
        if (!shifts.some(s => shiftCoversNow(s, now))) {
            throw new UserInputError('当前不在排班时段，暂不能接单');
        }
    }

    /** 大厅排序：滞留 >5min 加急置顶，其次小费降序，再按入厅时间升序（JS 排序，避免 customFields 物理列名在 SQL 排序中的风险） */
    private sortHall(orders: Order[]): Order[] {
        const now = Date.now();
        const urgentBefore = now - 5 * 60_000;
        const urgent = (o: Order) => {
            const at = (o.customFields as any).hallEnteredAt;
            return at ? new Date(at).getTime() < urgentBefore : false;
        };
        return orders.sort((a, b) =>
            (urgent(b) ? 1 : 0) - (urgent(a) ? 1 : 0)
            || ((b.customFields as any).tip ?? 0) - ((a.customFields as any).tip ?? 0)
            || new Date((a.customFields as any).hallEnteredAt ?? a.createdAt).getTime()
                - new Date((b.customFields as any).hallEnteredAt ?? b.createdAt).getTime());
    }
}
