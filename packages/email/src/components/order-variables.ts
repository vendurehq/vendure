import { EmailVariable } from '../template/email-template';

import { formatDate, formatMoney } from './formatting';
import { EmailOrder } from './order-blocks';

/**
 * @description
 * The variables that every order email's text can use: `orderCode`, `customerFirstName`,
 * `customerFullName`, `orderTotal` and `orderDate`. Spread them into a template's `variables`.
 *
 * @example
 * ```ts
 * variables: {
 *     ...orderVariables(),
 *     trackingCode: { label: 'Tracking number', value: ({ fulfillment }) => fulfillment.trackingCode },
 * },
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export function orderVariables<Props extends { order: EmailOrder }>(): Record<string, EmailVariable<Props>> {
    return {
        orderCode: { label: 'Order code', value: ({ order }) => order.code },
        customerFirstName: { label: 'Customer first name', value: ({ order }) => order.customer?.firstName },
        customerFullName: {
            label: 'Customer full name',
            value: ({ order }) =>
                [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' '),
        },
        orderTotal: {
            label: 'Order total',
            value: ({ order }, { languageCode }) => formatMoney(order.totalWithTax, order.currencyCode, languageCode),
        },
        orderDate: {
            label: 'Order date',
            value: ({ order }, { languageCode }) =>
                order.orderPlacedAt ? formatDate(order.orderPlacedAt, languageCode) : '',
        },
    };
}
