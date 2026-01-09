import createMollieClient, {
    CaptureMethod,
    Locale,
    MollieClient,
    PaymentMethod as MollieClientMethod,
    PaymentStatus,
} from '@mollie/api-client';
import { CreateParameters as CreatePaymentParameters } from '@mollie/api-client/dist/types/binders/payments/parameters';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ActiveOrderService,
    assertFound,
    ConfigService,
    EntityHydrator,
    ErrorResult,
    ForbiddenError,
    ID,
    idsAreEqual,
    Injector,
    LanguageCode,
    Logger,
    LogLevel,
    Order,
    OrderService,
    OrderState,
    OrderStateMachine,
    OrderStateTransitionError,
    PaymentMethod,
    PaymentMethodService,
    RequestContext,
} from '@vendure/core';
import { totalCoveredByPayments } from '@vendure/core/dist/service/helpers/utils/order-utils';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from './constants';
import {
    ErrorCode,
    MolliePaymentIntentError,
    MolliePaymentIntentInput,
    MolliePaymentIntentResult,
    MolliePaymentMethod,
} from './graphql/generated-shop-types';
import { molliePaymentHandler } from './mollie.handler';
import { amountToCents, toAmount, toMollieAddress, toMolliePaymentLines } from './mollie.helpers';
import { MolliePluginOptions } from './mollie.plugin';
import { MolliePaymentMetadata } from './types';

interface OrderStatusInput {
    paymentMethodId: ID;
    paymentId: string;
}

class PaymentIntentError implements MolliePaymentIntentError {
    errorCode = ErrorCode.ORDER_PAYMENT_STATE_ERROR;

    constructor(public message: string) { }
}

class InvalidInputError implements MolliePaymentIntentError {
    errorCode = ErrorCode.INELIGIBLE_PAYMENT_METHOD_ERROR;

    constructor(public message: string) { }
}

@Injectable()
export class MollieService {
    private readonly injector: Injector;

    constructor(
        private paymentMethodService: PaymentMethodService,
        @Inject(PLUGIN_INIT_OPTIONS) private options: MolliePluginOptions,
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
        private entityHydrator: EntityHydrator,
        private moduleRef: ModuleRef,
        private configService: ConfigService,
    ) {
        this.injector = new Injector(this.moduleRef);
    }

