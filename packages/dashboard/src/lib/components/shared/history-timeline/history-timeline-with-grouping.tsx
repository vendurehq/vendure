import { Button } from '@/vdb/components/ui/button.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/history-entries.js';
import { getCustomHistoryEntryForType } from '@/vdb/framework/history-entry/history-entry-extensions.js';
import { Trans } from '@lingui/react/macro';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { CustomerHistoryCustomerDetail } from '../../../../app/routes/_authenticated/_customers/components/customer-history/customer-history-types.js';
import { OrderHistoryOrderDetail } from '../../../../app/routes/_authenticated/_orders/components/order-history/order-history-types.js';
import { HistoryTimeline } from './history-timeline.js';

interface HistoryTimelineWithGroupingProps {
    historyEntries: HistoryEntryItem[];
    entity: OrderHistoryOrderDetail | CustomerHistoryCustomerDetail;
    isPrimaryEvent: (entry: HistoryEntryItem) => boolean;
    renderEntryContent: (entry: HistoryEntryItem) => ReactNode;
    children?: ReactNode;
}

type EntryWithIndex = {
    entry: HistoryEntryItem;
    index: number;
};

export function HistoryTimelineWithGrouping({
    historyEntries,
    entity,
    isPrimaryEvent,
    renderEntryContent,
    children,
}: Readonly<HistoryTimelineWithGroupingProps>) {
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

    // Group consecutive secondary events
    const groupedEntries: Array<
        | ({ type: 'primary' } & EntryWithIndex)
        | {
              type: 'secondary-group';
              entries: Array<EntryWithIndex>;
              startIndex: number;
          }
    > = [];
    let currentGroup: Array<EntryWithIndex> = [];

    for (let i = 0; i < historyEntries.length; i++) {
        const entry = historyEntries[i];
        const isSecondary = !isPrimaryEvent(entry);

        if (isSecondary) {
            currentGroup.push({ entry, index: i });
        } else {
            // If we have accumulated secondary events, add them as a group
            if (currentGroup.length > 0) {
                groupedEntries.push({
                    type: 'secondary-group',
                    entries: currentGroup,
                    startIndex: currentGroup[0].index,
                });
                currentGroup = [];
            }
            // Add the primary event
            groupedEntries.push({ type: 'primary', entry, index: i });
        }
    }

    // Don't forget the last group if it exists
    if (currentGroup.length > 0) {
        groupedEntries.push({
            type: 'secondary-group',
            entries: currentGroup,
            startIndex: currentGroup[0].index,
        });
    }

    const renderEntry = (entry: HistoryEntryItem) => {
        const CustomType = getCustomHistoryEntryForType(entry.type);
        if (CustomType) {
            return <CustomType entry={entry} entity={entity} />;
        } else {
            return renderEntryContent(entry);
        }
    };

    const toggleGroup = (groupIndex: number) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(groupIndex)) {
            newExpanded.delete(groupIndex);
        } else {
            newExpanded.add(groupIndex);
        }
        setExpandedGroups(newExpanded);
    };

    return (
        <div className="">
            {children && <div className="mb-4">{children}</div>}
            <HistoryTimeline>
                {groupedEntries.map((group, groupIndex) => {
                    if (group.type === 'primary') {
                        const entry = group.entry;
                        return <div key={entry.id}>{renderEntry(entry)}</div>;
                    } else {
                        // Secondary group
                        const shouldCollapse = group.entries.length > 3;
                        const isExpanded = expandedGroups.has(groupIndex);
                        const visibleEntries =
                            shouldCollapse && !isExpanded ? group.entries.slice(0, 2) : group.entries;

                        return (
                            <div key={`group-${groupIndex}`}>
                                {visibleEntries.map(({ entry }) => (
                                    <div key={entry.id}>{renderEntry(entry)}</div>
                                ))}
                                {shouldCollapse && (
                                    <div className="flex justify-center py-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => toggleGroup(groupIndex)}
                                            className="text-muted-foreground hover:text-foreground h-6 text-xs"
                                        >
                                            {isExpanded ? (
                                                <>
                                                    <ChevronUp className="w-3 h-3 mr-1" />
                                                    <Trans>Show less</Trans>
                                                </>
                                            ) : (
                                                <>
                                                    <ChevronDown className="w-3 h-3 mr-1" />
                                                    <Trans>
                                                        Show all ({group.entries.length - 2})
                                                    </Trans>
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    }
                })}
            </HistoryTimeline>
        </div>
    );
}
