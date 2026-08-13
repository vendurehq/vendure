import { RefundOrderInput } from '@vendure/common/lib/generated-types';

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
 * @example
 * ```ts
 * class StoreCreditRefundDestination implements RefundDestinationStrategy {
 *     readonly code = 'store-credit';
 *     readonly description = [
 *         { languageCode: LanguageCode.en, value: 'Refund as store credit' },
 *     ];
 *
 *     async isAvailable(ctx, order, payment) {
 *         return payment.method !== 'store-credit-payment';
 *     }
 *
 *     async createRefund(ctx, input, amount, order, payment) {
 *         // Issue store credit to the customer
 *         return { state: 'Settled' as const, transactionId: 'sc-123' };
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
     * A unique code identifying this refund destination.
     */
    readonly code: string;

    /**
     * @description
     * A human-readable description of this destination, used in the admin UI.
     */
    readonly description: LocalizedStringArray;

    /**
     * @description
     * Whether this destination is available for the given order and payment.
     * This is called when resolving the `refundDestinations` query to determine
     * which destinations to offer the admin.
     */
    isAvailable(ctx: RequestContext, order: Order, payment: Payment): boolean | Promise<boolean>;

    /**
     * @description
     * Execute the refund to this destination. Called instead of
     * `PaymentMethodHandler.createRefund()` when this destination is selected.
     *
     * The returned {@link CreateRefundResult} determines the refund state
     * and any associated transaction ID or metadata.
     */
    createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
    ): CreateRefundResult | Promise<CreateRefundResult>;
}
