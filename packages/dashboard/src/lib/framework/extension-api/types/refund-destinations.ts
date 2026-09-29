import React from 'react';

/**
 * @description
 * The props passed to a refund destination's configuration component.
 *
 * @docsCategory extensions-api
 * @docsPage RefundDestinations
 * @since 3.8.0
 */
export interface RefundDestinationComponentProps {
    /**
     * @description
     * The amount currently allocated to this destination, in minor units.
     */
    amount: number;
    /**
     * @description
     * The id of the Payment the refund will be drawn from.
     */
    paymentId: string;
    /**
     * @description
     * The currency code of the Order being refunded.
     */
    currencyCode: string;
    /**
     * @description
     * The current configuration value, as last set by `onChange`. Undefined until the component
     * sets a value.
     */
    value: Record<string, any> | undefined;
    /**
     * @description
     * Sets the configuration value for this destination. Whatever is passed here is sent to the
     * server as the `arguments` of the refund target, and is passed to the matching
     * `RefundDestinationStrategy.createRefund()` method on the backend.
     */
    onChange: (value: Record<string, any> | undefined) => void;
}

/**
 * @description
 * Defines the dashboard-side presentation of a refund destination. The destination itself is
 * defined on the backend by a `RefundDestinationStrategy`; this extension adds an icon, a label
 * and an optional configuration component to the refund dialog.
 *
 * A destination only appears in the refund dialog if the backend reports it as available for the
 * Order, so registering one here for which no backend strategy exists has no effect.
 *
 * @example
 * ```tsx
 * import { defineDashboardExtension } from '\@vendure/dashboard';
 * import { Wallet } from 'lucide-react';
 *
 * defineDashboardExtension({
 *     refundDestinations: [
 *         {
 *             code: 'store-credit',
 *             label: 'Refund as store credit',
 *             icon: Wallet,
 *             component: ({ value, onChange }) => (
 *                 <input
 *                     type="number"
 *                     placeholder="Expires in days"
 *                     value={value?.expiresInDays ?? ''}
 *                     onChange={e => onChange({ expiresInDays: Number(e.target.value) })}
 *                 />
 *             ),
 *         },
 *     ],
 * });
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage RefundDestinations
 * @since 3.8.0
 * @docsWeight 0
 */
export interface DashboardRefundDestinationDefinition {
    /**
     * @description
     * Must match the `code` of the corresponding backend `RefundDestinationStrategy`.
     */
    code: string;
    /**
     * @description
     * The label shown in the refund dialog. When omitted, the translated description supplied by
     * the backend strategy is used.
     */
    label?: string;
    /**
     * @description
     * An optional icon shown next to the label.
     */
    icon?: React.ComponentType<{ className?: string }>;
    /**
     * @description
     * An optional component rendered when this destination is selected, allowing extra
     * configuration to be collected. The value it produces is passed to the backend strategy's
     * `createRefund()` method.
     */
    component?: React.ComponentType<RefundDestinationComponentProps>;
}