    /**
     * Creates a redirectUrl to Mollie for the given paymentMethod and current activeOrder
     */
    async createPaymentIntent(
        ctx: RequestContext,
        input: MolliePaymentIntentInput,
    ): Promise<MolliePaymentIntentResult> {
        const { paymentMethodCode, molliePaymentMethodCode } = input;
        const [order, paymentMethod] = await Promise.all([
            this.getOrder(ctx, input.orderId),
            this.getPaymentMethod(ctx, paymentMethodCode),
        ]);
        if (order instanceof PaymentIntentError) {
            return order;
        }
        if (!paymentMethod) {
            return new PaymentIntentError(`No paymentMethod found with code ${String(paymentMethodCode)}`);
        }
        const eligiblePaymentMethods = await this.orderService.getEligiblePaymentMethods(ctx, order.id);
        if (
            !eligiblePaymentMethods.find(
                eligibleMethod =>
                    idsAreEqual(eligibleMethod.id, paymentMethod?.id) && eligibleMethod.isEligible,
            )
        ) {
            // Given payment method code is not eligible for this order
            return new InvalidInputError(
                `Payment method ${paymentMethod?.code} is not eligible for order ${order.code}`,
            );
        }
        if (order.state !== 'ArrangingPayment' && order.state !== 'ArrangingAdditionalPayment') {
            // Pre-check if order is transitionable to ArrangingPayment, because that will happen after Mollie payment
            try {
                await this.canTransitionTo(ctx, order.id, 'ArrangingPayment');
            } catch (e) {
                if ((e as Error).message) {
                    return new PaymentIntentError((e as Error).message);
                }
                throw e;
            }
        }
        if (!order.customer?.firstName.length) {
            return new PaymentIntentError(
                'Cannot create payment intent for order with customer that has no firstName set',
            );
        }
        if (!order.customer?.lastName.length) {
            return new PaymentIntentError(
                'Cannot create payment intent for order with customer that has no lastName set',
            );
        }
        let redirectUrl = input.redirectUrl;
        if (!redirectUrl) {
            // Use fallback redirect if no redirectUrl is given
            let fallbackRedirect = paymentMethod.handler.args.find(arg => arg.name === 'redirectUrl')?.value;
            if (!fallbackRedirect) {
                return new PaymentIntentError(
                    'No redirect URl was given and no fallback redirect is configured',
                );
            }
            redirectUrl = fallbackRedirect;
            // remove appending slash if present
            fallbackRedirect = fallbackRedirect.endsWith('/')
                ? fallbackRedirect.slice(0, -1)
                : fallbackRedirect;
            redirectUrl = `${fallbackRedirect}/${order.code}`;
        }
        const apiKey = paymentMethod.handler.args.find(arg => arg.name === 'apiKey')?.value;
        if (!apiKey) {
            Logger.warn(
                `CreatePaymentIntent failed, because no apiKey is configured for ${paymentMethod.code}`,
                loggerCtx,
            );
            return new PaymentIntentError(`Paymentmethod ${paymentMethod.code} has no apiKey configured`);
        }
        const mollieClient = createMollieClient({ apiKey });
        const vendureHost = this.options.vendureHost.endsWith('/')
            ? this.options.vendureHost.slice(0, -1)
            : this.options.vendureHost; // remove appending slash
        const billingAddress =
            toMollieAddress(order.billingAddress, order.customer) ||
            toMollieAddress(order.shippingAddress, order.customer);
        if (!billingAddress) {
            return new InvalidInputError(
                "Order doesn't have a complete shipping address or billing address. " +
                'At least city, postalCode, streetline1 and country are needed to create a payment intent.',
            );
        }
        const alreadyPaid = totalCoveredByPayments(order);
        const amountToPay = order.totalWithTax - alreadyPaid;
        if (amountToPay === 0) {
            // The order can be transitioned to PaymentSettled, because the order has 0 left to pay
            // Only admins can add payments, so we need an admin ctx
            const adminCtx = new RequestContext({
                apiType: 'admin',
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
                channel: ctx.channel,
                languageCode: ctx.languageCode,
                req: ctx.req,
            });
            await this.addPayment(
                adminCtx,
                order,
                amountToPay,
                {
                    paymentId: 'Settled without Mollie',
                    method: 'Settled without Mollie',
                },
                paymentMethod.code,
                'Settled',
            );
            return {
                url: redirectUrl,
            };
        }
        const paymentInput: CreatePaymentParameters = {
            description: order.code,
            amount: toAmount(amountToPay, order.currencyCode),
            redirectUrl,
            webhookUrl: `${vendureHost}/payments/mollie/${ctx.channel.token}/${paymentMethod.id}`,
            billingAddress,
            locale: input.locale as Locale,
            lines: toMolliePaymentLines(order, alreadyPaid),
            metadata: {
                languageCode: ctx.languageCode,
            },
            captureMode: input.immediateCapture === false ? CaptureMethod.manual : CaptureMethod.automatic,
        };
        if (molliePaymentMethodCode) {
            paymentInput.method = molliePaymentMethodCode as MollieClientMethod;
        }
        const molliePayment = await mollieClient.payments.create(paymentInput);
        Logger.info(`Created Mollie payment ${String(molliePayment.id)} for order ${order.code}`, loggerCtx);
        const url = molliePayment.getCheckoutUrl();
        if (!url) {
            throw Error('Unable to getCheckoutUrl() from Mollie payment');
        }
        return {
            url,
        };
    }

