import { Injectable } from '@nestjs/common';
import { ManualPaymentInput, RefundOrderInput } from '@vendure/common/lib/generated-types';
import { DEFAULT_REFUND_DESTINATION_CODE } from '@vendure/common/lib/shared-constants';
import { DeepPartial, ID, JsonCompatible } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError, UserInputError } from '../../common/error/errors';
import {
    PaymentStateTransitionError,
    RefundAmountError,
    RefundDestinationError,
    RefundStateTransitionError,
} from '../../common/error/generated-graphql-admin-errors';
import { IneligiblePaymentMethodError } from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { PaymentMetadata } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { CreateRefundResult, PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { RefundDestinationStrategy } from '../../config/payment/refund-destination-strategy';
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
import { RefundState } from '../helpers/refund-state-machine/refund-state';
import { RefundStateMachine } from '../helpers/refund-state-machine/refund-state-machine';
import { assertOrderIsInChannel } from '../helpers/utils/order-utils';

import { PaymentMethodService } from './payment-method.service';

/**
 * A single portion of a refund, once the requested input has been resolved against the Order's
 * Payments and the configured RefundDestinationStrategies.
 */
interface ResolvedRefundTarget {
    /** The Payment whose refundable balance this portion is drawn from. */
    payment: Payment;
    amount: number;
    /** The destination receiving the funds, or undefined to refund to the original payment method. */
    strategy?: RefundDestinationStrategy;
    args?: JsonCompatible<any>;
}

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
        private configService: ConfigService,
        private eventBus: EventBus,
    ) {}

    async create(ctx: RequestContext, input: DeepPartial<Payment>): Promise<Payment> {
        const newPayment = new Payment({
            ...input,
            state: this.paymentStateMachine.getInitialState(),
        });
        return this.connection.getRepository(ctx, Payment).save(newPayment);
    }

    /**
     * @description
     * Loads a Payment by id with no Channel check. Payment is not ChannelAware, so callers must first
     * load the parent Order in the current Channel (or use a path which does, such as the private
     * `getPaymentInChannelOrThrow` used by the payment mutations). The only core caller is the
     * `Refund.lines` field resolver, which is reached from an Order already loaded in the current
     * Channel.
     */
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
        const payment = await this.getPaymentInChannelOrThrow(ctx, paymentId);
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
        const payment = await this.getPaymentInChannelOrThrow(ctx, paymentId);
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
        const payment = await this.getPaymentInChannelOrThrow(ctx, paymentId);
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

    /**
     * Loads a Payment by id and checks that its Order is visible in the active Channel. Payment is
     * not ChannelAware, so without this check a Channel-scoped administrator can settle, cancel or
     * refund the payments of any other Channel's Orders. The check must happen before the
     * PaymentMethodHandler is invoked, because a gateway side-effect cannot be rolled back.
     */
    private async getPaymentInChannelOrThrow(ctx: RequestContext, paymentId: ID): Promise<Payment> {
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, paymentId, {
            relations: ['order'],
        });
        await assertOrderIsInChannel(ctx, this.connection, payment.order.id, 'Payment', paymentId);
        return payment;
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
     * Creates one or more Refunds against the Payments of the given Order.
     *
     * By default the refund is drawn from the specified Payment, and if the amount to be refunded
     * exceeds that Payment's remaining refundable balance (in the case of multiple payments on a
     * single Order), the outstanding amount is refunded against the next available Payment.
     *
     * Alternatively, `input.targets` may be used to split the refund explicitly over several
     * Payments and/or {@link RefundDestinationStrategy} destinations. Every target is resolved and
     * validated before any Refund is created, so an invalid target rejects the whole operation
     * without any funds having been moved.
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
    ): Promise<Refund | RefundStateTransitionError | RefundAmountError | RefundDestinationError> {
        const orderWithRefunds = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['payments', 'payments.refunds'],
        });
        const useTargets = 0 < (input.targets?.length ?? 0);
        const { total, orderLinesTotal } = useTargets
            ? { total: summate(input.targets ?? [], 'amount'), orderLinesTotal: 0 }
            : await this.getRefundAmount(ctx, input);

        const targets = await this.resolveRefundTargets(
            ctx,
            input,
            order,
            orderWithRefunds,
            selectedPayment,
            total,
        );
        if (targets instanceof RefundAmountError || targets instanceof RefundDestinationError) {
            return targets;
        }

        let primaryRefund: Refund | undefined;
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            let refund = new Refund({
                payment: target.payment,
                total: target.amount,
                reason: input.reason,
                method: target.payment.method,
                destination: target.strategy ? target.strategy.code : null,
                state: 'Pending',
                metadata: {},
                items: orderLinesTotal, // deprecated
                // These columns are not nullable, so the deprecated inputs default to zero when
                // omitted. A refund specified via `amount` or `targets` does not use them at all.
                adjustment: input.adjustment ?? 0, // deprecated
                shipping: input.shipping ?? 0, // deprecated
            });
            const createRefundResult = target.strategy
                ? await target.strategy.createRefund(
                      ctx,
                      input,
                      target.amount,
                      order,
                      target.payment,
                      target.args ?? undefined,
                  )
                : await this.createRefundViaPaymentMethodHandler(
                      ctx,
                      input,
                      target.amount,
                      order,
                      target.payment,
                  );
            if (createRefundResult) {
                refund.transactionId = createRefundResult.transactionId || '';
                refund.metadata = createRefundResult.metadata || {};
            }
            refund = await this.connection.getRepository(ctx, Refund).save(refund);
            if (i === 0) {
                // The RefundLines record which OrderLines a refund relates to. A refund split over
                // several Payments or destinations still relates to the same OrderLines, so the
                // lines are attached once, to the first Refund. Attaching them to every Refund
                // would record each OrderLine as having been refunded multiple times.
                await this.createRefundLines(ctx, refund, input);
                primaryRefund = refund;
            }
            if (createRefundResult) {
                const transitionError = await this.transitionRefundState(
                    ctx,
                    order,
                    refund,
                    createRefundResult.state,
                );
                if (transitionError) {
                    // Refunds created by earlier targets are deliberately left in place. A
                    // PaymentMethodHandler or RefundDestinationStrategy may already have moved real
                    // funds, and discarding the Refund would lose the record of it. See #4686.
                    return transitionError;
                }
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return primaryRefund!;
    }

    /**
     * Works out which Payment each portion of the refund is drawn from, how much is drawn, and
     * which RefundDestinationStrategy (if any) receives it. Performs all validation which can be
     * done before any funds move: destination codes are resolved, destination availability is
     * checked against the Payment it will actually draw on, and the amounts allocated to each
     * Payment are checked against that Payment's remaining refundable balance.
     *
     * No database writes are performed here.
     */
    private async resolveRefundTargets(
        ctx: RequestContext,
        input: RefundOrderInput,
        order: Order,
        orderWithRefunds: Order,
        selectedPayment: Payment,
        total: number,
    ): Promise<ResolvedRefundTarget[] | RefundAmountError | RefundDestinationError> {
        // Tracks how much this operation has already allocated to each Payment, so that several
        // targets drawing on the same Payment cannot together exceed its refundable balance.
        const allocated = new Map<ID, number>();
        const remainingCapacityOf = (payment: Payment) =>
            payment.amount - this.getPaymentRefundTotal(payment) - (allocated.get(payment.id) ?? 0);

        if (0 < (input.targets?.length ?? 0)) {
            const explicitTargets: ResolvedRefundTarget[] = [];
            for (const targetInput of input.targets ?? []) {
                if (targetInput.amount <= 0) {
                    throw new UserInputError('error.refund-target-amount-must-be-positive');
                }
                const paymentId = targetInput.paymentId ?? input.paymentId;
                const payment = orderWithRefunds.payments.find(p => idsAreEqual(p.id, paymentId));
                if (!payment) {
                    throw new UserInputError('error.refund-payment-not-on-order', {
                        paymentId: String(paymentId),
                    });
                }
                this.assertPaymentIsSettled(payment);
                const targetStrategy = this.resolveRefundDestinationStrategy(targetInput.destination);
                if (targetStrategy instanceof RefundDestinationError) {
                    return targetStrategy;
                }
                if (targetStrategy && !(await targetStrategy.isAvailable(ctx, order, payment))) {
                    return new RefundDestinationError({ destinationCode: targetStrategy.code });
                }
                const capacity = remainingCapacityOf(payment);
                if (capacity < targetInput.amount) {
                    return new RefundAmountError({ maximumRefundable: capacity });
                }
                allocated.set(payment.id, (allocated.get(payment.id) ?? 0) + targetInput.amount);
                explicitTargets.push({
                    payment,
                    amount: targetInput.amount,
                    strategy: targetStrategy,
                    args: targetInput.arguments,
                });
            }
            return explicitTargets;
        }

        const strategy = this.resolveRefundDestinationStrategy(input.destination);
        if (strategy instanceof RefundDestinationError) {
            return strategy;
        }
        if (input.amount) {
            const paymentToRefund = orderWithRefunds.payments.find(p =>
                idsAreEqual(p.id, selectedPayment.id),
            );
            if (!paymentToRefund) {
                throw new InternalServerError('Could not find a Payment to refund');
            }
            const refundableAmount = remainingCapacityOf(paymentToRefund);
            if (refundableAmount < input.amount) {
                return new RefundAmountError({ maximumRefundable: refundableAmount });
            }
        }
        if (strategy) {
            this.assertPaymentIsSettled(selectedPayment);
            if (!(await strategy.isAvailable(ctx, order, selectedPayment))) {
                return new RefundDestinationError({ destinationCode: strategy.code });
            }
        }

        // No explicit targets: allocate the total across the Order's refundable Payments, starting
        // with the selected one and spilling over into the others as each is exhausted.
        const refundablePayments: Payment[] = [];
        for (const payment of orderWithRefunds.payments) {
            if (this.getPaymentRefundTotal(payment) >= payment.amount) {
                continue;
            }
            // When refunding to a destination, the overflow may only spill onto Payments which the
            // destination could have been chosen for directly.
            if (
                strategy &&
                (payment.state !== 'Settled' || !(await strategy.isAvailable(ctx, order, payment)))
            ) {
                continue;
            }
            refundablePayments.push(payment);
        }
        const refundMax = refundablePayments.reduce((sum, p) => sum + remainingCapacityOf(p), 0);
        if (strategy && refundMax < total) {
            return new RefundAmountError({ maximumRefundable: refundMax });
        }
        const targets: ResolvedRefundTarget[] = [];
        const usedPaymentIds: ID[] = [];
        let refundOutstanding = Math.min(total, refundMax);
        do {
            const paymentToRefund =
                (usedPaymentIds.length === 0 &&
                    refundablePayments.find(p => idsAreEqual(p.id, selectedPayment.id))) ||
                refundablePayments.find(p => !usedPaymentIds.includes(p.id));
            if (!paymentToRefund) {
                throw new InternalServerError('Could not find a Payment to refund');
            }
            const constrainedTotal = Math.min(remainingCapacityOf(paymentToRefund), refundOutstanding);
            targets.push({ payment: paymentToRefund, amount: constrainedTotal, strategy });
            usedPaymentIds.push(paymentToRefund.id);
            refundOutstanding = total - summate(targets, 'amount');
        } while (0 < refundOutstanding);
        return targets;
    }

    /**
     * Refunds to the original payment method by delegating to the PaymentMethodHandler of the
     * Payment being refunded. Returns `false` if no corresponding handler can be found, which
     * leaves the Refund in the `Pending` state.
     */
    private async createRefundViaPaymentMethodHandler(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
    ): Promise<CreateRefundResult | false> {
        let paymentMethod: PaymentMethod | undefined;
        let handler: PaymentMethodHandler | undefined;
        try {
            const methodAndHandler = await this.paymentMethodService.getMethodAndOperations(
                ctx,
                payment.method,
            );
            paymentMethod = methodAndHandler.paymentMethod;
            handler = methodAndHandler.handler;
        } catch (e) {
            Logger.warn(
                'Could not find a corresponding PaymentMethodHandler ' +
                    `when creating a refund for the Payment with method "${payment.method}"`,
            );
        }
        return paymentMethod && handler
            ? handler.createRefund(
                  ctx,
                  input,
                  amount,
                  order,
                  payment,
                  paymentMethod.handler.args,
                  paymentMethod,
              )
            : false;
    }

    private async createRefundLines(ctx: RequestContext, refund: Refund, input: RefundOrderInput) {
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
    }

    private async transitionRefundState(
        ctx: RequestContext,
        order: Order,
        refund: Refund,
        toState: RefundState,
    ): Promise<RefundStateTransitionError | undefined> {
        const fromState = refund.state;
        // The state transition is wrapped in withTransaction so the save, onTransitionEnd hooks and
        // event publish commit or roll back together — the same atomicity guarantee as the
        // dedicated transition methods. #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            let finalize: () => Promise<any>;
            try {
                const result = await this.refundStateMachine.transition(txCtx, order, refund, toState);
                finalize = result.finalize;
            } catch (e: any) {
                return new RefundStateTransitionError({
                    transitionError: e.message,
                    fromState,
                    toState,
                });
            }
            await this.connection.getRepository(txCtx, Refund).save(refund, { reload: false });
            await finalize();
            await this.eventBus.publish(
                new RefundStateTransitionEvent(fromState, toState, txCtx, refund, order),
            );
            return undefined;
        });
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

    /**
     * Returns the matching RefundDestinationStrategy if a non-default destination code is
     * specified, or undefined to refund to the original payment method. An unrecognised code is
     * reported as a RefundDestinationError rather than throwing, since it is caused by the input
     * rather than by a fault in the server.
     */
    private resolveRefundDestinationStrategy(
        destination: string | undefined | null,
    ): RefundDestinationStrategy | undefined | RefundDestinationError {
        if (!destination || destination === DEFAULT_REFUND_DESTINATION_CODE) {
            return undefined;
        }
        const strategies = this.configService.paymentOptions.refundDestinations ?? [];
        return (
            strategies.find(s => s.code === destination) ??
            new RefundDestinationError({ destinationCode: destination })
        );
    }

    /**
     * Explicit refund targets and refund destinations may only draw on a Payment whose funds have
     * been captured. A destination such as store credit issues value itself rather than asking the
     * payment provider to return the funds, so drawing on a Declined or merely Authorized Payment
     * would issue value that was never received.
     */
    private assertPaymentIsSettled(payment: Payment) {
        if (payment.state !== 'Settled') {
            throw new UserInputError('error.refund-payment-not-settled', {
                paymentId: String(payment.id),
                state: payment.state,
            });
        }
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
