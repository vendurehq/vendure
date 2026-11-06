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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatePayService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const constants_1 = require("../constants");
const pos_session_entity_1 = require("../entities/pos-session.entity");
const pos_order_service_1 = require("./pos-order.service");
const db_columns_1 = require("./db-columns");
const loggerCtx = 'AggregatePayService';
/**
 * 聚合码支付服务：
 * - createPendingPayment: 创建 Payment(state=Created) + Order → ArrangingPayment
 * - confirmPayment: Payment Created → Authorized（客户已扫码付款）
 * - settlePayment: Payment Authorized → Settled（关班时批量结算）
 * - failPayment: Payment Created → Cancelled（超时）
 *
 * 关键实现细节（Vendure 3.6.4）：
 * 1. PaymentService.transitionToState 对 'Authorized' 不走 handler，可直接调用
 * 2. PaymentService.transitionToState 对 'Settled' 会调 settlePayment → handler
 *    'aggregate' 方法未注册 PaymentMethodHandler，会报 not-found
 *    故 Authorized → Settled 直接改 state + 手动 transition Order
 * 3. Order transitionToState 的 checkPaymentsCoverTotal 会校验已结算支付覆盖总额
 * 4. onTransitionEnd 会在 Payment 全部 Settled 时自动 transition Order 到 PaymentSettled
 *
 * 事务内必须用 transactionalConnection.getRepository(txCtx, Entity) 而非
 * connection.getRepository(Entity)，否则操作不在事务中。
 *
 * customFields 是 embedded entity（CustomPaymentFields），不能用
 * repository.update(id, { [colName]: val }) 更新——TypeORM update 接收的是
 * entity property 名而非列名。正确做法：load → modify → save。
 */
