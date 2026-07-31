import { ConfigArg, RefundOrderInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { OnTransitionStartFn, StateMachineConfig } from '../../common/finite-state-machine/types';
import { PaymentMetadata } from '../../common/types/common-types';
import { Order, Payment, PaymentMethod } from '../../entity';
import {
    PaymentState,
    PaymentTransitionData,
} from '../../service/helpers/payment-state-machine/payment-state';
import { RefundState } from '../../service/helpers/refund-state-machine/refund-state';

export type OnPaymentTransitionStartReturnType = ReturnType<
    Required<StateMachineConfig<any>>['onTransitionStart']
>;

/**
 * @description
 * This object is the return value of the {@link CreatePaymentFn}.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface CreatePaymentResult {
    /**
     * @description
     * The amount (as an integer - i.e. $10 = `1000`) that this payment is for.
     * Typically this should equal the Order total, unless multiple payment methods
     * are being used for the order.
     */
    amount: number;
    /**
     * @description
     * The {@link PaymentState} of the resulting Payment.
     *
     * In a single-step payment flow, this should be set to `'Settled'`.
     * In a two-step flow, this should be set to `'Authorized'`.
     *
     * If using a {@link PaymentProcess}, may be something else
     * entirely according to your business logic.
     */
    state: Exclude<PaymentState, 'Error'>;
    /**
     * @description
     * The unique payment reference code typically assigned by
     * the payment provider.
     */
    transactionId?: string;
    /**
     * @description
     * If the payment is declined or fails for ome other reason, pass the
     * relevant error message here, and it gets returned with the
     * ErrorResponse of the `addPaymentToOrder` mutation.
     */
    errorMessage?: string;
    /**
     * @description
     * This field can be used to store other relevant data which is often
     * provided by the payment provider, such as security data related to
     * the payment method or data used in troubleshooting or debugging.
     *
     * Any data stored in the optional `public` property will be available
     * via the Shop API. This is useful for certain checkout flows such as
     * external gateways, where the payment provider returns a unique
     * url which must then be passed to the storefront app.
     */
    metadata?: PaymentMetadata;
}

/**
 * @description
 * This object is the return value of the {@link CreatePaymentFn} when there has been an error.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface CreatePaymentErrorResult {
    amount: number;
    state: 'Error';
    transactionId?: string;
    errorMessage: string;
    metadata?: PaymentMetadata;
}

/**
 * @description
 * This object is the return value of the {@link CreateRefundFn}.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface CreateRefundResult {
    state: RefundState;
    transactionId?: string;
    metadata?: PaymentMetadata;
}

/**
 * @description
 * This object is the return value of the {@link SettlePaymentFn} when the Payment
 * has been successfully settled.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface SettlePaymentResult {
    success: true;
    metadata?: PaymentMetadata;
}

/**
 * @description
 * This object is the return value of the {@link SettlePaymentFn} when the Payment
 * could not be settled.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface SettlePaymentErrorResult {
    success: false;
    /**
     * @description
     * The state to transition this Payment to upon unsuccessful settlement.
     * Defaults to `Error`. Note that if using a different state, it must be
     * legal to transition to that state from the `Authorized` state according
     * to the PaymentState config (which can be customized using the
     * {@link PaymentProcess}).
     */
    state?: Exclude<PaymentState, 'Settled'>;
    /**
     * @description
     * The message that will be returned when attempting to settle the payment, and will
     * also be persisted as `Payment.errorMessage`.
     */
    errorMessage?: string;
    metadata?: PaymentMetadata;
}

