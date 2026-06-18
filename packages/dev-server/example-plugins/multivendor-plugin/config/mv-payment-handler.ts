import { OrderType } from '@vendure/common/lib/generated-types';
import {
    CreatePaymentResult,
    LanguageCode,
    PaymentMethodHandler,
    SettlePaymentErrorResult,
    SettlePaymentResult,
} from '@vendure/core';

import { MyConnectSdk } from '../payment/mv-connect-sdk';

const sdk = new MyConnectSdk({ apiKey: 'MY_API_KEY' });

export const multivendorPaymentMethodHandler = new PaymentMethodHandler({
    code: 'mv-connect-payment-method',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Multivendor Payment Provider',
        },
    ],
    args: {},
    createPayment: async (ctx, order, amount, args, metadata) => {
        if (order.type === OrderType.Seller) {
            try {
                // Create a Transfer payment to the Seller's account
                const result = await sdk.createTransfer({
                    amount,
                    currency: order.currencyCode,
                    connectedAccountId: metadata.connectedAccountId,
                    transfer_group: metadata.transfer_group,
                });
                return {
                    amount,
                    state: 'Settled' as const,
                    transactionId: result.transactionId,
                    metadata,
                };
            } catch (err: any) {
                return {
                    amount,
                    state: 'Declined' as const,
                    metadata: {
                        errorMessage: err.message,
                    },
                };
            }
        } else {
            try {
                // Create a payment to the platform's account,
                // and set the `transfer_group` option to later link
                // with the Seller transfers after the Seller orders
                // have been created.
                const result = await sdk.createPayment({
                    amount,
                    currency: order.currencyCode,
                    transfer_group: order.code,
                });
                return {
                    amount,
                    state: 'Settled' as const,
                    transactionId: result.transactionId,
                    metadata: {
                        transfer_group: order.code,
                    },
                };
            } catch (err: any) {
                return {
                    amount,
                    state: 'Declined' as const,
                    metadata: {
                        errorMessage: err.message,
                    },
                };
            }
        }
    },
    settlePayment: async (ctx, order, payment, args) => {
        return { success: true };
    },
});
