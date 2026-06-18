import React from 'react';

import { CustomerHistoryCustomerDetail } from '../../../../app/routes/_authenticated/_customers/components/customer-history/customer-history-types.js';
import { OrderHistoryOrderDetail } from '../../../../app/routes/_authenticated/_orders/components/order-history/order-history-types.js';

/**
 * @description
 * This object contains the information about the history entry.
 *
 * @docsCategory extensions-api
 * @docsPage HistoryEntries
 * @since 3.4.3
 */
export interface HistoryEntryItem {
    id: string;
    /**
     * @description
     * The `HistoryEntryType`, such as `ORDER_STATE_TRANSITION`.
     */
    type: string;
    createdAt: string;
    /**
     * @description
     * Whether this entry is visible to customers via the Shop API
     */
    isPublic: boolean;
    /**
     * @description
     * If an Administrator created this entry, their details will
     * be available here.
     */
    administrator?: {
        id: string;
        firstName: string;
        lastName: string;
    } | null;
    /**
     * @description
     * The entry payload data. This will be an object, which is different
     * for each type of history entry.
     *
     * For example, the `CUSTOMER_ADDED_TO_GROUP` data looks like this:
     * ```json
     * {
     *   groupName: 'Some Group',
     * }
     * ```
     *
     * and the `ORDER_STATE_TRANSITION` data looks like this:
     * ```json
     * {
     *   from: 'ArrangingPayment',
     *   to: 'PaymentSettled',
     * }
     * ```
     */
    data: any;
}

/**
 * @description
 * A definition of a custom component that will be used to render the given
 * type of history entry.
 *
 * @example
 * ```tsx
 * import { defineDashboardExtension, HistoryEntry } from '\@vendure/dashboard';
 * import { IdCard } from 'lucide-react';
 *
 * defineDashboardExtension({
 *     historyEntries: [
 *         {
 *             type: 'CUSTOMER_TAX_ID_APPROVAL',
 *             component: ({ entry, entity }) => {
 *                 return (
 *                     <HistoryEntry
 *                         entry={entry}
 *                         title={'Tax ID verified'}
 *                         timelineIconClassName={'bg-success text-success-foreground'}
 *                         timelineIcon={<IdCard />}
 *                     >
 *                         <div className="text-xs">Approval reference: {entry.data.ref}</div>
 *                     </HistoryEntry>
 *                 );
 *             },
 *         },
 *     ],
 *  });
 *  ```
 *
 * @docsCategory extensions-api
 * @docsPage HistoryEntries
 * @since 3.4.3
 * @docsWeight 0
 */
export interface DashboardHistoryEntryComponent {
    /**
     * @description
     * The `type` should correspond to a valid `HistoryEntryType`, such as
     *
     * - `CUSTOMER_REGISTERED`
     * - `ORDER_STATE_TRANSITION`
     * - some custom type - see the {@link HistoryService} docs for a guide on
     *   how to define custom history entry types.
     */
    type: string;
    /**
     * @description
     * The component which is used to render the timeline entry. It should use the
     * {@link HistoryEntry} component and pass the appropriate props to configure
     * how it will be displayed.
     *
     * The `entity` prop will be a subset of the Order object for Order history entries,
     * or a subset of the Customer object for customer history entries.
     */
    component: React.ComponentType<{
        entry: HistoryEntryItem;
        entity: OrderHistoryOrderDetail | CustomerHistoryCustomerDetail;
    }>;
}
