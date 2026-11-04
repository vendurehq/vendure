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
exports.PosOrderService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const pos_session_entity_1 = require("../entities/pos-session.entity");
const member_price_calculator_1 = require("./member-price-calculator");
const promotion_engine_service_1 = require("./promotion-engine.service");
/**
 * POS 收银核心服务：
 * - ensureActiveOrder: 班次内有活跃 Order 则复用，否则创建新 Order 并绑定 custom fields
 * - addPosItem: 加商品到 Order，通过 addItemToOrder 第 5 参设置 OrderLine custom fields
 * - updatePosItem: 修改 OrderLine 数量
 * - checkoutPosOrder: transitionToState ArrangingPayment → addManualPaymentToOrder → transitionToState PaymentSettled
 *
 * 关键 API 约束（Vendure 3.6.4 实际签名，已通过 Grep 验证）：
 * 1. OrderService.create(ctx, userId?) 不接受 stockLocationCode/customFields
 * 2. addItemToOrder(ctx, orderId, variantId, qty, customFields?) 第 5 参设 OrderLine 字段
 * 3. addManualPaymentToOrder 必须在事务中；method 字段不校验 PaymentMethod 注册
 * 4. PaymentSettled 需手动 transitionToState；checkPaymentsCoverTotal 默认校验
 */