    /**
     * Update Vendure payments and order status based on the incoming Mollie payment
     */
    async handleMolliePaymentStatus(
        ctx: RequestContext,
        { paymentMethodId, paymentId }: OrderStatusInput,
    ): Promise<Order | undefined> {
        Logger.info(
            `Processing Mollie payment '${paymentId}'for channel ${ctx.channel.token}`,
            loggerCtx,
        );
        const paymentMethod = await this.paymentMethodService.findOne(ctx, paymentMethodId);
        if (!paymentMethod) {
            // Fail silently, as we don't want to expose if a paymentMethodId exists or not
            Logger.warn(`No paymentMethod found with id ${paymentMethodId}`, loggerCtx);
            return;
        }
        const apiKey = paymentMethod.handler.args.find(a => a.name === 'apiKey')?.value;
        if (!apiKey) {
            throw Error(`No apiKey found for payment ${paymentMethod.id} for channel ${ctx.channel.token}`);
        }
        const client = createMollieClient({ apiKey });
        const molliePayment = await client.payments.get(paymentId);
        const metadataLanguageCode: LanguageCode | undefined = (molliePayment.metadata as any)?.languageCode;
        if (metadataLanguageCode) {
            // Recreate ctx with the original languageCode
            ctx = new RequestContext({
                apiType: 'admin',
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
                req: ctx.req,
                channel: ctx.channel,
                languageCode: metadataLanguageCode,
            });
        }
        Logger.info(
            `Processing Mollie payment status '${molliePayment.status}' for order ${molliePayment.description
            } for channel ${ctx.channel.token} for Mollie payment ${paymentId}`,
            loggerCtx,
        );
        let order = await this.orderService.findOneByCode(ctx, molliePayment.description, ['payments']);
        if (!order) {
            throw Error(
                `Unable to find order ${molliePayment.description}, unable to process Mollie payment ${molliePayment.id}`,
            );
        }
        const mollieStatesThatRequireAction: PaymentStatus[] = [PaymentStatus.authorized, PaymentStatus.paid];
        if (!mollieStatesThatRequireAction.includes(molliePayment.status)) {
            // No need to handle this mollie status
            Logger.info(
                `Ignoring Mollie status '${molliePayment.status}' for order '${order.code}'`,
                loggerCtx,
            );
            return order;
        }
        if (order.orderPlacedAt) {
            const paymentWithSameTransactionId = order.payments.find(
                p => p.transactionId === molliePayment.id,
            );
            if (!paymentWithSameTransactionId) {
                // The order is paid for again, with another transaction ID. This means the customer paid twice
                Logger.error(
                    `Order '${order.code}' is already paid. Mollie payment '${molliePayment.id}' should be refunded.`,
                    loggerCtx,
                );
                return order;
            }
        }
        if (order.state === 'Cancelled' && molliePayment.status === PaymentStatus.paid) {
            Logger.error(
                `Order '${order.code}' is 'Cancelled'', but was paid for with '${molliePayment.id}'. Payment '${molliePayment.id
                }' should be refunded.`,
                loggerCtx,
            );
            return order;
        }
        // If order is not in one of these states, we don't need to handle the Mollie status
        const vendureStatesThatRequireAction: OrderState[] = [
            'AddingItems',
            'ArrangingPayment',
            'ArrangingAdditionalPayment',
            'PaymentAuthorized',
            'Draft',
        ];
        if (!vendureStatesThatRequireAction.includes(order.state)) {
            Logger.info(
                `Order ${order.code} is already '${order.state}', no need for handling Mollie status '${molliePayment.status}'`,
                loggerCtx,
            );
            return order;
        }
        const amount = amountToCents(molliePayment.amount);
        // Metadata to add to a payment
        const mollieMetadata: Omit<MolliePaymentMetadata, 'status' | 'amount'> = {
            paymentId: molliePayment.id,
            method: molliePayment.method,
            mode: molliePayment.mode,
            profileId: molliePayment.profileId,
            authorizedAt: molliePayment.authorizedAt,
            paidAt: molliePayment.paidAt,
        };
        if (order.state === 'PaymentAuthorized' && molliePayment.status === PaymentStatus.paid) {
            // If our order is in PaymentAuthorized state, it means a 2 step payment was used (E.g. a pay-later method like Klarna)
            await this.settleExistingPayment(ctx, order, molliePayment.id);
            return await this.orderService.findOne(ctx, order.id);
        }
        if (molliePayment.status === PaymentStatus.paid) {
            await this.addPayment(ctx, order, amount, mollieMetadata, paymentMethod.code, 'Settled');
            return await this.orderService.findOne(ctx, order.id);
        }
        if (order.state === 'AddingItems' && molliePayment.status === PaymentStatus.authorized) {
            // Transition order to PaymentAuthorized by creating an authorized payment
            order = await this.addPayment(
                ctx,
                order,
                amount,
                mollieMetadata,
                paymentMethod.code,
                'Authorized',
            );
            return await this.orderService.findOne(ctx, order.id);
        }
        // Any other combination of Mollie status and Vendure status indicates something is wrong.
        throw Error(
            `Unhandled incoming Mollie status '${molliePayment.status}' for order ${order.code} with status '${order.state}'`,
        );
    }

