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
exports.PreSaleService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const payment_schedule_bridge_1 = require("./payment-schedule-bridge");
const pre_sale_activity_entity_1 = require("./pre-sale-activity.entity");
const pre_sale_runtime_1 = require("./pre-sale-runtime");
/**
 * update() 允许写入的字段白名单。
 * 显式过滤 soldCount/status 等敏感字段，避免被外部 input 篡改。
 */
const UPDATE_ALLOWED_FIELDS = [
    'name',
    'mode',
    'startAt',
    'endAt',
    'releaseAt',
    'tailStartAt',
    'tailEndAt',
    'presalePrice',
    'depositAmount',
    'totalStock',
    'limitPerUser',
    'productId',
    'variantId',
    'depositKind',
    'tailTriggerType',
    'groupBuyActivityId',
    'tailWindowHours',
    'graceHours',
    'earnestRefundPolicy',
    'shipDeadlineAt',
    'agreementVersion',
];
let PreSaleService = class PreSaleService {
    constructor(connection, listQueryBuilder, orderService, paymentService, paymentMethodService, productVariantService) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.orderService = orderService;
        this.paymentService = paymentService;
        this.paymentMethodService = paymentMethodService;
        this.productVariantService = productVariantService;
    }
    init(injector) {
        // 供 Promotion 条件/动作在结算期动态取活动配置；供软依赖桥取跨插件服务
        (0, pre_sale_runtime_1.setPreSaleConnection)(this.connection);
        (0, pre_sale_runtime_1.setPreSaleInjector)(injector);
    }
    /* ------------------------- 活动管理 ------------------------- */
    async findAll(ctx, options) {
        return this.listQueryBuilder
            .build(pre_sale_activity_entity_1.PreSaleActivity, options, {
            ctx,
            channelId: ctx.channelId,
            relations: ['channels'],
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    async findOne(ctx, id) {
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        const result = await repo.findOne({
            where: { id: id },
            relations: { channels: true },
        });
        return result !== null && result !== void 0 ? result : undefined;
    }
    async create(ctx, input) {
        await this.assertLegalDepositCap(ctx, input);
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = Object.assign({}, input);
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new pre_sale_activity_entity_1.PreSaleActivity(safeInput);
        activity.channels = [ctx.channel];
        activity.channelId = ctx.channelId;
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
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new core_1.UserInputError(`PreSaleActivity with id ${input.id} not found`);
        }
        // 定金 20% 硬校验：以「既有值 + 本次 input」合并后的生效配置为准（input 未带 mode/depositAmount 等字段时兜底活动既有值）
        await this.assertLegalDepositCap(ctx, Object.assign(Object.assign({}, activity), input));
        // 字段白名单：禁止外部 input 篡改 soldCount/status 等内部字段
        for (const key of UPDATE_ALLOWED_FIELDS) {
            if (key in input) {
                activity[key] = input[key];
            }
        }
        return repo.save(activity);
    }
    async delete(ctx, id) {
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        await repo.delete(id);
    }
    /* ------------------------- 到货 Release ------------------------- */
    /**
     * 到货：active → delivered。
     * 到货即开启尾款窗口（deposit 模式把 tailStartAt 落到 releaseAt）。
     */
    async deliverPreSale(ctx, id) {
        var _a;
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        const activity = await repo.findOne({ where: { id: id } });
        if (!activity) {
            throw new core_1.UserInputError(`PreSaleActivity with id ${id} not found`);
        }
        if (activity.status !== 'active' && activity.status !== 'upcoming') {
            // 已到货/已结束不应被重复置为 delivered
            throw new core_1.UserInputError(`PreSaleActivity with id ${id} cannot be delivered from ${activity.status}`);
        }
        activity.status = 'delivered';
        activity.releaseAt = (_a = activity.releaseAt) !== null && _a !== void 0 ? _a : new Date();
        if (activity.mode === 'deposit' && !activity.tailStartAt) {
            activity.tailStartAt = activity.releaseAt;
        }
        return repo.save(activity);
    }
    /* ------------------------- 抢购（applyPreSale 一体） ------------------------- */
    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内、未售罄
     * 3. 校验订单含预售变体行；qty = 预售变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计预售件数 + qty <= limitPerUser
     * 5. 原子锁定库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（preSaleActivityId + mode + depositTotal + releaseAt 快照）+ 若 presalePrice>0 重算价格打折
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    async applyPreSale(ctx, activityId) {
        var _a, _b, _c, _d;
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new core_1.UserInputError('Not authenticated');
        }
        const order = await this.orderService.getActiveOrderForUser(ctx, userId);
        if (!order) {
            throw new core_1.UserInputError('No active order found');
        }
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== userId) {
            throw new core_1.UserInputError('You can only apply pre-sale to your own order');
        }
        const activity = await this.findOne(ctx, activityId);
        if (!activity) {
            throw new core_1.UserInputError(`PreSaleActivity with id ${activityId} not found`);
        }
        const now = new Date();
        // 售罄优先于通用状态检查（售罄时applyPreSale已把活动置 ended，需给出明确"已售罄"而非"活动未激活"）
        if (activity.soldCount >= activity.totalStock) {
            throw new core_1.UserInputError('已售罄');
        }
        if (activity.status !== 'active') {
            throw new core_1.UserInputError('Activity is not active');
        }
        if (activity.startAt && now < activity.startAt) {
            throw new core_1.UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new core_1.UserInputError('Activity has ended');
        }
        // 订单须包含预售变体行
        const lines = (_c = order === null || order === void 0 ? void 0 : order.lines) !== null && _c !== void 0 ? _c : [];
        const preSaleLines = lines.filter((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId));
        if (!preSaleLines.length) {
            throw new core_1.UserInputError('Order does not contain the pre-sale variant');
        }
        const qty = preSaleLines.reduce((sum, l) => sum + l.quantity, 0);
        // 限购校验（含本次 qty）
        await this.assertPurchaseLimit(ctx, order, activity, qty);
        const depositTotal = activity.mode === 'deposit' ? activity.depositAmount : 0;
        // 写订单自定义字段 + 重算价格（presalePrice>0 才打折；否则保持原价）
        const updatedOrder = await this.orderService.updateCustomFields(ctx, order.id, {
            preSaleActivityId: Number(activityId),
            preSaleMode: activity.mode,
            preSaleDepositTotal: depositTotal,
            preSaleReleaseAt: (_d = activity.releaseAt) !== null && _d !== void 0 ? _d : activity.endAt,
        });
        if (activity.presalePrice > 0) {
            await this.orderService.applyPriceAdjustments(ctx, updatedOrder);
        }
        // 原子锁定库存（防超卖）
        await this.reserveStock(ctx, activityId, qty, activity);
        // 售罄即时置 ended
        const fresh = await this.findOne(ctx, activityId);
        if (fresh && fresh.soldCount >= fresh.totalStock) {
            fresh.status = 'ended';
            await this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity).save(fresh);
            core_1.Logger.info(`PreSaleActivity ${activityId} ended due to stock depletion`, constants_1.loggerCtx);
        }
        // 生成期次实例（软依赖 payment-schedule-plugin；未启用时跳过，薄壳回退旧路径）。
        // 重新取价格重算后的订单（Promotion 预售价此时已生效）。
        const pricedOrder = await this.orderService.findOne(ctx, order.id);
        if (pricedOrder) {
            await (0, payment_schedule_bridge_1.createScheduleForOrder)(ctx, (0, pre_sale_runtime_1.getPreSaleInjector)(), pricedOrder, activity);
        }
        return this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant']);
    }
    /* ------------------------- 两阶段支付 ------------------------- */
    /**
     * 全款预售：一次收清。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)；否则旧路径直接收全额。
     */
    async payPreSaleFull(ctx, orderId, method) {
        await this.assertPaymentMethodAllowed(ctx, method);
        const order = await this.requirePreSaleOrder(ctx, orderId);
        const activity = await this.requireActiveActivity(ctx, order);
        if (activity.mode !== 'full') {
            throw new core_1.UserInputError('This activity requires deposit pre-sale payment flow');
        }
        if (await (0, payment_schedule_bridge_1.payViaSchedule)(ctx, (0, pre_sale_runtime_1.getPreSaleInjector)(), order, 1, method)) {
            return this.reload(ctx, orderId);
        }
        await this.createSettledPayment(ctx, order, order.totalWithTax, method);
        return this.reload(ctx, orderId);
    }
    /**
     * 定金预售：付定金。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)（内部负责 ArrangingPayment→Deposited）；
     * 旧路径：createSettledPayment + 手动转 Deposited。
     */
    async payPreSaleDeposit(ctx, orderId, method) {
        var _a, _b;
        await this.assertPaymentMethodAllowed(ctx, method);
        const order = await this.requirePreSaleOrder(ctx, orderId);
        if (order.state !== 'ArrangingPayment') {
            throw new core_1.UserInputError('Order must be in ArrangingPayment state to pay deposit');
        }
        const activity = await this.requireActiveActivity(ctx, order);
        if (activity.mode !== 'deposit') {
            throw new core_1.UserInputError('This activity requires full pre-sale payment flow');
        }
        if (await (0, payment_schedule_bridge_1.payViaSchedule)(ctx, (0, pre_sale_runtime_1.getPreSaleInjector)(), order, 1, method)) {
            return this.reload(ctx, orderId);
        }
        const depositTotal = (_b = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.preSaleDepositTotal) !== null && _b !== void 0 ? _b : activity.depositAmount;
        if (!(depositTotal > 0)) {
            throw new core_1.UserInputError('Deposit amount must be greater than zero');
        }
        await this.createSettledPayment(ctx, order, depositTotal, method);
        await this.transition(ctx, orderId, 'Deposited');
        return this.reload(ctx, orderId);
    }
    /**
     * 定金预售：付尾款。
     * 校验状态 Deposited + 活动已到货 + 尾款窗口内（旧语义保留）。
     * 新路径：unlockTailForOrder + paySchedulePeriod（尾款期）；旧路径按剩余金额收款。
     */
    async payPreSaleTail(ctx, orderId, method) {
        var _a;
        await this.assertPaymentMethodAllowed(ctx, method);
        const order = await this.requirePreSaleOrder(ctx, orderId);
        if (order.state !== 'Deposited') {
            throw new core_1.UserInputError('Order must be in Deposited state to pay tail');
        }
        const activityId = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.preSaleActivityId;
        const activity = await this.findOne(ctx, activityId);
        if (!activity || activity.mode !== 'deposit') {
            throw new core_1.UserInputError('Pre-sale deposit activity not found');
        }
        if (activity.status !== 'delivered') {
            throw new core_1.UserInputError('Activity has not been delivered yet, tail payment not opened');
        }
        const now = new Date();
        if (activity.tailStartAt && now < activity.tailStartAt) {
            throw new core_1.UserInputError('Tail payment window has not started');
        }
        if (activity.tailEndAt && now > activity.tailEndAt) {
            throw new core_1.UserInputError('Tail payment window has ended');
        }
        if (await (0, payment_schedule_bridge_1.payTailViaSchedule)(ctx, (0, pre_sale_runtime_1.getPreSaleInjector)(), order, method)) {
            return this.reload(ctx, orderId);
        }
        const covered = await this.settledCovered(ctx, order.id);
        const tailAmount = order.totalWithTax - covered;
        if (tailAmount <= 0) {
            throw new core_1.UserInputError('Order already fully paid');
        }
        await this.createSettledPayment(ctx, order, tailAmount, method);
        return this.reload(ctx, orderId);
    }
    /* ------------------------- 查询 ------------------------- */
    async findActive(ctx) {
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        const now = new Date();
        return repo
            .createQueryBuilder('psa')
            .innerJoin('psa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('psa.status IN (:...statuses)', { statuses: ['active', 'delivered'] })
            .andWhere('psa.startAt <= :now', { now })
            .andWhere('psa.endAt >= :now', { now })
            .getMany();
    }
    /* ------------------------- 库存锁定 / 回滚 ------------------------- */
    /**
     * 订单取消时按订单内预售行实际件数回滚锁定库存。
     */
    async releaseStockForOrder(ctx, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ]);
        if (!order)
            return;
        const activityId = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.preSaleActivityId;
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
        await this.releaseStockAtomic(ctx, activityId, qty);
    }
    /* ------------------------- 私有工具 ------------------------- */
    /**
     * 定金 20% 法定上限硬校验（设计 §10 合规硬点 1：超出拒绝保存）。
     * 基准价：presalePrice > 0 ? presalePrice : variant.priceWithTax（原价）。
     * 注：ProductVariant.priceWithTax 是运行时计算值（依赖 listPrice/taxRateApplied），
     * 裸 repository.findOne 不会填充（恒为 0），故经 ProductVariantService.findOne
     * 取已应用渠道价格/税的变体；变体不存在时返回 undefined（与计划的容错语义一致）。
     */
    async assertLegalDepositCap(ctx, input) {
        var _a, _b;
        const mode = input.mode;
        const depositAmount = Number((_a = input.depositAmount) !== null && _a !== void 0 ? _a : 0);
        if (mode !== 'deposit' || !(depositAmount > 0))
            return;
        let base = Number((_b = input.presalePrice) !== null && _b !== void 0 ? _b : 0);
        if (!(base > 0) && input.variantId != null) {
            const variant = await this.productVariantService.findOne(ctx, input.variantId);
            if (variant)
                base = variant.priceWithTax;
        }
        if (!(base > 0)) {
            throw new core_1.UserInputError('Cannot validate deposit cap: base price unknown (set presalePrice or ensure variant exists)');
        }
        const cap = Math.floor(base * constants_1.LEGAL_DEPOSIT_CAP_RATIO);
        if (depositAmount > cap) {
            throw new core_1.UserInputError(`Deposit ${depositAmount} exceeds legal cap ${cap} (20% of base price ${base})`);
        }
    }
    /**
     * 校验订单已绑定预售活动，并返回重载后的订单（含 lines.productVariant）。
     * 同时校验订单归属：只允许订单所属客户本人支付，防止 A 用户拿 B 的 orderId 发起支付（IDOR）。
     */
    async requirePreSaleOrder(ctx, orderId) {
        var _a;
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'customer.user',
            'lines',
            'lines.productVariant',
        ]);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        this.assertOrderOwner(ctx, order);
        if (!((_a = order.customFields) === null || _a === void 0 ? void 0 : _a.preSaleActivityId)) {
            throw new core_1.UserInputError('Order is not bound to a pre-sale activity');
        }
        return order;
    }
    /** 订单归属校验：order.customer.user.id 必须等于当前登录用户 */
    assertOrderOwner(ctx, order) {
        var _a, _b;
        const ownerUserId = (_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (ctx.activeUserId == null ||
            ownerUserId == null ||
            String(ownerUserId) !== String(ctx.activeUserId)) {
            throw new core_1.UserInputError('You can only pay for your own order');
        }
    }
    /**
     * 支付方式服务端白名单：必须是当前渠道已启用的 PaymentMethod code，
     * 不存在/已停用/不属于本渠道一律拒绝（不信任前端传入的 method 字符串）。
     */
    async assertPaymentMethodAllowed(ctx, method) {
        if (!method || typeof method !== 'string') {
            throw new core_1.UserInputError('Payment method is required');
        }
        await this.paymentMethodService.getMethodAndOperations(ctx, method);
    }
    /**
     * 校验订单关联活动存在且处于可支付窗口（active/delivered + 窗口内）。
     */
    async requireActiveActivity(ctx, order) {
        var _a;
        const activity = await this.findOne(ctx, (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.preSaleActivityId);
        if (!activity) {
            throw new core_1.UserInputError('Pre-sale activity not found');
        }
        if (activity.status !== 'active' && activity.status !== 'delivered') {
            throw new core_1.UserInputError('Pre-sale activity is not payable now');
        }
        const now = new Date();
        if (activity.startAt && now < activity.startAt) {
            throw new core_1.UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new core_1.UserInputError('Activity has ended');
        }
        return activity;
    }
    /**
     * 创建一笔已 Settled 的指定金额 Payment 并挂到订单。
     * 指定金额由调用方给出（定金=depositTotal，尾款=剩余，全款=totalWithTax），
     * 不走原生 addPaymentToOrder（那是一次收全额剩余，无法表达定金中间态）。
     */
    async createSettledPayment(ctx, order, amount, method) {
        var _a, _b;
        const payment = await this.paymentService.createPayment(ctx, order, amount, method, {});
        if (payment instanceof Error || payment.errorCode) {
            throw new core_1.UserInputError(`Payment failed: ${(_b = (_a = payment.message) !== null && _a !== void 0 ? _a : payment.errorCode) !== null && _b !== void 0 ? _b : 'unknown'}`);
        }
        const settledPayment = payment;
        if (settledPayment.state !== 'Settled') {
            throw new core_1.UserInputError(`Payment not settled (state: ${settledPayment.state})`);
        }
    }
    /**
     * 订单状态转移（幂等失败抛出）。
     */
    async transition(ctx, orderId, state) {
        var _a, _b, _c;
        const result = await this.orderService.transitionToState(ctx, orderId, state);
        const err = result;
        if (err instanceof Error || err.errorCode) {
            const reason = (_c = (_b = (_a = err.transitionError) !== null && _a !== void 0 ? _a : err.message) !== null && _b !== void 0 ? _b : err.errorCode) !== null && _c !== void 0 ? _c : 'unknown';
            throw new core_1.UserInputError(`Transition to ${state} failed: ${reason}`);
        }
    }
    async reload(ctx, orderId) {
        return (await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ]));
    }
    /** 已 Settled 支付累计金额 */
    async settledCovered(ctx, orderId) {
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        return payments.reduce((sum, p) => (p.state === 'Settled' ? sum + p.amount : sum), 0);
    }
    /**
     * 限购校验：同客户该活动非取消订单累计预售件数 + 本次 qty <= limitPerUser。
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
            if (((_b = o.customFields) === null || _b === void 0 ? void 0 : _b.preSaleActivityId) !== Number(activity.id))
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
     * 原子锁定库存：DB UPDATE soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    async reserveStock(ctx, activityId, qty, activity) {
        var _a;
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        const result = await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount + ${qty}` })
            .where('id = :id AND soldCount + :qty <= totalStock', {
            id: activityId,
            qty,
        })
            .execute();
        if (((_a = result.affected) !== null && _a !== void 0 ? _a : 0) === 0) {
            throw new core_1.UserInputError('Sold out');
        }
        core_1.Logger.info(`PreSaleActivity ${activityId}: locked ${qty} (sold ${activity.soldCount + qty}/${activity.totalStock})`, constants_1.loggerCtx);
    }
    /**
     * 订单取消时原子回滚锁定库存。WHERE soldCount - qty >= 0 防负数。
     * 回滚后若活动曾因售罄置 ended、仍在窗口内且未占满，恢复为 active。
     */
    async releaseStockAtomic(ctx, activityId, quantity) {
        const repo = this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity);
        await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount - ${quantity}` })
            .where('id = :id AND soldCount - :qty >= 0', { id: activityId, qty: quantity })
            .execute();
        await this.restoreActiveIfPossible(ctx, activityId);
    }
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
            await this.connection.getRepository(ctx, pre_sale_activity_entity_1.PreSaleActivity).save(activity);
            core_1.Logger.info(`PreSaleActivity ${activityId} restored to active after stock release (sold ${activity.soldCount}/${activity.totalStock})`, constants_1.loggerCtx);
        }
    }
};
exports.PreSaleService = PreSaleService;
exports.PreSaleService = PreSaleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder,
        core_1.OrderService,
        core_1.PaymentService,
        core_1.PaymentMethodService,
        core_1.ProductVariantService])
], PreSaleService);
//# sourceMappingURL=pre-sale.service.js.map