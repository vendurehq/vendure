import type { Tone } from '@/vdb/components/ui/status-badge.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import {
    TimelineContent,
    TimelineItem,
    TimelineMarker,
    TimelineMeta,
    TimelineTitle,
} from '@vendure-io/ui/components/molecules/timeline';
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
     * An icon which is used to represent the entry. It takes the place of the
     * timeline dot. Note that this will only display if `isPrimary` is `true`.
     */
    timelineIcon?: React.ReactNode;
    /**
     * @description
     * The tone of the entry's timeline marker, from the state dictionary. Most
     * entries stay `neutral`; a tone marks an entry the user must notice. For
     * instance, the tone of an order state transition:
     *
     * ```ts
     * const tone = orderStateDictionary.toneFor(entry.data.to);
     * ```
     *
     * @since 4.0.0
     */
    tone?: Tone;
    /**
     * @description
     * Deprecated: use `tone`. Without a `tone`, the tone is read from the tone
     * name in these classes (`success`, `warning`, `destructive`, `info`), so
     * `'bg-success text-success-foreground'` gives a `success` marker. Other
     * classes are not applied.
     *
     * @deprecated Use `tone`.
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
 * The tone named in a legacy `timelineIconClassName`, so extensions written
 * before `tone` keep their colour.
 */
function toneFromClassName(className: string | undefined): Tone {
    if (!className) {
        return 'neutral';
    }
    if (/\bdestructive\b|-destructive/.test(className)) {
        return 'critical';
    }
    if (/-warning/.test(className)) {
        return 'warning';
    }
    if (/-success/.test(className)) {
        return 'success';
    }
    if (/-info/.test(className)) {
        return 'info';
    }
    return 'neutral';
}

/**
 * @description
 * A component which is used to display a history entry in the order/customer history timeline.
 * It renders one entry of the design-system Timeline: a marker in the entry's tone, the title,
 * the time and the actor, then any children.
 *
 * @docsCategory extensions-api
 * @docsPage HistoryEntries
 * @since 3.4.3
 */
export function HistoryEntry({
    entry,
    timelineIcon,
    tone,
    timelineIconClassName,
    actorName,
    title,
    children,
    isPrimary = true,
}: Readonly<HistoryEntryProps>) {
    return (
        <TimelineItem key={entry.id}>
            <TimelineMarker tone={tone ?? toneFromClassName(timelineIconClassName)}>
                {isPrimary ? timelineIcon : null}
            </TimelineMarker>
            <TimelineContent>
                <TimelineTitle className={isPrimary ? 'font-medium' : 'text-muted-foreground'}>
                    {title}
                </TimelineTitle>
                <TimelineMeta>
                    <HistoryEntryDate date={entry.createdAt} className="cursor-help" />
                    {actorName ? <> · {actorName}</> : null}
                </TimelineMeta>
                {children ? <div className="mt-2">{children}</div> : null}
            </TimelineContent>
        </TimelineItem>
    );
}