/**
 * @description
 * This object is the return value of the {@link CancelPaymentFn} when the Payment
 * has been successfully cancelled.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface CancelPaymentResult {
    success: true;
    metadata?: PaymentMetadata;
}
/**
 * @description
 * This object is the return value of the {@link CancelPaymentFn} when the Payment
 * could not be cancelled.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export interface CancelPaymentErrorResult {
    success: false;
    /**
     * @description
     * The state to transition this Payment to upon unsuccessful cancellation.
     * Defaults to `Error`. Note that if using a different state, it must be
     * legal to transition to that state from the `Authorized` state according
     * to the PaymentState config (which can be customized using the
     * {@link PaymentProcess}).
     */
    state?: Exclude<PaymentState, 'Cancelled'>;
    /**
     * @description
     * The message that will be returned when attempting to cancel the payment, and will
     * also be persisted as `Payment.errorMessage`.
     */
    errorMessage?: string;
    metadata?: PaymentMetadata;
}
/**
 * @description
 * This function contains the logic for creating a payment. See {@link PaymentMethodHandler} for an example.
 *
 * Returns a {@link CreatePaymentResult}.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export type CreatePaymentFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    amount: number,
    args: ConfigArgValues<T>,
    metadata: PaymentMetadata,
    method: PaymentMethod,
) => CreatePaymentResult | CreatePaymentErrorResult | Promise<CreatePaymentResult | CreatePaymentErrorResult>;

/**
 * @description
 * This function contains the logic for settling a payment. See {@link PaymentMethodHandler} for an example.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export type SettlePaymentFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    payment: Payment,
    args: ConfigArgValues<T>,
    method: PaymentMethod,
) => SettlePaymentResult | SettlePaymentErrorResult | Promise<SettlePaymentResult | SettlePaymentErrorResult>;

/**
 * @description
 * This function contains the logic for cancelling a payment. See {@link PaymentMethodHandler} for an example.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export type CancelPaymentFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    payment: Payment,
    args: ConfigArgValues<T>,
    method: PaymentMethod,
) => CancelPaymentResult | CancelPaymentErrorResult | Promise<CancelPaymentResult | CancelPaymentErrorResult>;

/**
 * @description
 * This function contains the logic for creating a refund. See {@link PaymentMethodHandler} for an example.
 *
 * @docsCategory payment
 * @docsPage Payment Method Types
 */
export type CreateRefundFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    input: RefundOrderInput,
    amount: number,
    order: Order,
    payment: Payment,
    args: ConfigArgValues<T>,
    method: PaymentMethod,
) => CreateRefundResult | Promise<CreateRefundResult>;

/**
 * @description
 * Defines the object which is used to construct the {@link PaymentMethodHandler}.
 *
 * @docsCategory payment
 */
export interface PaymentMethodConfigOptions<T extends ConfigArgs> extends ConfigurableOperationDefOptions<T> {
    /**
     * @description
     * This function provides the logic for creating a payment. For example,
     * it may call out to a third-party service with the data and should return a
     * {@link CreatePaymentResult} object contains the details of the payment.
     */
    createPayment: CreatePaymentFn<T>;
    /**
     * @description
     * This function provides the logic for settling a payment, also known as "capturing".
     * For payment integrations that settle/capture the payment on creation (i.e. the
     * `createPayment()` method returns with a state of `'Settled'`) this method
     * need only return `{ success: true }`.
     */
    settlePayment: SettlePaymentFn<T>;
    /**
     * @description
     * This function provides the logic for cancelling a payment, which would be invoked when a call is
     * made to the `cancelPayment` mutation in the Admin API. Cancelling a payment can apply
     * if, for example, you have created a "payment intent" with the payment provider but not yet
     * completed the payment. It allows the incomplete payment to be cleaned up on the provider's end
     * if it gets cancelled via Vendure.
     *
     * @since 1.7.0
     */
    cancelPayment?: CancelPaymentFn<T>;
    /**
     * @description
     * This function provides the logic for refunding a payment created with this
     * payment method. Some payment providers may not provide the facility to
     * programmatically create a refund. In such a case, this method should be
     * omitted and any Refunds will have to be settled manually by an administrator.
     */
    createRefund?: CreateRefundFn<T>;
    /**
     * @description
     * This function, when specified, will be invoked before any transition from one {@link PaymentState} to another.
     * The return value (a sync / async `boolean`) is used to determine whether the transition is permitted.
     */
    onStateTransitionStart?: OnTransitionStartFn<PaymentState, PaymentTransitionData>;
}

