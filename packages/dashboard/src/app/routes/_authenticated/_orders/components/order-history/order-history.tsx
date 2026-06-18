import { HistoryNoteEditor } from '@/vdb/components/shared/history-timeline/history-note-editor.js';
import { HistoryNoteEntry } from '@/vdb/components/shared/history-timeline/history-note-entry.js';
import { HistoryNoteInput } from '@/vdb/components/shared/history-timeline/history-note-input.js';
import { HistoryTimelineWithGrouping } from '@/vdb/components/shared/history-timeline/history-timeline-with-grouping.js';
import { useHistoryNoteEditor } from '@/vdb/components/shared/history-timeline/use-history-note-editor.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { HistoryEntry, HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import {
    OrderCancellationComponent,
    OrderCustomerUpdatedComponent,
    OrderFulfillmentComponent,
    OrderFulfillmentTransitionComponent,
    OrderModifiedComponent,
    OrderPaymentTransitionComponent,
    OrderRefundTransitionComponent,
    OrderStateTransitionComponent,
} from './default-order-history-components.js';
import { OrderHistoryOrderDetail } from './order-history-types.js';
import { orderHistoryUtils } from './order-history-utils.js';

interface OrderHistoryProps {
    order: OrderHistoryOrderDetail;
    historyEntries: Array<HistoryEntryItem>;
    onAddNote: (note: string, isPrivate: boolean) => void;
    onUpdateNote?: (entryId: string, note: string, isPrivate: boolean) => void;
    onDeleteNote?: (entryId: string) => void;
}

export function OrderHistory({
    order,
    historyEntries,
    onAddNote,
    onUpdateNote,
    onDeleteNote,
}: Readonly<OrderHistoryProps>) {
    const { noteState, noteEditorOpen, handleEditNote, setNoteEditorOpen } = useHistoryNoteEditor();

    const handleDeleteNote = (noteId: string) => {
        onDeleteNote?.(noteId);
    };

    const handleNoteEditorSave = (noteId: string, note: string, isPrivate: boolean) => {
        onUpdateNote?.(noteId, note, isPrivate);
    };

    const { getTimelineIcon, getTitle, getIconColor, getActorName, isPrimaryEvent } =
        orderHistoryUtils(order);

    const renderEntryContent = (entry: HistoryEntryItem) => {
        const props: HistoryEntryProps = {
            entry,
            title: getTitle(entry),
            actorName: getActorName(entry),
            timelineIcon: getTimelineIcon(entry),
            timelineIconClassName: getIconColor(entry),
            isPrimary: isPrimaryEvent(entry),
            children: null,
        };
        if (entry.type === 'ORDER_NOTE') {
            return (
                <HistoryNoteEntry {...props} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} />
            );
        } else if (entry.type === 'ORDER_STATE_TRANSITION') {
            return <OrderStateTransitionComponent {...props} />;
        } else if (entry.type === 'ORDER_PAYMENT_TRANSITION') {
            return <OrderPaymentTransitionComponent {...props} />;
        } else if (entry.type === 'ORDER_REFUND_TRANSITION') {
            return <OrderRefundTransitionComponent {...props} />;
        } else if (entry.type === 'ORDER_FULFILLMENT_TRANSITION') {
            return <OrderFulfillmentTransitionComponent {...props} />;
        } else if (entry.type === 'ORDER_FULFILLMENT') {
            return <OrderFulfillmentComponent {...props} />;
        } else if (entry.type === 'ORDER_MODIFIED') {
            return <OrderModifiedComponent {...props} />;
        } else if (entry.type === 'ORDER_CUSTOMER_UPDATED') {
            return <OrderCustomerUpdatedComponent {...props} />;
        } else if (entry.type === 'ORDER_CANCELLATION') {
            return <OrderCancellationComponent {...props} />;
        }
        return (
            <HistoryEntry {...props}>
                {entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) && Object.keys(entry.data).length > 0 && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                        {Object.entries(entry.data).map(([key, value]) => (
                            <p key={key}>
                                <span className="font-medium">{key}:</span>{' '}
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </p>
                        ))}
                    </div>
                )}
            </HistoryEntry>
        );
    };

    return (
        <>
            <HistoryTimelineWithGrouping
                historyEntries={historyEntries}
                isPrimaryEvent={isPrimaryEvent}
                renderEntryContent={renderEntryContent}
                entity={order}
            >
                <HistoryNoteInput onAddNote={onAddNote} />
            </HistoryTimelineWithGrouping>
            <HistoryNoteEditor
                key={noteState.noteId}
                note={noteState.note}
                onNoteChange={handleNoteEditorSave}
                open={noteEditorOpen}
                onOpenChange={setNoteEditorOpen}
                noteId={noteState.noteId}
                isPrivate={noteState.isPrivate}
            />
        </>
    );
}
