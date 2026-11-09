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
exports.GroupBuyService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const constants_1 = require("./constants");
const group_buy_activity_entity_1 = require("./group-buy-activity.entity");
const group_buy_order_entity_1 = require("./group-buy-order.entity");
const events_1 = require("./events");
const group_buy_runtime_1 = require("./group-buy-runtime");
const platform_time_1 = require("./platform-time");
const ALLOWED_UPDATE_FIELDS = [
    'name',
    'description',
    'startAt',
    'endAt',
    'targetCount',
    'maxCount',
    'groupPrice',
    'leaderDiscount',
    'leaderRewardType',
    'productId',
    'variantId',
    'autoConfirm',
    'allowJoinAfterComplete',
    'status',
];
let GroupBuyService = class GroupBuyService {
    constructor(connection, listQueryBuilder, channelService, customerService, orderService, paymentService, eventBus) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.channelService = channelService;
        this.customerService = customerService;
        this.orderService = orderService;
        this.paymentService = paymentService;
        this.eventBus = eventBus;
        this.stockReserveService = null;
        this.stockPrewarmService = null;
    }
    init(injector) {
        // 供 Promotion 条件/动作在结算期动态取活动配置
        (0, group_buy_runtime_1.setGroupBuyConnection)(this.connection);
        try {
            const { StockReserveService, StockPrewarmService } = require('@vendure/redis-stock-plugin');
            this.stockReserveService = injector.get(StockReserveService);
            this.stockPrewarmService = injector.get(StockPrewarmService);
        }
        catch (_a) {
            // RedisStockPlugin not installed, use DB fallback
        }
    }
    /* ------------------------- 活动管理 ------------------------- */
    async findAll(ctx, options) {
        return this.listQueryBuilder
            .build(group_buy_activity_entity_1.GroupBuyActivity, options, {
            ctx,
            relations: ['channels'],
            channelId: ctx.channelId,
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    async findOne(ctx, id) {
        const result = await this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity).findOne({
            where: { id: id },
            relations: { channels: true },
        });
        return result !== null && result !== void 0 ? result : undefined;
    }
    async create(ctx, input) {
        const repo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = Object.assign({}, input);
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new group_buy_activity_entity_1.GroupBuyActivity(safeInput);
        activity.channels = [ctx.channel];
        // 入参是绝对时刻，落库前显式转成平台墙上时间（列类型为 timestamp，不随进程 TZ 漂移）
        if (activity.startAt)
            activity.startAt = (activity.startAt);
        if (activity.endAt)
            activity.endAt = (activity.endAt);
        const saved = await repo.save(activity);
        if (this.stockPrewarmService && saved.status === 'active') {
            await this.stockPrewarmService.prewarm(`group-buy:${saved.id}`, saved.targetCount - saved.currentCount);
        }
        return saved;
    }
    async update(ctx, input) {
        const repo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new core_1.UserInputError(`GroupBuyActivity with id ${input.id} not found`);
        }
        const patch = {};
        for (const key of ALLOWED_UPDATE_FIELDS) {
            if (input[key] !== undefined) {
                patch[key] = input[key];
            }
        }
        Object.assign(activity, patch);
        // 入参是绝对时刻，落库前显式转成平台墙上时间（列类型为 timestamp）
        if (patch.startAt)
            activity.startAt = (new Date(patch.startAt));
        if (patch.endAt)
            activity.endAt = (new Date(patch.endAt));
        return repo.save(activity);
    }
    async delete(ctx, id) {
        const repo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        await repo.delete(id);
    }
    /* ------------------------- 开团 / 参团（闭环核心） ------------------------- */
    /**
     * 开团/参团一体：
     * 1. 校验订单归属（customer.user.id，勿用 customer.id）
     * 2. 校验活动：存在、非 expired、窗口内、可参（未满 / 已成团且允许续参）
     * 3. 校验订单包含拼团变体行
     * 4. 原子递增 currentCount（防超员，受影响=0 即满员/不可参）
     * 5. 写订单 customFields（groupBuyActivityId + groupBuyIsLeader）并重算价格 → 拼团价立即生效
     * 6. 登记/更新参团记录（同一 orderId 幂等，不重复递增）
     * 7. 达 targetCount → 活动 completed + 全部 pending 参团记录置 success
     */
    async joinGroupBuy(ctx, activityId, orderId, isLeader) {
        var _a, _b, _c, _d;
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'customer.user',
            'lines',
            'lines.productVariant',
        ]);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        // 归属校验：登录 User 主键 vs order.customer.user.id
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== ctx.activeUserId) {
            throw new core_1.UserInputError('You can only join a group buy with your own order');
        }
        const activityRepo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        const activity = await activityRepo.findOne({ where: { id: activityId } });
        if (!activity) {
            throw new core_1.UserInputError(`GroupBuyActivity with id ${activityId} not found`);
        }
        const nowMs = (0, platform_time_1.platformNowMs)();
        if (activity.status === 'expired') {
            throw new core_1.UserInputError('Activity has expired');
        }
        if (activity.status !== 'active' && !activity.allowJoinAfterComplete) {
            throw new core_1.UserInputError('Activity is not joinable');
        }
        if (activity.startAt && nowMs < (0, platform_time_1.wallClockMs)(activity.startAt)) {
            throw new core_1.UserInputError('Group buy activity has not started yet');
        }
        if (activity.endAt && nowMs > (0, platform_time_1.wallClockMs)(activity.endAt)) {
            throw new core_1.UserInputError('Group buy activity has ended');
        }
        // 订单须包含拼团变体行
        const hasVariant = (_c = order === null || order === void 0 ? void 0 : order.lines) === null || _c === void 0 ? void 0 : _c.some((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId));
        if (!hasVariant) {
            throw new core_1.UserInputError('Order does not contain the group buy variant');
        }
        const orderRepo = this.connection.getRepository(ctx, group_buy_order_entity_1.GroupBuyOrder);
        const existing = await orderRepo.findOne({ where: { orderId: String(orderId) } });
        const alreadyJoined = !!existing;
        if (!alreadyJoined) {
            // 原子递增（权威防超员/防续参条件）
            const incResult = await activityRepo
                .createQueryBuilder()
                .update()
                .set({ currentCount: () => 'currentCount + 1' })
                .where('id = :id', { id: activity.id })
                .andWhere('(status = :active OR (status = :completed AND :allowJoin = true))', {
                active: 'active',
                completed: 'completed',
                allowJoin: activity.allowJoinAfterComplete,
            })
                .andWhere('startAt <= (now() AT TIME ZONE :platformTz)', {
                platformTz: platform_time_1.PLATFORM_TIME_ZONE,
            })
                .andWhere('endAt >= (now() AT TIME ZONE :platformTz)', {
                platformTz: platform_time_1.PLATFORM_TIME_ZONE,
            })
                .andWhere('(maxCount = 0 OR currentCount < maxCount)')
                .execute();
            if (((_d = incResult.affected) !== null && _d !== void 0 ? _d : 0) === 0) {
                throw new core_1.UserInputError('Activity is already full or not joinable');
            }
        }
        // 写订单自定义字段 → 触发拼团价 Promotion 生效
        const updatedOrder = await this.orderService.updateCustomFields(ctx, orderId, {
            groupBuyActivityId: Number(activityId),
            groupBuyIsLeader: isLeader,
        });
        await this.orderService.applyPriceAdjustments(ctx, updatedOrder);
        // 登记/更新参团记录（幂等：已存在则只更新 isLeader）
        let groupBuyOrder;
        if (alreadyJoined && existing) {
            existing.isLeader = isLeader;
            groupBuyOrder = await orderRepo.save(existing);
        }
        else {
            const status = activity.status === 'completed' ? 'success' : 'pending';
            groupBuyOrder = new group_buy_order_entity_1.GroupBuyOrder({
                groupBuyActivityId: String(activity.id),
                orderId: String(orderId),
                isLeader,
                status,
            });
            groupBuyOrder = await orderRepo.save(groupBuyOrder);
        }
        // 成团联动：当前人数达到目标 → 活动 completed + 全部 pending 参团记录 success
        if (!alreadyJoined && activity.status === 'active') {
            const fresh = await activityRepo.findOne({ where: { id: activity.id } });
            if (fresh && fresh.currentCount >= fresh.targetCount) {
                fresh.status = 'completed';
                await activityRepo.save(fresh);
                await this.markAllSuccess(ctx, activity.id);
                // 成团领域事件（供支付计划等下游订阅）
                const joined = await orderRepo.find({ where: { groupBuyActivityId: String(activity.id) } });
                this.eventBus.publish(new events_1.GroupBuyCompletedEvent(ctx, Number(activity.id), joined.map(j => j.orderId)));
            }
        }
        core_1.Logger.info(`User ${ctx.activeUserId} ${isLeader ? 'opened' : 'joined'} group buy ${activity.id} on order ${orderId} (count ${activity.currentCount + (alreadyJoined ? 0 : 1)})`, constants_1.loggerCtx);
        return groupBuyOrder;
    }
    /* ------------------------- 过期检查（定时任务 + 手动触发共用） ------------------------- */
    /**
     * 处理已过 endAt 且仍 active 的活动：
     * - 已成团（currentCount >= targetCount）→ 置 completed（兜底，通常 join 时已处理）
     * - 未成团 → 置 expired，并取消+退款全部 pending 参团订单，参团记录置 failed
     * 返回处理过的活动，便于调用方清理 prewarm 库存。
     */
    async processExpired(ctx) {
        const activityRepo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        const orderRepo = this.connection.getRepository(ctx, group_buy_order_entity_1.GroupBuyOrder);
        const expiredActivities = await activityRepo
            .createQueryBuilder('gba')
            .innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('gba.endAt < (now() AT TIME ZONE :platformTz)', {
            platformTz: platform_time_1.PLATFORM_TIME_ZONE,
        })
            .andWhere('gba.status = :status', { status: 'active' })
            .getMany();
        const processed = [];
        for (const activity of expiredActivities) {
            if (activity.currentCount >= activity.targetCount) {
                activity.status = 'completed';
            }
            else {
                activity.status = 'expired';
            }
            await activityRepo.save(activity);
            processed.push(activity);
            if (activity.status === 'expired') {
                const pendingOrders = await orderRepo.find({
                    where: { groupBuyActivityId: String(activity.id), status: 'pending' },
                });
                for (const gbo of pendingOrders) {
                    try {
                        await this.orderService.cancelOrder(ctx, { orderId: gbo.orderId });
                        await this.refundOrderPayments(ctx, gbo.orderId);
                        gbo.status = 'failed';
                        await orderRepo.save(gbo);
                        core_1.Logger.info(`Cancelled and refunded group buy order ${gbo.orderId} for expired activity ${activity.id}`, constants_1.loggerCtx);
                    }
                    catch (e) {
                        core_1.Logger.error(`Failed to cancel group buy order ${gbo.orderId}: ${e.message}`, constants_1.loggerCtx);
                    }
                }
                // 不成团领域事件（供支付计划等下游订阅）
                const allJoined = await orderRepo.find({ where: { groupBuyActivityId: String(activity.id) } });
                this.eventBus.publish(new events_1.GroupBuyFailedEvent(ctx, Number(activity.id), allJoined.map(j => j.orderId)));
            }
            core_1.Logger.info(`Activity ${activity.id} status changed to ${activity.status}`, constants_1.loggerCtx);
        }
        return processed;
    }
    /* ------------------------- 查询 ------------------------- */
    async findActiveByVariant(ctx, variantId) {
        const repo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        const qb = repo.createQueryBuilder('gba');
        qb.innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId });
        qb.where('gba.variantId = :variantId', { variantId: variantId });
        qb.andWhere('gba.status = :status', { status: 'active' });
        return qb.getMany();
    }
    async findActive(ctx) {
        const repo = this.connection.getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity);
        return repo
            .createQueryBuilder('gba')
            .innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('gba.status = :status', { status: 'active' })
            .andWhere('gba.startAt <= (now() AT TIME ZONE :platformTz)', {
            platformTz: platform_time_1.PLATFORM_TIME_ZONE,
        })
            .andWhere('gba.endAt >= (now() AT TIME ZONE :platformTz)', {
            platformTz: platform_time_1.PLATFORM_TIME_ZONE,
        })
            .getMany();
    }
    /**
     * Shop API 专用：「我的开团 / 我的参团」。
     * GroupBuyOrder 没有 customerId 列，归属只能经 orderId 关联 Order.customerId 反查
     * （参考 after-sales-plugin 的 resolveCustomerId 桥接思路）。
     * 先取当前渠道下该客户的订单 id，再按 orderId 反查拼团记录 —— 不用原生 join 条件，
     * 因为 orderId 是 varchar 而 Order.id 是 int，Postgres 下 `int = varchar` 会直接报错。
     * 渠道过滤走订单的 channels 关联：GroupBuyOrder.channels 在 joinGroupBuy 里从未写入，不能当过滤条件。
     */
    async findMyOrders(ctx, isLeader) {
        if (!ctx.activeUserId) {
            return [];
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            return [];
        }
        const orders = await this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('ord.customerId = :customerId', { customerId: Number(customer.id) })
            .select(['ord.id', 'ord.code'])
            .getMany();
        if (orders.length === 0) {
            return [];
        }
        const orderCodeMap = new Map(orders.map(o => [String(o.id), o.code]));
        const rows = await this.connection.getRepository(ctx, group_buy_order_entity_1.GroupBuyOrder).find({
            where: { orderId: (0, typeorm_1.In)(orders.map(o => String(o.id))), isLeader },
            order: { createdAt: 'DESC' },
        });
        if (rows.length === 0) {
            return [];
        }
        // 二次批量取活动详情：GroupBuyOrder 与 GroupBuyActivity 之间没有 ORM 关联
        const activityRows = await this.connection
            .getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity)
            .find({ where: { id: (0, typeorm_1.In)(Array.from(new Set(rows.map(r => Number(r.groupBuyActivityId))))) } });
        const activityMap = new Map(activityRows.map(a => [String(a.id), a]));
        return rows.map(r => ({
            id: String(r.id),
            orderId: String(r.orderId),
            orderCode: orderCodeMap.get(String(r.orderId)),
            groupBuyActivityId: String(r.groupBuyActivityId),
            isLeader: r.isLeader,
            status: r.status,
            activity: activityMap.get(String(r.groupBuyActivityId)),
        }));
    }
    /* ------------------------- 私有工具 ------------------------- */
    /** 活动成团后，把该活动全部 pending 参团记录置 success */
    async markAllSuccess(ctx, activityId) {
        const orderRepo = this.connection.getRepository(ctx, group_buy_order_entity_1.GroupBuyOrder);
        await orderRepo
            .createQueryBuilder()
            .update()
            .set({ status: 'success' })
            .where('groupBuyActivityId = :activityId', { activityId: String(activityId) })
            .andWhere('status = :pending', { pending: 'pending' })
            .execute();
    }
    /** 对订单的 Settled 支付逐个退款（拼团失败/过期） */
    async refundOrderPayments(ctx, orderId) {
        var _a, _b, _c;
        const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: orderId },
            relations: ['payments'],
        });
        if (!((_a = order === null || order === void 0 ? void 0 : order.payments) === null || _a === void 0 ? void 0 : _a.length)) {
            return;
        }
        for (const payment of order.payments) {
            if (payment.state === 'Settled') {
                if (String(payment.method) === 'cash-on-delivery') {
                    // COD：只认 confirmed 收款，统一走 campus 闸门（无收款不建单；有收款建单即 Settled 并写关联）
                    const policy = resolveCodRefundPolicy();
                    if (!policy) {
                        core_1.Logger.warn(`COD refund gate unavailable, skip refund for payment ${payment.id}`, constants_1.loggerCtx);
                        continue;
                    }
                    try {
                        const result = await policy.createRefund(ctx, {
                            orderId: order.id,
                            paymentId: payment.id,
                            amount: payment.amount,
                            reason: 'Group buy failed/expired',
                        });
                        if (result instanceof Error || (result === null || result === void 0 ? void 0 : result.errorCode)) {
                            core_1.Logger.warn(`COD refund for payment ${payment.id} returned error: ${(_b = result === null || result === void 0 ? void 0 : result.message) !== null && _b !== void 0 ? _b : result}`, constants_1.loggerCtx);
                        }
                    }
                    catch (e) {
                        core_1.Logger.error(`Failed to refund COD payment ${payment.id} for order ${orderId}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, constants_1.loggerCtx);
                    }
                    continue;
                }
                try {
                    const result = await this.paymentService.createRefund(ctx, {
                        paymentId: payment.id,
                        amount: payment.amount,
                        reason: 'Group buy failed/expired',
                        // Refund.shipping / Refund.adjustment 为 NOT NULL 列，必须显式置 0
                        // （否则 sqljs 报 NOT NULL constraint failed: refund.shipping）
                        shipping: 0,
                        adjustment: 0,
                    }, order, payment);
                    if (result instanceof Error) {
                        core_1.Logger.warn(`Refund for payment ${payment.id} returned error: ${result.message}`, constants_1.loggerCtx);
                    }
                }
                catch (e) {
                    core_1.Logger.error(`Failed to refund payment ${payment.id} for order ${orderId}: ${e.message}`, constants_1.loggerCtx);
                }
            }
        }
    }
};
exports.GroupBuyService = GroupBuyService;
exports.GroupBuyService = GroupBuyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder,
        core_1.ChannelService,
        core_1.CustomerService,
        core_1.OrderService,
        core_1.PaymentService,
        core_1.EventBus])
], GroupBuyService);
/** 软依赖解析 COD 退款闸门端口（campus-delivery-plugin 未安装时返回 null，COD 一律不建退款单）。 */
function resolveCodRefundPolicy() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@vendure/cjk-plugin');
        return typeof (mod === null || mod === void 0 ? void 0 : mod.getCodRefundPolicyPort) === 'function' ? mod.getCodRefundPolicyPort() : null;
    }
    catch (_a) {
        return null;
    }
}
//# sourceMappingURL=group-buy.service.js.map