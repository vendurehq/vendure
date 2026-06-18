import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { cn } from '@/vdb/lib/utils.js';
import React from 'react';
import { HistoryEntryDate } from '../../components/shared/history-timeline/history-entry-date.js';

/**
 * @description
 * The props for the {@link HistoryEntry} component.
 *
 * @docsCategory extensions-api
 * @docsPage HistoryEntries
 * @since 3.4.3
 */
export interface HistoryEntryProps {
    /**
     * @description
     * The entry itself, which will get passed down to your custom component
     */
    entry: HistoryEntryItem;
    /**
     * @description
     * The title of the entry
     */
    title: string | React.ReactNode;
    /**
     * @description
     * An icon which is used to represent the entry. Note that this will only
     * display if `isPrimary` is `true`.
     */
    timelineIcon?: React.ReactNode;
    /**
     * @description
     * Optional tailwind classes to apply to the icon. For instance
     *
     * ```ts
     * const success = 'bg-success text-success-foreground';
     * const destructive = 'bg-destructive text-destructive-foreground';
     * ```
     */
    timelineIconClassName?: string;
    /**
     * @description
     * The name to display of "who did the action". For instance:
     *
     * ```ts
     * const getActorName = (entry: HistoryEntryItem) => {
     *     if (entry.administrator) {
     *         return `${entry.administrator.firstName} ${entry.administrator.lastName}`;
     *     } else if (entity?.customer) {
     *         return `${entity.customer.firstName} ${entity.customer.lastName}`;
     *     }
     *     return '';
     * };
     * ```
     */
    actorName?: string;
    children: React.ReactNode;
    /**
     * @description
     * When set to `true`, the timeline entry will feature the specified icon and will not
     * be collapsible.
     */
    isPrimary?: boolean;
}

/**
 * @description
 * A component which is used to display a history entry in the order/customer history timeline.
 *
 * @docsCategory extensions-api
 * @docsPage HistoryEntries
 * @since 3.4.3
 */
export function HistoryEntry({
    entry,
    timelineIcon,
    timelineIconClassName,
    actorName,
    title,
    children,
    isPrimary = true,
}: Readonly<HistoryEntryProps>) {
    return (
        <div key={entry.id} className="relative group">
            <div
                className={`flex gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors ${!isPrimary ? 'opacity-90' : ''}`}
            >
                <div className={cn(`relative z-10 flex-shrink-0`, isPrimary ? 'ml-0' : 'ml-2 mt-1')}>
                    <div
                        className={`rounded-full flex items-center justify-center ${isPrimary ? 'h-6 w-6' : 'h-2 w-2 border'} ${timelineIconClassName ?? ''}`}
                    >
                        <div className={isPrimary ? 'text-current scale-80' : 'text-current scale-0'}>
                            {timelineIcon ?? ''}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            <h4
                                className={`text-sm ${isPrimary ? 'font-medium text-foreground' : 'font-normal text-muted-foreground'}`}
                            >
                                {title}
                            </h4>
                            <div className="mt-1">{children}</div>
                        </div>

                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                            <div className="text-right">
                                <HistoryEntryDate
                                    date={entry.createdAt}
                                    className={`text-xs cursor-help ${isPrimary ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
                                />
                                {actorName && (
                                    <div
                                        className={`text-xs ${isPrimary ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
                                    >
                                        {actorName}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