    /**
     * Add payment to order. Can be settled or authorized depending on the payment method.
     */
    async addPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        mollieMetadata: Omit<MolliePaymentMetadata, 'status' | 'amount'>,
        paymentMethodCode: string,
        status: 'Authorized' | 'Settled',
    ): Promise<Order> {
        if (order.state !== 'ArrangingPayment' && order.state !== 'ArrangingAdditionalPayment') {
            const transitionToStateResult = await this.orderService.transitionToState(
                ctx,
                order.id,
                'ArrangingPayment',
            );
            if (transitionToStateResult instanceof OrderStateTransitionError) {
                throw Error(
                    `Error transitioning order ${order.code} from ${transitionToStateResult.fromState} ` +
                    `to ${transitionToStateResult.toState}: ${transitionToStateResult.message}`,
                );
            }
        }
        const metadata: MolliePaymentMetadata = {
            amount,
            status,
            paymentId: mollieMetadata.paymentId,
            mode: mollieMetadata.mode,
            method: mollieMetadata.method,
            profileId: mollieMetadata.profileId,
            authorizedAt: mollieMetadata.authorizedAt,
            paidAt: mollieMetadata.paidAt,
        };
        const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
            method: paymentMethodCode,
            metadata,
        });
        if (!(addPaymentToOrderResult instanceof Order)) {
            throw Error(`Error adding payment to order ${order.code}: ${addPaymentToOrderResult.message}`);
        }
        return addPaymentToOrderResult;
    }

    /**
     * Settle an existing payment based on the given Mollie payment ID
     */
    async settleExistingPayment(ctx: RequestContext, order: Order, molliePaymentId: string): Promise<void> {
        order = await this.entityHydrator.hydrate(ctx, order, { relations: ['payments'] });
        const payment = order.payments.find(p => p.transactionId === molliePaymentId);
        if (!payment) {
            throw Error(
                `Cannot find payment ${molliePaymentId} for ${order.code}. Unable to settle this payment`,
            );
        }
        const result = await this.orderService.settlePayment(ctx, payment.id);
        if ((result as ErrorResult).message) {
            throw Error(
                `Error settling payment ${payment.id} for order ${order.code}: ${(result as ErrorResult).errorCode
                } - ${(result as ErrorResult).message}`,
            );
        }
    }

    async getEnabledPaymentMethods(
        ctx: RequestContext,
        paymentMethodCode: string,
    ): Promise<MolliePaymentMethod[]> {
        const [client] = await this.getMollieClient(ctx, paymentMethodCode);
        const activeOrder = await this.activeOrderService.getActiveOrder(ctx, undefined);
        const additionalParams = await this.options.enabledPaymentMethodsParams?.(
            this.injector,
            ctx,
            activeOrder ?? null,
        );
        const methods = await client.methods.list({
            ...additionalParams,
            resource: 'payments',
        });
        return methods.map(m => ({
            ...m,
            code: m.id,
        }));
    }

    /**
     * Fetches the payment from Mollie, and updates the status of the order in Vendure based on the Mollie payment status
     */
    async syncMolliePaymentStatus(ctx: RequestContext, orderCode: string): Promise<Order> {
        let order = await this.orderService.findOneByCode(ctx, orderCode);
        if (!order) {
            throw new ForbiddenError(LogLevel.Verbose);
        }
        const originalOrderState = order.state;
        const [mollieClient, paymentMethod] = await this.getMollieClient(ctx);
        // Find payments for orderCode that are authorized or paid
        const payments = mollieClient.payments.iterate()
            .take(500) // Only search through the last 500 payments for performance reasons
            .filter(payment => {
                return payment.description === orderCode && payment.status === PaymentStatus.paid || payment.status === PaymentStatus.authorized
            });
            const processedPaymentIds: string[] = [];
        for await (const payment of payments) {
            // This will handle the Mollie payment as if it were an incoming webhook
            order = await this.handleMolliePaymentStatus(ctx, { paymentMethodId: paymentMethod.id, paymentId: payment.id });
            processedPaymentIds.push(payment.id);
            if (order?.state === 'PaymentSettled') {
                break; // No further processing needed, because the order is already settled
            }
        }
        Logger.info(`Synced status for order '${order?.code}' from '${originalOrderState}' to '${order?.state}' based on Mollie payment(s) ${processedPaymentIds.join(',')}`, loggerCtx);
        if (
            !order ||
            !(await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(ctx, order))
        ) {
            throw new ForbiddenError(LogLevel.Verbose);
        }
        return order;
    }

    /**
     * Get the Mollie client for the current channel
     */
    private async getMollieClient(ctx: RequestContext, paymentMethodCode?: string): Promise<[MollieClient, PaymentMethod]> {
        const paymentMethod = await this.getPaymentMethod(ctx, paymentMethodCode);
        if (!paymentMethod) {
            throw Error(`No Mollie payment method found`);
        }
        const apiKey = paymentMethod?.handler.args.find(arg => arg.name === 'apiKey')?.value;
        if (!apiKey) {
            throw Error(`No apiKey configured for payment method ${paymentMethod.code}`);
        }
        return [createMollieClient({ apiKey }), paymentMethod];
    }

    /**
     * Dry run a transition to a given state.
     * As long as we don't call 'finalize', the transition never completes.
     */
    private async canTransitionTo(ctx: RequestContext, orderId: ID, state: OrderState) {
        // Fetch new order object, because `transition()` mutates the order object
        const orderCopy = await assertFound(this.orderService.findOne(ctx, orderId));
        const orderStateMachine = this.injector.get(OrderStateMachine);
        await orderStateMachine.transition(ctx, orderCopy, state);
    }

    /**
     * Get the Mollie payment method by code, or the first payment method with Mollie as handler
     */
    private async getPaymentMethod(
        ctx: RequestContext,
        paymentMethodCode?: string | null,
    ): Promise<PaymentMethod | undefined> {
        if (paymentMethodCode) {
            const { items } = await this.paymentMethodService.findAll(ctx, {
                filter: {
                    code: { eq: paymentMethodCode },
                },
            });
            return items.find(pm => pm.code === paymentMethodCode);
        } else {
            const { items } = await this.paymentMethodService.findAll(ctx);
            return items.find(pm => pm.handler.code === molliePaymentHandler.code);
        }
    }

    /**
     * Get order by id, or active order if no orderId is given.
     *
     * Fetches order with all needed relations
     */
    private async getOrder(ctx: RequestContext, orderId?: ID | null): Promise<Order | PaymentIntentError> {
        if (!orderId) {
            const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
            if (!order) {
                return new PaymentIntentError('No active order found for session');
            }
            orderId = order.id;
        }
        return await assertFound(
            this.orderService.findOne(ctx, orderId, [
                'customer',
                'surcharges',
                'lines.productVariant',
                'lines.productVariant.translations',
                'shippingLines.shippingMethod',
                'payments',
            ]),
        );
    }
}
