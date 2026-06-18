import { HistoryEntryType } from '@vendure/common/lib/generated-types';

import { RefundState } from '../../service/helpers/refund-state-machine/refund-state';

import { RefundProcess } from './refund-process';

let configService: import('../config.service').ConfigService;
let historyService: import('../../service/index').HistoryService;

/**
 * @description
 * The default {@link RefundProcess}.
 *
 * @docsCategory payment
 */
export const defaultRefundProcess: RefundProcess<RefundState> = {
    transitions: {
        Pending: {
            to: ['Settled', 'Failed'],
        },
        Settled: {
            to: [],
        },
        Failed: {
            to: [],
        },
    },
    async init(injector) {
        const ConfigService = await import('../config.service.js').then(m => m.ConfigService);
        const HistoryService = await import('../../service/index.js').then(m => m.HistoryService);
        configService = injector.get(ConfigService);
        historyService = injector.get(HistoryService);
    },
    onTransitionStart: async (fromState, toState, data) => {
        return true;
    },
    onTransitionEnd: async (fromState, toState, data) => {
        if (!historyService) {
            throw new Error('HistoryService has not been initialized');
        }
        await historyService.createHistoryEntryForOrder({
            ctx: data.ctx,
            orderId: data.order.id,
            type: HistoryEntryType.ORDER_REFUND_TRANSITION,
            data: {
                refundId: data.refund.id,
                from: fromState,
                to: toState,
                reason: data.refund.reason,
            },
        });
    },
};