/**
 * @description
 * A PaymentMethodHandler contains the code which is used to generate a Payment when a call to the
 * `addPaymentToOrder` mutation is made. It contains any necessary steps of interfacing with a
 * third-party payment gateway before the Payment is created and can also define actions to fire
 * when the state of the payment is changed.
 *
 * PaymentMethodHandlers are instantiated using a {@link PaymentMethodConfigOptions} object, which
 * configures the business logic used to create, settle and refund payments.
 *
 * @example
 * ```ts
 * import { PaymentMethodHandler, CreatePaymentResult, SettlePaymentResult, LanguageCode } from '\@vendure/core';
 * // A mock 3rd-party payment SDK
 * import gripeSDK from 'gripe';
 *
 * export const examplePaymentHandler = new PaymentMethodHandler({
 *   code: 'example-payment-provider',
 *   description: [{
 *     languageCode: LanguageCode.en,
 *     value: 'Example Payment Provider',
 *   }],
 *   args: {
 *     apiKey: { type: 'string' },
 *   },
 *   createPayment: async (ctx, order, amount, args, metadata): Promise<CreatePaymentResult> => {
 *     try {
 *       const result = await gripeSDK.charges.create({
 *         amount,
 *         apiKey: args.apiKey,
 *         source: metadata.authToken,
 *       });
 *       return {
 *         amount: order.total,
 *         state: 'Settled' as const,
 *         transactionId: result.id.toString(),
 *         metadata: result.outcome,
 *       };
 *     } catch (err: any) {
 *       return {
 *         amount: order.total,
 *         state: 'Declined' as const,
 *         metadata: {
 *           errorMessage: err.message,
 *         },
 *       };
 *     }
 *   },
 *   settlePayment: async (ctx, order, payment, args): Promise<SettlePaymentResult> => {
 *     return { success: true };
 *   }
 * });
 * ```
 *
 * @docsCategory payment
 */
export class PaymentMethodHandler<T extends ConfigArgs = ConfigArgs> extends ConfigurableOperationDef<T> {
    private readonly createPaymentFn: CreatePaymentFn<T>;
    private readonly settlePaymentFn: SettlePaymentFn<T>;
    private readonly cancelPaymentFn?: CancelPaymentFn<T>;
    private readonly createRefundFn?: CreateRefundFn<T>;
    private readonly onTransitionStartFn?: OnTransitionStartFn<PaymentState, PaymentTransitionData>;

    constructor(config: PaymentMethodConfigOptions<T>) {
        super(config);
        this.createPaymentFn = config.createPayment;
        this.settlePaymentFn = config.settlePayment;
        this.cancelPaymentFn = config.cancelPayment;
        this.createRefundFn = config.createRefund;
        this.onTransitionStartFn = config.onStateTransitionStart;
    }

    /**
     * @description
     * Called internally to create a new Payment
     *
     * @internal
     */
    async createPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        args: ConfigArg[],
        metadata: PaymentMetadata,
        method: PaymentMethod,
    ) {
        const paymentConfig = await this.createPaymentFn(
            ctx,
            order,
            amount,
            this.argsArrayToHash(args),
            metadata,
            method,
        );
        return {
            method: this.code,
            metadata: {},
            ...paymentConfig,
        };
    }

    /**
     * @description
     * Called internally to settle a payment
     *
     * @internal
     */
    async settlePayment(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        args: ConfigArg[],
        method: PaymentMethod,
    ) {
        return this.settlePaymentFn(ctx, order, payment, this.argsArrayToHash(args), method);
    }

    /**
     * @description
     * Called internally to cancel a payment
     *
     * @internal
     */
    async cancelPayment(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        args: ConfigArg[],
        method: PaymentMethod,
    ) {
        return this.cancelPaymentFn?.(ctx, order, payment, this.argsArrayToHash(args), method);
    }

    /**
     * @description
     * Called internally to create a refund
     *
     * @internal
     */
    async createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
        args: ConfigArg[],
        method: PaymentMethod,
    ) {
        return this.createRefundFn
            ? this.createRefundFn(ctx, input, amount, order, payment, this.argsArrayToHash(args), method)
            : false;
    }

    /**
     * @description
     * This function is called before the state of a Payment is transitioned. If the PaymentMethodHandler
     * was instantiated with a `onStateTransitionStart` function, that function will be invoked and its
     * return value used to determine whether the transition can occur.
     *
     * @internal
     */
    onStateTransitionStart(
        fromState: PaymentState,
        toState: PaymentState,
        data: PaymentTransitionData,
    ): OnPaymentTransitionStartReturnType {
        if (typeof this.onTransitionStartFn === 'function') {
            return this.onTransitionStartFn(fromState, toState, data);
        } else {
            return true;
        }
    }
}
