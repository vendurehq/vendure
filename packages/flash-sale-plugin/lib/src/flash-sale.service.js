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
exports.FlashSaleService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const flash_sale_activity_entity_1 = require("./flash-sale-activity.entity");
const flash_sale_runtime_1 = require("./flash-sale-runtime");
/**
 * update() 允许写入的字段白名单。
 * 显式过滤 soldCount/status 等敏感字段，避免被外部 input 篡改。
 */
const UPDATE_ALLOWED_FIELDS = [
    'name',
    'startAt',
    'endAt',
    'flashPrice',
    'totalStock',
    'limitPerUser',
    'productId',
    'variantId',
];
let FlashSaleService = class FlashSaleService {
    constructor(connection, listQueryBuilder, orderService) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.orderService = orderService;
        this.stockReserveService = null;
    }
    init(injector) {
        // 供 Promotion 条件/动作在结算期动态取活动配置
        (0, flash_sale_runtime_1.setFlashSaleConnection)(this.connection);
        try {
            const { StockReserveService } = require('@vendure/redis-stock-plugin');
            this.stockReserveService = injector.get(StockReserveService);
        }
        catch (_a) {
            // RedisStockPlugin not installed, use DB fallback
        }
    }
    /* ------------------------- 活动管理 ------------------------- */
    async findAll(ctx, options) {
        return this.listQueryBuilder
            .build(flash_sale_activity_entity_1.FlashSaleActivity, options, {
            ctx,
            channelId: ctx.channelId,
            relations: ['channels'],
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    async findOne(ctx, id) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        const result = await repo.findOne({
            where: { id: id },
            relations: { channels: true },
        });
        return result !== null && result !== void 0 ? result : undefined;
    }
    async create(ctx, input) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = Object.assign({}, input);
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new flash_sale_activity_entity_1.FlashSaleActivity(safeInput);
        activity.channels = [ctx.channel];
        const now = new Date();
        if (activity.startAt && now >= activity.startAt) {
            activity.status = 'active';
        }
        else {
            activity.status = 'upcoming';
        }
        return repo.save(activity);
    }
    async update(ctx, input) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new core_1.UserInputError(`FlashSaleActivity with id ${input.id} not found`);
        }
        // 字段白名单：禁止外部 input 篡改 soldCount/status 等内部字段
        for (const key of UPDATE_ALLOWED_FIELDS) {
            if (key in input) {
                activity[key] = input[key];
            }
        }
        return repo.save(activity);
    }
    async delete(ctx, id) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        await repo.delete(id);
    }
    /* ------------------------- 抢购（闭环核心） ------------------------- */
    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内
     * 3. 校验订单含秒杀变体行；qty = 秒杀变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计秒杀件数 + qty <= limitPerUser
     * 5. 原子占用库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（flashSaleActivityId + startAt/endAt 快照）并重算价格 → 秒杀价立即生效
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    async applyFlashSale(ctx, activityId) {
        var _a, _b, _c;
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new core_1.UserInputError('Not authenticated');
        }
        const order = await this.orderService.getActiveOrderForUser(ctx, userId);
        if (!order) {
            throw new core_1.UserInputError('No active order found');
        }
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== userId) {
            throw new core_1.UserInputError('You can only apply flash sale to your own order');
        }
        const activity = await this.findOne(ctx, activityId);
        if (!activity) {
            throw new core_1.UserInputError(`FlashSaleActivity with id ${activityId} not found`);
        }
        const now = new Date();
        if (activity.status !== 'active') {
            throw new core_1.UserInputError('Activity is not active');
        }
        if (activity.startAt && now < activity.startAt) {
            throw new core_1.UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new core_1.UserInputError('Activity has ended');
        }
        // 订单须包含秒杀变体行
        const lines = (_c = order === null || order === void 0 ? void 0 : order.lines) !== null && _c !== void 0 ? _c : [];
        const flashLines = lines.filter((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId));
        if (!flashLines.length) {
            throw new core_1.UserInputError('Order does not contain the flash sale variant');
        }
        const qty = flashLines.reduce((sum, l) => sum + l.quantity, 0);
        // 限购校验（含本次 qty）
        await this.assertPurchaseLimit(ctx, order, activity, qty);
        // 写订单自定义字段 → 触发秒杀价 Promotion 生效。
        // 先写字段+重算价格、后原子占库存：重算时 soldCount 尚未占用，
        // 即使本次抢购是「最后一单」（占满 totalStock）也能享到秒杀价；
        // 占库存失败抛错时整体回滚（resolver @Transaction 原子提交）。
        const updatedOrder = await this.orderService.updateCustomFields(ctx, order.id, {
            flashSaleActivityId: Number(activityId),
            flashSaleStartAt: activity.startAt,
            flashSaleEndAt: activity.endAt,
        });
        await this.orderService.applyPriceAdjustments(ctx, updatedOrder);
        // 原子占用库存（防超卖）
        await this.reserveStock(ctx, activityId, qty, activity);
        // 售罄即时置 ended
        const fresh = await this.findOne(ctx, activityId);
        if (fresh && fresh.soldCount >= fresh.totalStock) {
            fresh.status = 'ended';
            await this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity).save(fresh);
            core_1.Logger.info(`FlashSaleActivity ${activityId} ended due to stock depletion`, constants_1.loggerCtx);
        }
        return this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant']);
    }
    /* ------------------------- 查询 ------------------------- */
    async findActive(ctx) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        const now = new Date();
        return repo
            .createQueryBuilder('fsa')
            .innerJoin('fsa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('fsa.status = :status', { status: 'active' })
            .andWhere('fsa.startAt <= :now', { now })
            .andWhere('fsa.endAt >= :now', { now })
            .getMany();
    }
    async findActiveByVariant(ctx, variantId) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        const now = new Date();
        const result = await repo
            .createQueryBuilder('fsa')
            .innerJoin('fsa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('fsa.variantId = :variantId', { variantId: variantId })
            .andWhere('fsa.status = :status', { status: 'active' })
            .andWhere('fsa.startAt <= :now', { now })
            .andWhere('fsa.endAt >= :now', { now })
            .getOne();
        return result !== null && result !== void 0 ? result : undefined;
    }
    /* ------------------------- 库存占用 / 回滚 ------------------------- */
    /**
     * 订单取消时回滚占用库存：Redis 路径走 StockReserveService，DB 路径走原子 UPDATE。
     * quantity 为订单内秒杀变体行总件数（修正原先固定 1 件）。
     */
    async releaseStock(ctx, activityId, quantity) {
        var _a;
        if ((_a = this.stockReserveService) === null || _a === void 0 ? void 0 : _a.isAvailable) {
            await this.stockReserveService.releaseStock(`flash-sale:${activityId}`, quantity);
            await this.restoreActiveIfPossible(ctx, activityId);
        }
        else {
            await this.releaseStockAtomic(ctx, activityId, quantity);
        }
    }
    /**
     * 订单取消时按订单内秒杀行实际件数回滚预占库存。
     * 由 plugin 的 OrderStateTransitionEvent 处理器调用（替代原先固定 1 件）。
     */
    async releaseStockForOrder(ctx, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ]);
        if (!order)
            return;
        const activityId = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.flashSaleActivityId;
        if (!activityId)
            return;
        const activity = await this.findOne(ctx, activityId);
        if (!activity)
            return;
        const lines = (_b = order === null || order === void 0 ? void 0 : order.lines) !== null && _b !== void 0 ? _b : [];
        const qty = lines
            .filter((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId))
            .reduce((sum, l) => sum + l.quantity, 0);
        if (qty <= 0)
            return;
        await this.releaseStock(ctx, activityId, qty);
    }
    /* ------------------------- 私有工具 ------------------------- */
    /**
     * 限购校验：同客户该活动非取消订单累计秒杀件数 + 本次 qty <= limitPerUser。
     */
    async assertPurchaseLimit(ctx, order, activity, qty) {
        var _a, _b, _c;
        const customerId = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.id;
        if (customerId == null)
            return;
        const { items } = await this.orderService.findByCustomerId(ctx, customerId, { take: 100 }, ['lines', 'lines.productVariant']);
        let existingQty = 0;
        for (const o of items) {
            if (o.state === 'Cancelled')
                continue;
            if (((_b = o.customFields) === null || _b === void 0 ? void 0 : _b.flashSaleActivityId) !== Number(activity.id))
                continue;
            const oLines = (_c = o === null || o === void 0 ? void 0 : o.lines) !== null && _c !== void 0 ? _c : [];
            existingQty += oLines
                .filter((l) => { var _a; return String((_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.id) === String(activity.variantId); })
                .reduce((sum, l) => sum + l.quantity, 0);
        }
        if (existingQty + qty > activity.limitPerUser) {
            throw new core_1.UserInputError('Purchase limit exceeded');
        }
    }
    /**
     * 原子占用库存：DB 路径 UPDATE ... SET soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    async reserveStock(ctx, activityId, qty, activity) {
        var _a, _b;
        if ((_a = this.stockReserveService) === null || _a === void 0 ? void 0 : _a.isAvailable) {
            const remaining = await this.stockReserveService.reserveStock(`flash-sale:${activityId}`, qty);
            if (remaining < 0) {
                throw new core_1.UserInputError('Sold out');
            }
            return;
        }
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        const result = await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount + ${qty}` })
            .where('id = :id AND soldCount + :qty <= totalStock', {
            id: activityId,
            qty,
        })
            .execute();
        if (((_b = result.affected) !== null && _b !== void 0 ? _b : 0) === 0) {
            throw new core_1.UserInputError('Sold out');
        }
        core_1.Logger.info(`FlashSaleActivity ${activityId}: reserved ${qty} (sold ${activity.soldCount + qty}/${activity.totalStock})`, constants_1.loggerCtx);
    }
    /**
     * DB fallback 原子回滚：订单取消时回滚预占库存。
     * 使用 WHERE soldCount - quantity >= 0 防止负数。
     * 回滚后若活动曾因售罄置 ended、仍在时间窗口内且未占满，恢复为 active。
     */
    async releaseStockAtomic(ctx, activityId, quantity) {
        const repo = this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity);
        await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount - ${quantity}` })
            .where('id = :id AND soldCount - :qty >= 0', { id: activityId, qty: quantity })
            .execute();
        await this.restoreActiveIfPossible(ctx, activityId);
    }
    /**
     * Redis 路径回滚后同样恢复状态（与 DB 路径语义一致）。
     */
    async restoreActiveIfPossible(ctx, activityId) {
        const activity = await this.findOne(ctx, activityId);
        if (!activity)
            return;
        if (activity.status !== 'ended')
            return;
        const now = new Date();
        const inWindow = (!activity.startAt || now >= activity.startAt) && (!activity.endAt || now <= activity.endAt);
        if (inWindow && activity.soldCount < activity.totalStock) {
            activity.status = 'active';
            await this.connection.getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity).save(activity);
            core_1.Logger.info(`FlashSaleActivity ${activityId} restored to active after stock release (sold ${activity.soldCount}/${activity.totalStock})`, constants_1.loggerCtx);
        }
    }
};
exports.FlashSaleService = FlashSaleService;
exports.FlashSaleService = FlashSaleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder,
        core_1.OrderService])
], FlashSaleService);
//# sourceMappingURL=flash-sale.service.js.map