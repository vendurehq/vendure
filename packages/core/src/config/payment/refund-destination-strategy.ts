import { RefundOrderInput } from '@vendure/common/lib/generated-types';
import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { LocalizedStringArray } from '../../common/configurable-operation';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order, Payment } from '../../entity';

import { CreateRefundResult } from './payment-method-handler';

/**
 * @description
 * A RefundDestinationStrategy defines a possible destination for a refund.
 * The default destination is the original payment method, but plugins can add additional
 * destinations such as store credit, gift cards, or vouchers.
 *
 * When a non-default destination is selected, this strategy's `createRefund()` method
 * is called **instead of** the `PaymentMethodHandler.createRefund()`. If your destination
 * shares logic with an existing payment method handler (e.g. both a store-credit payment
 * handler and a store-credit refund destination need to call the same API), extract the
 * shared logic into a service and inject it into both.
 *
 * A refund to a non-default destination still draws its balance from a Payment on the Order,
 * which is what limits the amount that can be refunded. The Payment identifies where the money
 * came from; the destination identifies where it goes.
 *
 * @example
 * ```ts
 * class StoreCreditRefundDestination implements RefundDestinationStrategy {
 *     readonly code = 'store-credit';
 *     readonly description = [
 *         { languageCode: LanguageCode.en, value: 'Refund as store credit' },
 *     ];
 *
 *     private storeCreditService: StoreCreditService;
 *
 *     init(injector: Injector) {
 *         this.storeCreditService = injector.get(StoreCreditService);
 *     }
 *
 *     isAvailable(ctx: RequestContext, order: Order, payment: Payment) {
 *         // Refunding a store credit payment back to store credit is handled by the
 *         // payment method handler itself, so don't offer it here.
 *         return payment.method !== 'store-credit-payment';
 *     }
 *
 *     async createRefund(
 *         ctx: RequestContext,
 *         input: RefundOrderInput,
 *         amount: number,
 *         order: Order,
 *         payment: Payment,
 *         args?: JsonCompatible<any>,
 *     ) {
 *         const credit = await this.storeCreditService.issue(ctx, {
 *             customerId: order.customerId,
 *             value: amount,
 *             expiresInDays: args?.expiresInDays,
 *         });
 *         return {
 *             state: 'Settled' as const,
 *             transactionId: `store-credit-${credit.id}`,
 *             metadata: { storeCreditId: credit.id },
 *         };
 *     }
 * }
 * ```
 *
 * Register in VendureConfig:
 * ```ts
 * paymentOptions: {
 *     refundDestinations: [new StoreCreditRefundDestination()],
 * }
 * ```
 *
 * @docsCategory payment
 * @since 3.8.0
 */
export interface RefundDestinationStrategy extends InjectableStrategy {
    /**
     * @description
     * A unique code identifying this refund destination. The code `default` is reserved for the
     * built-in destination which refunds to the original payment method.
     */
    readonly code: string;

    /**
     * @description
     * A human-readable description of this destination, used in the admin UI.
     */
    readonly description: LocalizedStringArray;

    /**
     * @description
     * Whether this destination is available for the given Order and Payment. Availability is
     * determined per-Payment, since a destination may be valid for one of an Order's payments
     * but not another.
     *
     * This is called when resolving the `refundDestinations` query to build the list of Payments
     * a destination may be used with, and again when a refund is created, to verify that the
     * Payment chosen by the administrator is one of them.
     */
    isAvailable(ctx: RequestContext, order: Order, payment: Payment): boolean | Promise<boolean>;

    /**
     * @description
     * Execute the refund to this destination. Called instead of
     * `PaymentMethodHandler.createRefund()` when this destination is selected.
     *
     * The returned {@link CreateRefundResult} determines the refund state
     * and any associated transaction ID or metadata. Throwing from this method aborts the whole
     * refund operation and rolls back any Refunds created earlier in the same call.
     *
     * @param args - The `arguments` supplied on the corresponding `RefundTargetInput`, which is
     * how a dashboard refund destination component passes its configuration through to the backend.
     */
    createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
        args?: JsonCompatible<any>,
    ): CreateRefundResult | Promise<CreateRefundResult>;
}
