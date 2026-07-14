import { Injectable } from '@nestjs/common';
import { ManualPaymentInput, RefundOrderInput } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import {
    PaymentStateTransitionError,
    RefundAmountError,
    RefundStateTransitionError,
} from '../../common/error/generated-graphql-admin-errors';
import { IneligiblePaymentMethodError } from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { PaymentMetadata } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { Logger } from '../../config/logger/vendure-logger';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { RefundLine } from '../../entity/order-line-reference/refund-line.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { Refund } from '../../entity/refund/refund.entity';
import { EventBus } from '../../event-bus/event-bus';
import { PaymentStateTransitionEvent } from '../../event-bus/events/payment-state-transition-event';
import { RefundStateTransitionEvent } from '../../event-bus/events/refund-state-transition-event';
import { PaymentState } from '../helpers/payment-state-machine/payment-state';
import { PaymentStateMachine } from '../helpers/payment-state-machine/payment-state-machine';
import { RefundStateMachine } from '../helpers/refund-state-machine/refund-state-machine';

import { PaymentMethodService } from './payment-method.service';

/**
 * @description
 * Contains methods relating to {@link Payment} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class PaymentService {
    constructor(
        private connection: TransactionalConnection,
        private paymentStateMachine: PaymentStateMachine,
        private refundStateMachine: RefundStateMachine,
        private paymentMethodService: PaymentMethodService,
        private eventBus: EventBus,
    ) {}

    async create(ctx: RequestContext, input: DeepPartial<Payment>): Promise<Payment> {
        const newPayment = new Payment({
            ...input,
            state: this.paymentStateMachine.getInitialState(),
        });
        return this.connection.getRepository(ctx, Payment).save(newPayment);
    }

    async findOneOrThrow(ctx: RequestContext, id: ID, relations: string[] = ['order']): Promise<Payment> {
        return await this.connection.getEntityOrThrow(ctx, Payment, id, {
            relations,
        });
    }

    /**
     * @description
     * Transitions a Payment to the given state.
     *
     * When updating a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `transitionPaymentToState()` method, which will also handle
     * updating the Order state too.
     */
    async transitionToState(
        ctx: RequestContext,
        paymentId: ID,
        state: PaymentState,
    ): Promise<Payment | PaymentStateTransitionError> {
        if (state === 'Settled') {
            return this.settlePayment(ctx, paymentId);
        }
        if (state === 'Cancelled') {
            return this.cancelPayment(ctx, paymentId);
        }
        const payment = await this.findOneOrThrow(ctx, paymentId);
        const fromState = payment.state;
        return this.transitionStateAndSave(ctx, payment, fromState, state);
    }

    getNextStates(payment: Payment): readonly PaymentState[] {
        return this.paymentStateMachine.getNextStates(payment);
    }

    /**
     * @description
     * Creates a new Payment.
     *
     * When creating a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `addPaymentToOrder()` method, which will also handle
     * updating the Order state too.
     */
    async createPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        method: string,
        metadata: any,
    ): Promise<Payment | IneligiblePaymentMethodError> {
        const { paymentMethod, handler, checker } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            method,
        );
        if (paymentMethod.checker && checker) {
            const eligible = await checker.check(ctx, order, paymentMethod.checker.args, paymentMethod);
            if (eligible === false || typeof eligible === 'string') {
                return new IneligiblePaymentMethodError({
                    eligibilityCheckerMessage: typeof eligible === 'string' ? eligible : undefined,
                });
            }
        }
        const result = await handler.createPayment(
            ctx,
            order,
            amount,
            paymentMethod.handler.args,
            metadata || {},
            paymentMethod,
        );
        const initialState = 'Created';
        // The DB-write sequence below (payment create, state transition, save, relation
        // add, onTransitionEnd hooks) is wrapped in withTransaction so it commits or
        // rolls back atomically — this is what fixes #4686 for this method. Note that
        // handler.createPayment above is intentionally outside the transaction (it is
        // a network call to a third-party gateway) and is NOT covered by this wrap.
        // If the gateway succeeds and a subsequent DB write fails, the resulting
        // orphaned charge must be reconciled at a higher level. Likewise, the `order`
        // entity was loaded by the caller outside this transaction.
        return this.connection.withTransaction(ctx, async txCtx => {
            const payment = await this.connection
                .getRepository(txCtx, Payment)
                .save(new Payment({ ...result, method, state: initialState }));
            const { finalize } = await this.paymentStateMachine.transition(
                txCtx,
                order,
                payment,
                result.state,
            );
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder()
                .relation('payments')
                .of(order)
                .add(payment);
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(initialState, result.state, txCtx, payment, order),
            );
            await finalize();
            return payment;
        });
    }

    /**
     * @description
     * Settles a Payment.
     *
     * When settling a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `settlePayment()` method, which will also handle
     * updating the Order state too.
     */
    async settlePayment(ctx: RequestContext, paymentId: ID): Promise<PaymentStateTransitionError | Payment> {
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, paymentId, {
            relations: ['order'],
        });
        const { paymentMethod, handler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            payment.method,
        );
        const settlePaymentResult = await handler.settlePayment(
            ctx,
            payment.order,
            payment,
            paymentMethod.handler.args,
            paymentMethod,
        );
        const fromState = payment.state;
        let toState: PaymentState;
        payment.metadata = this.mergePaymentMetadata(payment.metadata, settlePaymentResult.metadata);
        if (settlePaymentResult.success) {
            toState = 'Settled';
        } else {
            toState = settlePaymentResult.state || 'Error';
            payment.errorMessage = settlePaymentResult.errorMessage;
        }
        return this.transitionStateAndSave(ctx, payment, fromState, toState);
    }

    async cancelPayment(ctx: RequestContext, paymentId: ID): Promise<PaymentStateTransitionError | Payment> {
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, paymentId, {
            relations: ['order'],
        });
        const { paymentMethod, handler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            payment.method,
        );
        const cancelPaymentResult = await handler.cancelPayment(
            ctx,
            payment.order,
            payment,
            paymentMethod.handler.args,
            paymentMethod,
        );
        const fromState = payment.state;
        let toState: PaymentState;
        payment.metadata = this.mergePaymentMetadata(payment.metadata, cancelPaymentResult?.metadata);
        if (cancelPaymentResult == null || cancelPaymentResult.success) {
            toState = 'Cancelled';
        } else {
            toState = cancelPaymentResult.state || 'Error';
            payment.errorMessage = cancelPaymentResult.errorMessage;
        }
        return this.transitionStateAndSave(ctx, payment, fromState, toState);
    }

    private async transitionStateAndSave(
        ctx: RequestContext,
        payment: Payment,
        fromState: PaymentState,
        toState: PaymentState,
    ) {
        if (fromState === toState) {
            // in case metadata was changed
            await this.connection.getRepository(ctx, Payment).save(payment, { reload: false });
            return payment;
        }
        // Wrapped in withTransaction so the state save and onTransitionEnd hooks
        // are atomic — see the equivalent comment on OrderService.transitionToState.
        // #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            let finalize: () => Promise<any>;
            try {
                const result = await this.paymentStateMachine.transition(
                    txCtx,
                    payment.order,
                    payment,
                    toState,
                );
                finalize = result.finalize;
            } catch (e: any) {
                const transitionError = txCtx.translate(e.message, { fromState, toState });
                return new PaymentStateTransitionError({ transitionError, fromState, toState });
            }
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(fromState, toState, txCtx, payment, payment.order),
            );
            await finalize();
            return payment;
        });
    }

    /**
     * @description
     * Creates a Payment from the manual payment mutation in the Admin API
     *
     * When creating a manual Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `addManualPaymentToOrder()` method, which will also handle
     * updating the Order state too.
     */
    async createManualPayment(ctx: RequestContext, order: Order, amount: number, input: ManualPaymentInput) {
        const initialState = 'Created';
        const endState = 'Settled';
        // Wrapped in withTransaction so the payment create, state transition, save,
        // relation add and onTransitionEnd hooks all commit or roll back together.
        // #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            const payment = await this.connection.getRepository(txCtx, Payment).save(
                new Payment({
                    amount,
                    order,
                    transactionId: input.transactionId,
                    metadata: input.metadata,
                    method: input.method,
                    state: initialState,
                }),
            );
            const { finalize } = await this.paymentStateMachine.transition(
                txCtx,
                order,
                payment,
                endState,
            );
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder()
                .relation('payments')
                .of(order)
                .add(payment);
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(initialState, endState, txCtx, payment, order),
            );
            await finalize();
            return payment;
        });
    }

    /**
     * @description
     * Creates a Refund against the specified Payment. If the amount to be refunded exceeds the value of the
     * specified Payment (in the case of multiple payments on a single Order), then the remaining outstanding
     * refund amount will be refunded against the next available Payment from the Order.
     *
     * When creating a Refund in the context of an Order, it is
     * preferable to use the {@link OrderService} `refundOrder()` method, which performs additional
     * validation.
     */
    async createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        order: Order,
        selectedPayment: Payment,
    ): Promise<Refund | RefundStateTransitionError | RefundAmountError> {
        const orderWithRefunds = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['payments', 'payments.refunds'],
        });

        if (input.amount) {
            const paymentToRefund = orderWithRefunds.payments.find(p =>
                idsAreEqual(p.id, selectedPayment.id),
            );
            if (!paymentToRefund) {
                throw new InternalServerError('Could not find a Payment to refund');
            }
            const refundableAmount = paymentToRefund.amount - this.getPaymentRefundTotal(paymentToRefund);
            if (refundableAmount < input.amount) {
                return new RefundAmountError({ maximumRefundable: refundableAmount });
            }
        }

        const refundsCreated: Refund[] = [];
        const refundablePayments = orderWithRefunds.payments.filter(p => {
            return this.getPaymentRefundTotal(p) < p.amount;
        });
        let primaryRefund: Refund | undefined;
        const refundedPaymentIds: ID[] = [];
        const { total, orderLinesTotal } = await this.getRefundAmount(ctx, input);
        const refundMax =
            orderWithRefunds.payments
                ?.map(p => p.amount - this.getPaymentRefundTotal(p))
                .reduce((sum, amount) => sum + amount, 0) ?? 0;
        let refundOutstanding = Math.min(total, refundMax);
        do {
            const paymentToRefund =
                (refundedPaymentIds.length === 0 &&
                    refundablePayments.find(p => idsAreEqual(p.id, selectedPayment.id))) ||
                refundablePayments.find(p => !refundedPaymentIds.includes(p.id));
            if (!paymentToRefund) {
                throw new InternalServerError('Could not find a Payment to refund');
            }
            const amountNotRefunded = paymentToRefund.amount - this.getPaymentRefundTotal(paymentToRefund);
            const constrainedTotal = Math.min(amountNotRefunded, refundOutstanding);
            let refund = new Refund({
                payment: paymentToRefund,
                total: constrainedTotal,
                reason: input.reason,
                method: selectedPayment.method,
                state: 'Pending',
                metadata: {},
                items: orderLinesTotal, // deprecated
                adjustment: input.adjustment, // deprecated
                shipping: input.shipping, // deprecated
            });
            let paymentMethod: PaymentMethod | undefined;
            let handler: PaymentMethodHandler | undefined;
            try {
                const methodAndHandler = await this.paymentMethodService.getMethodAndOperations(
                    ctx,
                    paymentToRefund.method,
                );
                paymentMethod = methodAndHandler.paymentMethod;
                handler = methodAndHandler.handler;
            } catch (e) {
                Logger.warn(
                    'Could not find a corresponding PaymentMethodHandler ' +
                        `when creating a refund for the Payment with method "${paymentToRefund.method}"`,
                );
            }
            const createRefundResult =
                paymentMethod && handler
                    ? await handler.createRefund(
                          ctx,
                          input,
                          constrainedTotal,
                          order,
                          paymentToRefund,
                          paymentMethod.handler.args,
                          paymentMethod,
                      )
                    : false;
            if (createRefundResult) {
                refund.transactionId = createRefundResult.transactionId || '';
                refund.metadata = createRefundResult.metadata || {};
            }
            refund = await this.connection.getRepository(ctx, Refund).save(refund);
            const refundLines: RefundLine[] = [];
            for (const { orderLineId, quantity } of input.lines || []) {
                const refundLine = await this.connection.getRepository(ctx, RefundLine).save(
                    new RefundLine({
                        refund,
                        orderLineId,
                        quantity,
                    }),
                );
                refundLines.push(refundLine);
            }
            await this.connection
                .getRepository(ctx, Fulfillment)
                .createQueryBuilder()
                .relation('lines')
                .of(refund)
                .add(refundLines);
            if (createRefundResult) {
                const fromState = refund.state;
                // Each iteration's state transition is wrapped in withTransaction so
                // the save, onTransitionEnd hooks and event publish commit or roll
                // back together — same atomicity guarantee as the dedicated
                // transition methods. The surrounding loop is intentionally NOT
                // wrapped: refunds created in earlier iterations remain committed
                // if a later iteration fails. #4686.
                const transitionError = await this.connection.withTransaction(ctx, async txCtx => {
                    let finalize: () => Promise<any>;
                    try {
                        const result = await this.refundStateMachine.transition(
                            txCtx,
                            order,
                            refund,
                            createRefundResult.state,
                        );
                        finalize = result.finalize;
                    } catch (e: any) {
                        return new RefundStateTransitionError({
                            transitionError: e.message,
                            fromState,
                            toState: createRefundResult.state,
                        });
                    }
                    await this.connection.getRepository(txCtx, Refund).save(refund, { reload: false });
                    await finalize();
                    await this.eventBus.publish(
                        new RefundStateTransitionEvent(
                            fromState,
                            createRefundResult.state,
                            txCtx,
                            refund,
                            order,
                        ),
                    );
                    return undefined;
                });
                if (transitionError) {
                    return transitionError;
                }
            }
            if (primaryRefund == null) {
                primaryRefund = refund;
            }
            refundsCreated.push(refund);
            refundedPaymentIds.push(paymentToRefund.id);
            refundOutstanding = total - summate(refundsCreated, 'total');
        } while (0 < refundOutstanding);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return primaryRefund;
    }

    /**
     * @description
     * Returns the total amount of all Refunds against the given Payment.
     */
    private getPaymentRefundTotal(payment: Payment): number {
        const nonFailedRefunds = payment.refunds?.filter(refund => refund.state !== 'Failed') ?? [];
        return summate(nonFailedRefunds, 'total');
    }

    private async getRefundAmount(
        ctx: RequestContext,
        input: RefundOrderInput,
    ): Promise<{ orderLinesTotal: number; total: number }> {
        if (input.amount) {
            // This is the new way of getting the refund amount
            // after v2.2.0. It allows full control over the refund.
            return { orderLinesTotal: 0, total: input.amount };
        }

        // This is the pre-v2.2.0 way of getting the refund amount.
        // It calculates the refund amount based on the order lines to be refunded
        // plus shipping and adjustment amounts. It is complex and prevents full
        // control over refund amounts, especially when multiple payment methods
        // are involved.
        // It is deprecated and will be removed in a future version.
        let refundOrderLinesTotal = 0;
        const inputLines = input.lines || [];
        const orderLines = await this.connection
            .getRepository(ctx, OrderLine)
            .find({ where: { id: In(inputLines.map(l => l.orderLineId)) } });
        for (const line of inputLines) {
            const orderLine = orderLines.find(l => idsAreEqual(l.id, line.orderLineId));
            if (orderLine && 0 < orderLine.orderPlacedQuantity) {
                refundOrderLinesTotal += line.quantity * orderLine.proratedUnitPriceWithTax;
            }
        }
        const total = refundOrderLinesTotal + (input.shipping ?? 0) + (input.adjustment ?? 0);
        return { orderLinesTotal: refundOrderLinesTotal, total };
    }

    private mergePaymentMetadata(m1: PaymentMetadata, m2?: PaymentMetadata): PaymentMetadata {
        if (!m2) {
            return m1;
        }
        const merged = { ...m1, ...m2 };
        if (m1.public && m1.public) {
            merged.public = { ...m1.public, ...m2.public };
        }
        return merged;
    }
}
