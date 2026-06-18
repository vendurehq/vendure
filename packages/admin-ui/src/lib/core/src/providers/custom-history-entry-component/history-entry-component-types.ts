import { Type } from '@angular/core';

import { CustomerFragment, GetOrderHistoryQuery, OrderDetailFragment } from '../../common/generated-types';
import { TimelineDisplayType } from '../../shared/components/timeline-entry/timeline-entry.component';

export type TimelineHistoryEntry = NonNullable<GetOrderHistoryQuery['order']>['history']['items'][number];
/**
 * @description
 * This interface should be implemented by components intended to display a history entry in the
 * Order or Customer history timeline. If the component needs access to the Order or Customer object itself,
 * you should implement {@link OrderHistoryEntryComponent} or {@link CustomerHistoryEntryComponent} respectively.
 *
 * @since 1.9.0
 * @docsCategory custom-history-entry-components
 */
export interface HistoryEntryComponent {
    /**
     * @description
     * The HistoryEntry data.
     */
    entry: TimelineHistoryEntry;
    /**
     * @description
     * Defines whether this entry is highlighted with a "success", "error" etc. color.
     */
    getDisplayType: (entry: TimelineHistoryEntry) => TimelineDisplayType;
    /**
     * @description
     * Featured entries are always expanded. Non-featured entries start of collapsed and can be clicked
     * to expand.
     */
    isFeatured: (entry: TimelineHistoryEntry) => boolean;
    /**
     * @description
     * Returns the name of the person who did this action. For example, it could be the Customer's name
     * or "Administrator".
     */
    getName?: (entry: TimelineHistoryEntry) => string | undefined;
    /**
     * @description
     * Optional Clarity icon shape to display with the entry. Examples: `'note'`, `['success-standard', 'is-solid']`
     */
    getIconShape?: (entry: TimelineHistoryEntry) => string | string[] | undefined;
}

/**
 * @description
 * Used to implement a {@link HistoryEntryComponent} which requires access to the Order object.
 *
 * @since 1.9.0
 * @docsCategory custom-history-entry-components
 */
export interface OrderHistoryEntryComponent extends HistoryEntryComponent {
    order: OrderDetailFragment;
}

/**
 * @description
 * Used to implement a {@link HistoryEntryComponent} which requires access to the Customer object.
 *
 * @since 1.9.0
 * @docsCategory custom-history-entry-components
 */
export interface CustomerHistoryEntryComponent extends HistoryEntryComponent {
    customer: CustomerFragment;
}

/**
 * @description
 * Configuration for registering a custom {@link HistoryEntryComponent}.
 *
 * @since 1.9.0
 * @docsCategory custom-history-entry-components
 */
export interface HistoryEntryConfig {
    /**
     * @description
     * The type should correspond to the custom HistoryEntryType string.
     */
    type: string;
    /**
     * @description
     * The component to be rendered for this history entry type.
     */
    component: Type<HistoryEntryComponent>;
}
