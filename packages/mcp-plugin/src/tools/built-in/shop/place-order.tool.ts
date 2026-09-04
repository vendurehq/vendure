import { Injectable } from '@nestjs/common';
import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    CustomerService,
    EntityNotFoundError,
    ForbiddenError,
    idsAreEqual,
    IllegalOperationError,
    isGraphQlErrorResult,
    Logger,
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

// Error classes whose own message is meant for the caller. Taking a payment can fail with one of
// these for a reason the caller can act on — an unknown, disabled or wrong-channel payment method
// code, or a cart that has gone — so this tool passes them on rather than replacing them. This is
// the same set the tool funnel treats as caller-safe.
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
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private sessionService: SessionService,
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
            let movedOutOfCart = false;
            if (current.state === 'AddingItems') {
                const transition = await this.orderService.transitionToState(
                    txCtx,
                    order.id,
                    'ArrangingPayment',
                );
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
                    return this.serializer.orderOrError(transition);
                }
                movedOutOfCart = true;
            }

            const payment: PaymentInput = {
                method: input.paymentMethodCode,
                metadata: input.paymentMetadata ?? {},
            };
            let result: Awaited<ReturnType<OrderService['addPaymentToOrder']>>;
            try {
                result = await this.orderService.addPaymentToOrder(txCtx, order.id, payment);
            } catch (e) {
                if (CALLER_SAFE_ERRORS.some(errorType => e instanceof errorType)) {
                    throw e;
                }
                // Anything else came out of the payment handler, which runs outside this
                // transaction, so the rollback cannot undo a charge it already made. The caller is
                // told to check rather than retry, and the real message is kept for the operator.
                Logger.error(
                    `place_order payment failed for order ${order.id}: ${
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

            if (isGraphQlErrorResult(result)) {
                if (movedOutOfCart) {
                    await this.orderService.transitionToState(txCtx, order.id, 'AddingItems');
                }
                return this.serializer.orderOrError(result);
            }

            result.payments = await this.orderService.getOrderPayments(txCtx, result.id);

            if (result.orderPlacedAt) {
                await this.customerService.createAddressesForNewCustomer(txCtx, result);
                if (txCtx.session && idsAreEqual(txCtx.session.activeOrderId, order.id)) {
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
        });
    }
}
