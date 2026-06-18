import { HistoryEntryType } from '@vendure/common/lib/generated-types';

import { PaymentState } from '../../service/helpers/payment-state-machine/payment-state';
import { orderTotalIsCovered } from '../../service/helpers/utils/order-utils';

import { PaymentProcess } from './payment-process';

declare module '../../service/helpers/payment-state-machine/payment-state' {
    interface PaymentStates {
        Authorized: never;
        Settled: never;
        Declined: never;
    }
}

let configService: import('../config.service').ConfigService;
let orderService: import('../../service/services/order.service').OrderService;
let historyService: import('../../service/index').HistoryService;

/**
 * @description
 * The default {@link PaymentProcess}
 *
 * @docsCategory payment
 */
export const defaultPaymentProcess: PaymentProcess<PaymentState> = {
    transitions: {
        Created: {
            to: ['Authorized', 'Settled', 'Declined', 'Error', 'Cancelled'],
        },
        Authorized: {
            to: ['Settled', 'Error', 'Cancelled'],
        },
        Settled: {
            to: ['Cancelled'],
        },
        Declined: {
            to: ['Cancelled'],
        },
        Error: {
            to: ['Cancelled'],
        },
        Cancelled: {
            to: [],
        },
    },
    async init(injector) {
        // Lazily import these services to avoid a circular dependency error
        // due to this being used as part of the DefaultConfig
        const ConfigService = await import('../config.service.js').then(m => m.ConfigService);
        const HistoryService = await import('../../service/index.js').then(m => m.HistoryService);
        const OrderService = await import('../../service/services/order.service.js').then(
            m => m.OrderService,
        );
        configService = injector.get(ConfigService);
        historyService = injector.get(HistoryService);
        orderService = injector.get(OrderService);
    },
    async onTransitionStart(fromState, toState, data) {
        // nothing here by default
    },
    async onTransitionEnd(fromState, toState, data) {
        const { ctx, payment, order } = data;
        order.payments = await orderService.getOrderPayments(ctx, order.id);

        await historyService.createHistoryEntryForOrder({
            ctx: data.ctx,
            orderId: data.order.id,
            type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
            data: {
                paymentId: data.payment.id,
                from: fromState,
                to: toState,
            },
        });

        if (
            orderTotalIsCovered(order, 'Settled') &&
            order.state !== 'PaymentSettled' &&
            order.state !== 'ArrangingAdditionalPayment'
        ) {
            await orderService.transitionToState(ctx, order.id, 'PaymentSettled');
        } else if (
            orderTotalIsCovered(order, ['Authorized', 'Settled']) &&
            order.state !== 'PaymentAuthorized' &&
            order.state !== 'ArrangingAdditionalPayment'
        ) {
            await orderService.transitionToState(ctx, order.id, 'PaymentAuthorized');
        }
    },
};
