import { Injectable } from '@nestjs/common';
import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    CustomerService,
    EntityNotFoundError,
    ForbiddenError,
    ID,
    idsAreEqual,
    IllegalOperationError,
    isGraphQlErrorResult,
    Logger,
    Order,
    OrderService,
    Permission,
    RequestContext,
    SessionService,
    TransactionalConnection,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { loggerCtx } from '../../../constants';
import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const placeOrderInput = z.strictObject({
    paymentMethodCode: shortText.describe('Payment method code.'),
    paymentMetadata: z.looseObject({}).describe('Metadata passed to the payment handler.').optional(),
});

type PlaceOrderInput = z.infer<typeof placeOrderInput>;

// These carry a message the caller can act on (e.g. a bad payment method or an expired cart),
// so they're passed on unchanged instead of being replaced with a generic error.
const CALLER_SAFE_ERRORS = [
    UserInputError,
    IllegalOperationError,
    EntityNotFoundError,
    ForbiddenError,
    UnauthorizedError,
] as const;

@McpTool({
    name: 'place_order',
    toolset: 'shop',
    description:
        'Add payment to the active cart and place the order. The store order process decides which ' +
        'checkout details are required. Returns "placed" or "awaiting_payment" with payment details.',
    keywords: [
        'check out',
        'complete my purchase',
        'pay now',
        'finalize and submit my order',
        'buy everything in my basket',
        'confirm and pay',
    ],
    permissions: [Permission.Public],
    behavior: 'destructive',
    usesActiveOrder: true,
    inputSchema: placeOrderInput,
})
@Injectable()
export class PlaceOrderTool implements McpToolHandler<PlaceOrderInput> {
    constructor(
        private readonly activeOrder: McpActiveOrderService,
        private readonly orderService: OrderService,
        private readonly serializer: McpToolSerializerService,
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly sessionService: SessionService,
    ) {}

    async execute(ctx: RequestContext, input: PlaceOrderInput) {
        const order = await this.activeOrder.findOrThrow(ctx);
        // Taking a payment has to run inside a database transaction: `addPaymentToOrder` refuses to
        // run without one.
        return this.connection.withTransaction(order.ctx, async txCtx => {
            const current = await this.orderService.findOne(txCtx, order.id);
            if (!current) {
                // The cart was there a moment ago, so only a concurrent deletion gets here.
                throw new EntityNotFoundError('Order', order.id);
            }

            const arranging = await this.startArrangingPayment(txCtx, current);
            if (arranging.kind === 'error') {
                return arranging.result;
            }

            const result = await this.takePayment(txCtx, order.id, input);
            if (isGraphQlErrorResult(result)) {
                if (arranging.movedOutOfCart) {
                    await this.orderService.transitionToState(txCtx, order.id, 'AddingItems');
                }
                return this.serializer.orderOrError(result);
            }

            result.payments = await this.orderService.getOrderPayments(txCtx, result.id);
            return this.describeOutcome(txCtx, order.id, result);
        });
    }

    private async startArrangingPayment(
        txCtx: RequestContext,
        current: Order,
    ): Promise<
        | { kind: 'error'; result: ReturnType<McpToolSerializerService['orderOrError']> }
        | { kind: 'ok'; movedOutOfCart: boolean }
    > {
        if (current.state !== 'AddingItems') {
            return { kind: 'ok', movedOutOfCart: false };
        }
        const transition = await this.orderService.transitionToState(txCtx, current.id, 'ArrangingPayment');
        if (isGraphQlErrorResult(transition)) {
            if (
                transition.transitionError ===
                txCtx.translate('message.cannot-transition-to-payment-without-customer', {
                    fromState: current.state,
                    toState: 'ArrangingPayment',
                })
            ) {
                throw new UserInputError(
                    'This cart has no customer yet. For a guest checkout call ' +
                        'set_checkout_details with customer { emailAddress, firstName, ' +
                        'lastName } first, or sign in as a customer.',
                );
            }
            return { kind: 'error', result: this.serializer.orderOrError(transition) };
        }
        return { kind: 'ok', movedOutOfCart: true };
    }

    private async takePayment(
        txCtx: RequestContext,
        orderId: ID,
        input: PlaceOrderInput,
    ): Promise<Awaited<ReturnType<OrderService['addPaymentToOrder']>>> {
        const payment: PaymentInput = {
            method: input.paymentMethodCode,
            metadata: input.paymentMetadata ?? {},
        };
        try {
            return await this.orderService.addPaymentToOrder(txCtx, orderId, payment);
        } catch (e) {
            if (CALLER_SAFE_ERRORS.some(errorType => e instanceof errorType)) {
                throw e;
            }
            // The payment handler runs outside this transaction, so a rollback here can't undo a
            // charge it already made — the caller is told to check the order rather than retry.
            Logger.error(
                `place_order payment failed for order ${orderId}: ${
                    e instanceof Error ? e.message : String(e)
                }`,
                loggerCtx,
                e instanceof Error ? e.stack : undefined,
            );
            throw new UserInputError(
                'The payment provider could not be reached or refused the request. Do not retry ' +
                    'automatically. Call get_cart to check whether a payment was recorded, and tell the user.',
            );
        }
    }

    private async describeOutcome(txCtx: RequestContext, orderId: ID, result: Order) {
        if (result.orderPlacedAt) {
            await this.customerService.createAddressesForNewCustomer(txCtx, result);
            if (txCtx.session && idsAreEqual(txCtx.session.activeOrderId, orderId)) {
                await this.sessionService.unsetActiveOrder(txCtx, txCtx.session);
            }
            return { status: 'placed' as const, order: this.serializer.order(result) };
        }

        let message =
            'Payment was created, but the order is not placed yet. Look at order.payments for ' +
            "each payment's state and any publicMetadata with the shopper's next step.";
        if (result.state === 'ArrangingPayment') {
            message += ' The cart cannot be edited while the order is in ArrangingPayment.';
        }
        return {
            status: 'awaiting_payment' as const,
            order: this.serializer.order(result),
            message,
        };
    }
}