let PosOrderService = class PosOrderService {
    constructor(connection, transactionalConnection, orderService, stockMovementService, memberPriceCalculator, promotionEngine) {
        this.connection = connection;
        this.transactionalConnection = transactionalConnection;
        this.orderService = orderService;
        this.stockMovementService = stockMovementService;
        this.memberPriceCalculator = memberPriceCalculator;
        this.promotionEngine = promotionEngine;
    }
    /**
     * 确保班次有活跃 Order。无则创建并绑定 custom fields + session.customer。
     */
    async ensureActiveOrder(ctx, session) {
        var _a;
        if (session.activeOrderId) {
            const existing = await this.orderService.findOne(ctx, session.activeOrderId);
            if (existing && existing.active) {
                // 取单/历史挂单可能缺少 orderKind（旧数据），补齐后再返回，
                // 否则 marketplace 订单流程会以 "not all lines have shipping" 阻断转入 ArrangingPayment。
                if (((_a = existing.customFields) === null || _a === void 0 ? void 0 : _a.orderKind) !== 'assistant') {
                    await this.connection.getRepository(core_1.Order).update(existing.id, {
                        customFields: Object.assign(Object.assign({}, existing.customFields), { orderKind: 'assistant' }),
                    });
                }
                return existing;
            }
        }
        // 创建新 Order（create 不接受 customFields，需创建后 update）
        const order = await this.orderService.create(ctx);
        // 设置 Order custom fields + 绑定 session.customer（会员价引擎依赖 order.customer.customFields.memberLevel）
        // orderKind='assistant'：POS 单无配送行，marketplace 订单流程据此豁免 shippingLineId 校验（与公众号助手直付单同语义）
        await this.connection.getRepository(core_1.Order).update(order.id, Object.assign({ customFields: {
                posSessionId: session.id,
                orderType: 'sale',
                terminalCode: session.terminal.code,
                orderKind: 'assistant',
            } }, (session.customerId
            ? { customer: { id: session.customerId } }
            : {})));
        // 更新 session.activeOrderId
        await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, {
            activeOrderId: Number(order.id),
        });
        session.activeOrderId = Number(order.id);
        return this.orderService.findOne(ctx, order.id);
    }
    /**
     * 加商品到当前班次 Order。通过 addItemToOrder 第 5 参设置 OrderLine custom fields。
     * 若 session 绑定会员且匹配会员价规则：自动应用 discountPercent（未显式传 discount 时）。
     * 会员价实际生效：更新 OrderLine.listPrice = Math.floor(originalListPrice * discountPercent / 100)
     */
    async addPosItem(ctx, session, input) {
        var _a, _b, _c, _d, _e, _f;
        const order = await this.ensureActiveOrder(ctx, session);
        // 显式 discount 优先（收银员手动改价）；未传时若 session 绑定会员，应用会员价规则
        let discount = input.discount;
        let memberPriceApplied = false;
        if (discount == null && session.customerId) {
            const customer = (_a = session.customer) !== null && _a !== void 0 ? _a : { id: session.customerId };
            const calc = await this.memberPriceCalculator.calculate(ctx, customer, Number(input.productVariantId));
            discount = calc.discountPercent;
            memberPriceApplied = calc.applied;
        }
        const finalDiscount = discount !== null && discount !== void 0 ? discount : 100;
        // 记录加购前的 line id 集合，用于定位新加的 line
        const beforeLineIds = new Set(order.lines.map((l) => Number(l.id)));
        const result = await this.orderService.addItemToOrder(ctx, order.id, input.productVariantId, input.quantity, {
            originalPrice: (_b = input.originalPrice) !== null && _b !== void 0 ? _b : 0,
            discount: finalDiscount,
            memberPriceApplied: memberPriceApplied || finalDiscount < 100,
            isGift: (_c = input.isGift) !== null && _c !== void 0 ? _c : false,
            note: (_d = input.note) !== null && _d !== void 0 ? _d : null,
        });
        // addItemToOrder 返回 ErrorResultUnion，需检查是否出错
        if ('errorCode' in result) {
            throw new core_1.UserInputError(`加商品失败: ${result.message}`);
        }
        // 应用会员价/手动折扣到 listPrice（Vendure 的 listPrice 决定 unitPrice）
        if (finalDiscount < 100) {
            const reloaded = await this.orderService.findOne(ctx, order.id);
            if (reloaded) {
                // 找新加的 line（同 variant 的最新 line）；若已合并则取该 variant 的 line
                const targetLine = reloaded.lines.find((l) => !beforeLineIds.has(Number(l.id)) ||
                    Number(l.productVariant.id) === Number(input.productVariantId));
                if (targetLine) {
                    const originalListPrice = (_e = targetLine.initialListPrice) !== null && _e !== void 0 ? _e : targetLine.listPrice;
                    const newListPrice = Math.floor((originalListPrice * finalDiscount) / 100);
                    await this.connection.getRepository(core_1.OrderLine).update(Number(targetLine.id), {
                        listPrice: newListPrice,
                    });
                }
            }
        }
        // 促销引擎 reapply：基于当前 order + session.customer 重算最优（会员价 vs 促销规则互斥）
        // 传入 session.stockLocation.id 用于买赠库存校验
        const orderForReapply = (await this.orderService.findOne(ctx, order.id));
        if (orderForReapply) {
            const customer = (_f = session.customer) !== null && _f !== void 0 ? _f : (session.customerId ? { id: session.customerId } : null);
            const stockLocationId = session.stockLocation ? Number(session.stockLocation.id) : null;
            return this.promotionEngine.reapply(ctx, { customer, stockLocationId }, orderForReapply);
        }
        return this.orderService.findOne(ctx, order.id);
    }
    /**
     * 修改 OrderLine 数量。
     */
    async updatePosItem(ctx, session, input) {
        if (!session.activeOrderId) {
            throw new core_1.UserInputError('当前班次无活跃订单');
        }
        const result = await this.orderService.adjustOrderLine(ctx, session.activeOrderId, input.orderLineId, input.quantity);
        if ('errorCode' in result) {
            throw new core_1.UserInputError(`修改商品失败: ${result.message}`);
        }
        return this.orderService.findOne(ctx, session.activeOrderId);
    }
    /**
     * 结账：transitionToState ArrangingPayment → addManualPaymentToOrder → transitionToState PaymentSettled。
     * addManualPaymentToOrder 必须在事务中，整个结账流程用 withTransaction 包裹。
     */
    async checkoutPosOrder(ctx, session, input) {
        const order = await this.ensureActiveOrder(ctx, session);
        if (order.lines.length === 0) {
            throw new core_1.UserInputError('购物车为空，无法结账');
        }
        const settledPayments = [];
        await this.transactionalConnection.withTransaction(ctx, async (txCtx) => {
            var _a, _b;
            // 1. AddingItems → ArrangingPayment
            const arrangeResult = await this.orderService.transitionToState(txCtx, order.id, 'ArrangingPayment');
            if ('errorCode' in arrangeResult) {
                throw new core_1.UserInputError(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
            }
            // 2. 逐笔添加 manual payment（内部 Payment 直接 Created → Settled）
            //    defaultPaymentProcess.onTransitionEnd 会在 Payment 覆盖 total 时
            //    自动 transition order 到 PaymentSettled，无需手动调用。
            for (const pay of input.payments) {
                const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
                    orderId: order.id,
                    method: pay.method,
                    transactionId: pay.transactionId,
                    metadata: (_a = pay.metadata) !== null && _a !== void 0 ? _a : {},
                });
                if ('errorCode' in payResult) {
                    throw new core_1.UserInputError(`添加支付失败: ${payResult.message}`);
                }
            }
            // 3. 收集 Payment 快照并校验 order 已到 PaymentSettled
            const finalOrder = await this.orderService.findOne(txCtx, order.id, ['payments', 'lines']);
            if (finalOrder) {
                settledPayments.push(...((_b = finalOrder.payments) !== null && _b !== void 0 ? _b : []));
                if (finalOrder.state !== 'PaymentSettled') {
                    throw new core_1.UserInputError(`结账未完成：订单状态为 ${finalOrder.state}，预期 PaymentSettled（支付金额可能不足）`);
                }
                // 4. POS 无 Fulfillment 步骤，手动触发 SALE 扣减（stockOnHand--, stockAllocated--）
                //    Vendure 默认在 ArrangingPayment→PaymentSettled 时已执行 ALLOCATE（分配），
                //    但 SALE（实际扣减）只在 Fulfillment Shipped 时触发。POS 场景需手动补上。
                const orderLines = finalOrder.lines.map(line => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                }));
                await this.stockMovementService.createSalesForOrder(txCtx, orderLines);
            }
        });
        // 4. 清除 session.activeOrderId
        await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, {
            activeOrderId: null,
        });
        session.activeOrderId = null;
        const finalOrder = await this.orderService.findOne(ctx, order.id, ['payments']);
        return { order: finalOrder, payments: settledPayments };
    }
    /**
     * 离线订单同步入口：创建 Draft Order → 加商品 → 结账。
     * 不依赖 PosSession（离线订单可能没有对应的服务端班次），直接创建独立 Order。
     * 库存不足（addItemToOrder 抛 Insufficient stock）→ 抛 code='OUT_OF_STOCK' 错误。
     */
    async createOrderFromOffline(ctx, order) {
        var _a, _b, _c, _d;
        // 1. 创建 Draft Order
        const newOrder = await this.orderService.create(ctx);
        await this.connection.getRepository(core_1.Order).update(newOrder.id, {
            customFields: {
                orderType: order.orderType,
                terminalCode: order.terminalCode,
                // 离线补单同为 POS 直付单，需豁免 marketplace 流程的 shippingLineId 校验
                orderKind: 'assistant',
            },
        });
        // 2. 遍历 lines 加商品
        for (const line of order.lines) {
            const discount = (_a = line.discount) !== null && _a !== void 0 ? _a : 100;
            const result = await this.orderService.addItemToOrder(ctx, newOrder.id, line.productVariantId, line.quantity, {
                originalPrice: (_b = line.originalPrice) !== null && _b !== void 0 ? _b : 0,
                discount,
                memberPriceApplied: discount < 100,
                isGift: (_c = line.isGift) !== null && _c !== void 0 ? _c : false,
                note: (_d = line.note) !== null && _d !== void 0 ? _d : null,
            });
            if ('errorCode' in result) {
                const err = new Error(result.message);
                if (result.errorCode === 'INSUFFICIENT_STOCK_ERROR') {
                    err.code = 'OUT_OF_STOCK';
                }
                throw err;
            }
        }
        // 3. 结账：transitionToState ArrangingPayment → addManualPaymentToOrder（事务）
        await this.transactionalConnection.withTransaction(ctx, async (txCtx) => {
            var _a;
            const arrangeResult = await this.orderService.transitionToState(txCtx, newOrder.id, 'ArrangingPayment');
            if ('errorCode' in arrangeResult) {
                throw new Error(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
            }
            for (const pay of order.payments) {
                const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
                    orderId: newOrder.id,
                    method: pay.method,
                    transactionId: pay.transactionId,
                    metadata: (_a = pay.metadata) !== null && _a !== void 0 ? _a : {},
                });
                if ('errorCode' in payResult) {
                    throw new Error(`添加支付失败: ${payResult.message}`);
                }
            }
        });
        // 4. 手动触发 SALE 扣减（与 checkoutPosOrder 同理，POS 无 Fulfillment）
        const settledOrder = await this.orderService.findOne(ctx, newOrder.id, ['payments', 'lines']);
        if (settledOrder && settledOrder.state === 'PaymentSettled') {
            const orderLines = settledOrder.lines.map(line => ({
                orderLineId: line.id,
                quantity: line.quantity,
            }));
            await this.stockMovementService.createSalesForOrder(ctx, orderLines);
        }
        // 5. 返回最终 Order
        const finalOrder = await this.orderService.findOne(ctx, newOrder.id, ['payments']);
        return finalOrder;
    }
    // ===== Phase 5: 退货与挂单 =====
    /**
     * 创建退货单：独立 orderType=refund 的 Order + 负数量 OrderLine 直插 + createCancellationsForOrderLines 回库。
     *
     * 关键约束：
     * 1. addItemToOrder 不接受负数量，需通过 OrderLine Repository 直插
     * 2. addManualPaymentToOrder 自动计算 amount = totalWithTax - totalCoveredBy，退货 total 为负 → Payment 负金额
     * 3. createCancellationsForOrderLines 不校验 orderLine.quantity 正负，基于 input.quantity(正数) 回库
     * 4. 原单必须 PaymentSettled，退货数量不超过原单已售数量（已退货数量需查关联 refund 单累加）
     */
    async createRefundOrder(ctx, session, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        // 1. 查原单
        const originalOrder = await this.orderService.findOne(ctx, input.originalOrderId, [
            'lines',
            'payments',
            'lines.productVariant',
        ]);
        if (!originalOrder) {
            throw new core_1.UserInputError(`原单 ${input.originalOrderId} 不存在`);
        }
        if (originalOrder.state !== 'PaymentSettled') {
            throw new core_1.UserInputError(`原单状态 ${originalOrder.state} 不允许退货，仅 PaymentSettled 可退货`);
        }
        if (((_a = originalOrder.customFields) === null || _a === void 0 ? void 0 : _a.orderType) === 'refund') {
            throw new core_1.UserInputError('退货单不允许再次退货');
        }
        // 2. 校验退货行与数量
        if (input.refundLines.length === 0) {
            throw new core_1.UserInputError('退货行不能为空');
        }
        for (const rl of input.refundLines) {
            if (rl.quantity <= 0) {
                throw new core_1.UserInputError('退货数量必须为正数');
            }
            const originalLine = originalOrder.lines.find(l => (0, core_1.idsAreEqual)(l.id, rl.orderLineId));
            if (!originalLine) {
                throw new core_1.UserInputError(`原单行 ${rl.orderLineId} 不存在`);
            }
            if (rl.quantity > originalLine.quantity) {
                throw new core_1.UserInputError(`退货数量 ${rl.quantity} 超过原单行数量 ${originalLine.quantity}`);
            }
        }
        // 3. 查询该原单已退货数量（防止超退）
        const alreadyRefundedMap = await this.getAlreadyRefundedQuantities(ctx, Number(originalOrder.id));
        for (const rl of input.refundLines) {
            const originalLine = originalOrder.lines.find(l => (0, core_1.idsAreEqual)(l.id, rl.orderLineId));
            const already = (_b = alreadyRefundedMap.get(Number(originalLine.id))) !== null && _b !== void 0 ? _b : 0;
            if (rl.quantity + already > originalLine.quantity) {
                throw new core_1.UserInputError(`原单行 ${originalLine.id} 累计退货 ${rl.quantity + already} 超过原售 ${originalLine.quantity}`);
            }
        }
        // 4. 创建独立 refund Order
        const refundOrder = await this.orderService.create(ctx);
        await this.connection.getRepository(core_1.Order).update(refundOrder.id, {
            customFields: {
                posSessionId: session.id,
                orderType: 'refund',
                refundedOrderId: Number(originalOrder.id),
                terminalCode: session.terminal.code,
                // 退货单无配送行，同样需要豁免 marketplace 流程的 shippingLineId 校验
                orderKind: 'assistant',
            },
        });
        // 5. 直插负数量 OrderLine（绕过 addItemToOrder 的正数量校验）
        const orderLineRepo = this.connection.getRepository(core_1.OrderLine);
        for (const rl of input.refundLines) {
            const originalLine = originalOrder.lines.find(l => (0, core_1.idsAreEqual)(l.id, rl.orderLineId));
            const newLine = new core_1.OrderLine({
                order: { id: refundOrder.id },
                productVariant: originalLine.productVariant,
                productVariantId: originalLine.productVariantId,
                quantity: -rl.quantity,
                listPrice: originalLine.listPrice,
                listPriceIncludesTax: originalLine.listPriceIncludesTax,
                initialListPrice: originalLine.initialListPrice,
                adjustments: (_c = originalLine.adjustments) !== null && _c !== void 0 ? _c : [],
                taxLines: (_d = originalLine.taxLines) !== null && _d !== void 0 ? _d : [],
            });
            newLine.customFields = {
                originalPrice: (_f = (_e = originalLine.customFields) === null || _e === void 0 ? void 0 : _e.originalPrice) !== null && _f !== void 0 ? _f : 0,
                discount: (_h = (_g = originalLine.customFields) === null || _g === void 0 ? void 0 : _g.discount) !== null && _h !== void 0 ? _h : 100,
                memberPriceApplied: (_k = (_j = originalLine.customFields) === null || _j === void 0 ? void 0 : _j.memberPriceApplied) !== null && _k !== void 0 ? _k : false,
                isGift: (_m = (_l = originalLine.customFields) === null || _l === void 0 ? void 0 : _l.isGift) !== null && _m !== void 0 ? _m : false,
                note: (_q = (_o = rl.reason) !== null && _o !== void 0 ? _o : (_p = originalLine.customFields) === null || _p === void 0 ? void 0 : _p.note) !== null && _q !== void 0 ? _q : null,
                originalOrderLineId: Number(originalLine.id),
            };
            await orderLineRepo.save(newLine);
        }
        // 6. 重算 Order 总额：直插 OrderLine 不触发 OrderCalculator，需手动累加
        //    line.proratedLinePrice/proratedLinePriceWithTax（负数量行 → 负数总额）。
        //    addManualPaymentToOrder 用 order.totalWithTax - totalCoveredBy 计算 payment.amount，
        //    subTotal/subTotalWithTax 未更新时 amount=0，导致退款金额为 0。
        const reloadedForCalc = await this.orderService.findOne(ctx, refundOrder.id, ['lines']);
        if (reloadedForCalc) {
            let subTotal = 0;
            let subTotalWithTax = 0;
            for (const line of reloadedForCalc.lines) {
                subTotal += line.proratedLinePrice;
                subTotalWithTax += line.proratedLinePriceWithTax;
            }
            await this.connection.getRepository(core_1.Order).update(refundOrder.id, {
                subTotal,
                subTotalWithTax,
            });
        }
        // 7. 事务: ArrangingPayment → addManualPaymentToOrder(cash, 负金额自动计算) → PaymentSettled
        await this.transactionalConnection.withTransaction(ctx, async (txCtx) => {
            var _a;
            const arrangeResult = await this.orderService.transitionToState(txCtx, refundOrder.id, 'ArrangingPayment');
            if ('errorCode' in arrangeResult) {
                throw new core_1.UserInputError(`退货单转入 ArrangingPayment 失败: ${arrangeResult.message}`);
            }
            const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
                orderId: refundOrder.id,
                method: 'cash',
                transactionId: `refund-${(_a = originalOrder.code) !== null && _a !== void 0 ? _a : originalOrder.id}`,
                metadata: { refund: true, originalOrderId: originalOrder.id },
            });
            if ('errorCode' in payResult) {
                throw new core_1.UserInputError(`添加退款支付失败: ${payResult.message}`);
            }
        });
        // 8. 库存回库: createCancellationsForOrderLines 传入 refundOrder 的 lineId + 正数量
        const reloadedRefundOrder = await this.orderService.findOne(ctx, refundOrder.id, ['lines']);
        if (reloadedRefundOrder) {
            const cancellationInputs = reloadedRefundOrder.lines.map(line => ({
                orderLineId: line.id,
                quantity: Math.abs(line.quantity),
            }));
            await this.stockMovementService.createCancellationsForOrderLines(ctx, cancellationInputs);
        }
        const finalRefundOrder = await this.orderService.findOne(ctx, refundOrder.id, ['payments']);
        return { refundOrder: finalRefundOrder, originalOrder };
    }
    /**
     * 查询某原单已累计被退货的数量（按 originalOrderLineId 聚合）。
     * 通过 refundedOrderId custom field 反查所有 refund 单及其 OrderLine，
     * 再用 OrderLine custom field originalOrderLineId 精确匹配原单行。
     */
    async getAlreadyRefundedQuantities(ctx, originalOrderId) {
        var _a, _b;
        const result = await this.connection.getRepository(core_1.Order).find({
            where: { customFields: { refundedOrderId: originalOrderId } },
            relations: ['lines'],
        });
        const map = new Map();
        for (const refundOrder of result) {
            for (const line of refundOrder.lines) {
                const originalLineId = (_a = line.customFields) === null || _a === void 0 ? void 0 : _a.originalOrderLineId;
                if (originalLineId != null) {
                    const qty = Math.abs(line.quantity);
                    map.set(originalLineId, ((_b = map.get(originalLineId)) !== null && _b !== void 0 ? _b : 0) + qty);
                }
            }
        }
        return map;
    }
    /**
     * 挂单: 把当前活跃 Order 的 orderType 改为 hold，清空 session.activeOrderId。
     * 挂单后该 Order 仍为 Draft（active=true），可在挂单列表中按 orderType=hold 过滤显示。
     */
    async holdOrder(ctx, session) {
        if (!session.activeOrderId) {
            throw new core_1.UserInputError('当前班次无活跃订单，无法挂单');
        }
        const order = await this.orderService.findOne(ctx, session.activeOrderId);
        if (!order) {
            throw new core_1.UserInputError('活跃订单不存在');
        }
        if (order.lines.length === 0) {
            throw new core_1.UserInputError('空订单不允许挂单');
        }
        await this.connection.getRepository(core_1.Order).update(order.id, {
            customFields: Object.assign(Object.assign({}, order.customFields), { orderType: 'hold' }),
        });
        await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, {
            activeOrderId: null,
        });
        session.activeOrderId = null;
        const updated = await this.orderService.findOne(ctx, order.id);
        return updated;
    }
    /**
     * 取单: 校验目标 Order 为 hold 状态 + 归属本终端 + 当前无活跃订单，
     * 然后把 orderType 改回 sale 并设为 session.activeOrderId。
     */
    async resumeOrder(ctx, session, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new core_1.UserInputError(`订单 ${orderId} 不存在`);
        }
        if (!order.active) {
            throw new core_1.UserInputError('该订单已结账，不可取单');
        }
        if (((_a = order.customFields) === null || _a === void 0 ? void 0 : _a.orderType) !== 'hold') {
            throw new core_1.UserInputError('该订单不是挂单状态，不可取单');
        }
        // 归属校验: 订单关联 session 的 terminal 必须等于当前 session.terminal
        const originalSessionId = (_b = order.customFields) === null || _b === void 0 ? void 0 : _b.posSessionId;
        if (originalSessionId) {
            const originalSession = await this.connection
                .getRepository(pos_session_entity_1.PosSession)
                .findOne({
                where: { id: originalSessionId },
                relations: ['terminal'],
            });
            if (!originalSession || originalSession.terminal.id !== session.terminal.id) {
                throw new core_1.UserInputError('跨终端取单被禁止');
            }
        }
        if (session.activeOrderId) {
            // 当前有活跃订单时，若为空订单（无 lines）则自动丢弃，允许取单；
            // posActiveOrder resolver 会 ensureActiveOrder 创建空 Order，
            // 导致挂单后任何 posActiveOrder 查询都会生成空活跃订单阻塞取单。
            const activeOrder = await this.orderService.findOne(ctx, session.activeOrderId, ['lines']);
            if (activeOrder && activeOrder.lines.length > 0) {
                throw new core_1.UserInputError('当前已有活跃订单，请先结账或挂单后再取单');
            }
            // 丢弃空订单：将其 active 置 false，并清空 session.activeOrderId
            if (activeOrder) {
                await this.connection.getRepository(core_1.Order).update(activeOrder.id, { active: false });
            }
            await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, { activeOrderId: null });
            session.activeOrderId = null;
        }
        await this.connection.getRepository(core_1.Order).update(order.id, {
            customFields: Object.assign(Object.assign({}, order.customFields), { orderType: 'sale', posSessionId: session.id, 
                // 旧挂单可能没有 orderKind，取单时补齐
                orderKind: 'assistant' }),
        });
        await this.connection.getRepository(pos_session_entity_1.PosSession).update(session.id, {
            activeOrderId: Number(order.id),
        });
        session.activeOrderId = Number(order.id);
        const updated = await this.orderService.findOne(ctx, order.id);
        return updated;
    }
    /**
     * 挂单列表: 当前 session.terminal 下所有 orderType=hold 的 Draft Order。
     * 按 updatedAt 倒序。
     */
    async findHeldOrders(ctx, session) {
        // 用 TypeORM repository find 而非 QueryBuilder 原生 SQL：customFields JSON 列在
        // sqljs/SQLite 下实际列名由 TypeORM 映射，原生 SQL `ord.customFields->>'key'` 报
        // "no such column"。find 方法的 customFields 嵌套过滤由 TypeORM 自动生成 json_extract。
        const orders = await this.connection.getRepository(core_1.Order).find({
            where: {
                active: true,
                customFields: {
                    orderType: 'hold',
                    terminalCode: session.terminal.code,
                },
            },
            order: { updatedAt: 'DESC' },
        });
        return orders;
    }
    /**
     * 按订单号查询原单（退货场景入口）。
     * 用 Vendure OrderService.findAll + filter code 精确匹配，返回带 lines/payments 的完整 Order。
     */
    async findByCode(ctx, code) {
        const result = await this.orderService.findAll(ctx, {
            filter: { code: { eq: code } },
            take: 1,
        });
        if (result.items.length === 0)
            return null;
        const orderId = result.items[0].id;
        return this.orderService.findOne(ctx, orderId, ['lines', 'payments', 'lines.productVariant']);
    }
};
exports.PosOrderService = PosOrderService;
exports.PosOrderService = PosOrderService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __param(1, (0, common_1.Inject)(core_1.TransactionalConnection)),
    __param(2, (0, common_1.Inject)(core_1.OrderService)),
    __param(3, (0, common_1.Inject)(core_1.StockMovementService)),
    __param(4, (0, common_1.Inject)(member_price_calculator_1.MemberPriceCalculator)),
    __param(5, (0, common_1.Inject)(promotion_engine_service_1.PromotionEngineService)),
    __metadata("design:paramtypes", [typeorm_2.Connection,
        core_1.TransactionalConnection,
        core_1.OrderService,
        core_1.StockMovementService,
        member_price_calculator_1.MemberPriceCalculator,
        promotion_engine_service_1.PromotionEngineService])
], PosOrderService);
//# sourceMappingURL=pos-order.service.js.map