let AggregatePayService = class AggregatePayService {
    constructor(connection, transactionalConnection, orderService, paymentService, posOrderService) {
        this.connection = connection;
        this.transactionalConnection = transactionalConnection;
        this.orderService = orderService;
        this.paymentService = paymentService;
        this.posOrderService = posOrderService;
    }
    /**
     * 创建聚合码待支付 Payment。
     * 1. 确保 session 有活跃 Order
     * 2. Order → ArrangingPayment
     * 3. 创建 Payment(state=Created, method=aggregate, customFields.aggregatePayStatus=pending)
     * 4. 添加 Payment 到 Order.payments 关系
     * 返回 Payment，Order 仍处于 ArrangingPayment 状态。
     */
    async createPendingPayment(ctx, session, input) {
        const order = await this.posOrderService.ensureActiveOrder(ctx, session);
        if (order.lines.length === 0) {
            throw new core_1.UserInputError('购物车为空，无法发起聚合码支付');
        }
        // Order → ArrangingPayment
        const arrangeResult = await this.orderService.transitionToState(ctx, order.id, 'ArrangingPayment');
        if ('errorCode' in arrangeResult) {
            throw new core_1.UserInputError(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
        }
        // 创建 Payment in Created state
        const payment = new core_1.Payment({
            amount: order.totalWithTax,
            order,
            method: 'aggregate',
            state: 'Created',
            metadata: { aggregatePayCode: input.aggregatePayCode },
        });
        payment.customFields = {
            aggregatePayCode: input.aggregatePayCode,
            aggregatePayStatus: constants_1.AGGREGATE_PAY_STATUS.PENDING,
            needsManualRefund: false,
            posSessionId: session.id,
        };
        const saved = await this.connection.getRepository(core_1.Payment).save(payment);
        // 添加到 Order.payments 关系
        await this.connection
            .getRepository(core_1.Order)
            .createQueryBuilder()
            .relation('payments')
            .of(order)
            .add(saved);
        return saved;
    }
    /**
     * 确认聚合码支付（客户已扫码付款）。
     * Payment: Created → Authorized（PaymentService.transitionToState 支持，不走 handler）
     * Order: 自动 transition 到 PaymentAuthorized（由 onTransitionEnd 触发）
     */
    async confirmPayment(ctx, paymentId) {
        const payment = await this.findPaymentOrThrow(paymentId);
        if (payment.state !== 'Created') {
            throw new core_1.UserInputError(`Payment ${paymentId} 状态为 ${payment.state}，无法确认（需 Created）`);
        }
        // Created → Authorized（PaymentService 对非 Settled/Cancelled 状态直接用 state machine）
        const result = await this.paymentService.transitionToState(ctx, paymentId, 'Authorized');
        if ('errorCode' in result) {
            throw new core_1.UserInputError(`确认支付失败: ${result.message}`);
        }
        // 更新 customFields.aggregatePayStatus
        await this.updateAggregatePayStatus(ctx, paymentId, constants_1.AGGREGATE_PAY_STATUS.CONFIRMED);
        return this.findPaymentOrThrow(paymentId);
    }
    /**
     * 结算聚合码支付（关班时批量结算）。
     * Payment: Authorized → Settled（直接改 state，绕过 handler）
     * Order: 手动 transition 到 PaymentSettled
     */
    async settlePayment(ctx, paymentId) {
        const payment = await this.findPaymentOrThrow(paymentId, ['order']);
        if (payment.state !== 'Authorized') {
            throw new core_1.UserInputError(`Payment ${paymentId} 状态为 ${payment.state}，无法结算（需 Authorized）`);
        }
        await this.transactionalConnection.withTransaction(ctx, async (txCtx) => {
            // 1. 直接更新 Payment.state = 'Settled'（用事务连接）
            payment.state = 'Settled';
            await this.transactionalConnection
                .getRepository(txCtx, core_1.Payment)
                .save(payment, { reload: false });
            // 2. 更新 customFields.aggregatePayStatus（load-modify-save）
            //    必须传 txCtx：用独立连接更新同一 payment 行会等待本事务持有的行锁，
            //    而本事务又在等这个调用返回 —— 形成跨连接自锁（批量结算卡住）。
            await this.updateAggregatePayStatus(txCtx, paymentId, constants_1.AGGREGATE_PAY_STATUS.SETTLED);
            // 3. 手动 transition Order → PaymentSettled
            //    checkPaymentsCoverTotal 会校验已结算支付覆盖总额
            const order = payment.order;
            if (order.state !== 'PaymentSettled') {
                const result = await this.orderService.transitionToState(txCtx, order.id, 'PaymentSettled');
                if ('errorCode' in result) {
                    throw new core_1.UserInputError(`Order transition 到 PaymentSettled 失败: ${result.message}`);
                }
            }
        });
        // 4. 清除 session.activeOrderId
        const session = await this.findSessionByOrderId(Number(payment.order.id));
        if (session) {
            await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, {
                activeOrderId: null,
            });
        }
        return this.findPaymentOrThrow(paymentId);
    }
    /**
     * 标记聚合码支付失败（超时）。
     * Payment: Created → Cancelled（直接改 state）
     * Order: ArrangingPayment → AddingItems（退回购物车状态）
     */
    async failPayment(ctx, paymentId) {
        const payment = await this.findPaymentOrThrow(paymentId, ['order']);
        if (payment.state !== 'Created') {
            throw new core_1.UserInputError(`Payment ${paymentId} 状态为 ${payment.state}，无法标记失败（需 Created）`);
        }
        await this.transactionalConnection.withTransaction(ctx, async (txCtx) => {
            // 1. 直接更新 Payment.state = 'Cancelled'（用事务连接）
            payment.state = 'Cancelled';
            await this.transactionalConnection
                .getRepository(txCtx, core_1.Payment)
                .save(payment, { reload: false });
            // 2. 更新 customFields.aggregatePayStatus（load-modify-save）
            await this.updateAggregatePayStatus(txCtx, paymentId, constants_1.AGGREGATE_PAY_STATUS.FAILED);
            // 3. Order: ArrangingPayment → AddingItems
            const order = payment.order;
            if (order.state === 'ArrangingPayment') {
                const result = await this.orderService.transitionToState(txCtx, order.id, 'AddingItems');
                if ('errorCode' in result) {
                    throw new core_1.UserInputError(`Order 退回 AddingItems 失败: ${result.message}`);
                }
            }
        });
        return this.findPaymentOrThrow(paymentId);
    }
    /**
     * 批量结算班次内所有 confirmed 状态的聚合码支付。
     * 关班时调用，返回成功笔数与逐笔失败原因（失败不再静默丢弃）。
     */
    async settleSessionPayments(ctx, sessionId) {
        // 查找班次内所有 aggregatePayStatus='confirmed' 的 Payment
        // Payment.customFields 是 embedded entity，动态查找实际列名
        const statusCol = await (0, db_columns_1.findDbColumn)(this.connection, 'payment', 'aggregatePayStatus');
        const sessionCol = await (0, db_columns_1.findDbColumn)(this.connection, 'payment', 'posSessionId');
        if (!statusCol || !sessionCol) {
            core_1.Logger.warn(`[aggregatePay] 无法定位聚合码支付列（statusCol=${statusCol}, sessionCol=${sessionCol}），批量结算跳过`, loggerCtx);
            return { settled: 0, failed: [] };
        }
        const payments = (await this.connection
            .getRepository(core_1.Payment)
            .createQueryBuilder('pay')
            .leftJoinAndSelect('pay.order', 'ord')
            .where(`pay."${statusCol}" = :status`, {
            status: constants_1.AGGREGATE_PAY_STATUS.CONFIRMED,
        })
            .andWhere(`pay."${sessionCol}" = :sid`, { sid: sessionId })
            .getMany());
        let settled = 0;
        const failed = [];
        for (const payment of payments) {
            try {
                await this.settlePayment(ctx, payment.id);
                settled++;
            }
            catch (e) {
                // 单笔失败不阻断其他笔，但必须上报原因，不能静默计数
                const reason = e instanceof Error ? e.message : String(e);
                failed.push({ paymentId: String(payment.id), reason });
                core_1.Logger.warn(`[aggregatePay] 批量结算失败 paymentId=${payment.id}: ${reason}`, loggerCtx);
            }
        }
        return { settled, failed };
    }
    /**
     * 根据聚合码查找待支付 Payment。
     */
    async findByCode(aggregatePayCode) {
        // 查找 customFields.aggregatePayCode = code 的 Payment
        const codeCol = await (0, db_columns_1.findDbColumn)(this.connection, 'payment', 'aggregatePayCode');
        if (!codeCol)
            return null;
        return this.connection
            .getRepository(core_1.Payment)
            .createQueryBuilder('pay')
            .leftJoinAndSelect('pay.order', 'ord')
            .where(`pay."${codeCol}" = :code`, { code: aggregatePayCode })
            .getOne();
    }
    async findPaymentOrThrow(paymentId, relations = []) {
        const payment = await this.connection.getRepository(core_1.Payment).findOne({
            where: { id: paymentId },
            relations: relations.length > 0 ? relations : undefined,
        });
        if (!payment) {
            throw new core_1.UserInputError(`Payment ${paymentId} 不存在`);
        }
        return payment;
    }
    /**
     * 更新 Payment.customFields.aggregatePayStatus。
     *
     * customFields 是 embedded entity（CustomPaymentFields），TypeORM 的
     * repository.update(id, { colName: val }) 接收的是 entity property 名
     * 而非列名，直接用 PRAGMA 列名做 key 无法正确映射到 embedded 属性。
     * 正确做法：load entity → modify customFields → save entity。
     *
     * @param ctx 传入调用方的事务上下文；在 withTransaction 内必须传 txCtx。
     *            若此处固定用 this.connection，独立连接更新同一 payment 行会等待
     *            外层事务持有的行锁，而外层又在等本函数返回 → 跨连接自锁。
     */
    async updateAggregatePayStatus(ctx, paymentId, status) {
        var _a;
        const repo = this.transactionalConnection.getRepository(ctx, core_1.Payment);
        const payment = await repo.findOne({
            where: { id: paymentId },
        });
        if (!payment) {
            core_1.Logger.warn(`[aggregatePay] 更新聚合码支付状态时找不到 paymentId=${paymentId}（目标状态 ${status}）`, loggerCtx);
            return;
        }
        payment.customFields = Object.assign(Object.assign({}, ((_a = payment.customFields) !== null && _a !== void 0 ? _a : {})), { aggregatePayStatus: status });
        await repo.save(payment);
    }
    async findSessionByOrderId(orderId) {
        return this.connection.getRepository(pos_session_entity_1.PosSession).findOne({
            where: { activeOrderId: orderId },
        });
    }
};
exports.AggregatePayService = AggregatePayService;
exports.AggregatePayService = AggregatePayService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __param(1, (0, common_1.Inject)(core_1.TransactionalConnection)),
    __param(2, (0, common_1.Inject)(core_1.OrderService)),
    __param(3, (0, common_1.Inject)(core_1.PaymentService)),
    __param(4, (0, common_1.Inject)(pos_order_service_1.PosOrderService)),
    __metadata("design:paramtypes", [typeorm_2.Connection,
        core_1.TransactionalConnection,
        core_1.OrderService,
        core_1.PaymentService,
        pos_order_service_1.PosOrderService])
], AggregatePayService);
//# sourceMappingURL=aggregate-pay.service.js.map