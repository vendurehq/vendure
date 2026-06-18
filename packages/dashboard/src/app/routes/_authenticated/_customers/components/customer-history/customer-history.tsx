import { HistoryNoteEditor } from '@/vdb/components/shared/history-timeline/history-note-editor.js';
import { HistoryNoteEntry } from '@/vdb/components/shared/history-timeline/history-note-entry.js';
import { HistoryNoteInput } from '@/vdb/components/shared/history-timeline/history-note-input.js';
import { HistoryTimelineWithGrouping } from '@/vdb/components/shared/history-timeline/history-timeline-with-grouping.js';
import { useHistoryNoteEditor } from '@/vdb/components/shared/history-timeline/use-history-note-editor.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/history-entries.js';
import { HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import { CustomerHistoryCustomerDetail } from './customer-history-types.js';
import { customerHistoryUtils } from './customer-history-utils.js';
import {
    CustomerAddRemoveGroupComponent,
    CustomerAddressCreatedComponent,
    CustomerAddressDeletedComponent,
    CustomerAddressUpdatedComponent,
    CustomerDetailUpdatedComponent,
    CustomerEmailUpdateComponent,
    CustomerPasswordResetRequestedComponent,
    CustomerPasswordResetVerifiedComponent,
    CustomerPasswordUpdatedComponent,
    CustomerRegisteredOrVerifiedComponent,
} from './default-customer-history-components.js';

interface CustomerHistoryProps {
    customer: CustomerHistoryCustomerDetail;
    historyEntries: HistoryEntryItem[];
    onAddNote: (note: string, isPrivate: boolean) => void;
    onUpdateNote?: (entryId: string, note: string, isPrivate: boolean) => void;
    onDeleteNote?: (entryId: string) => void;
}

export function CustomerHistory({
    customer,
    historyEntries,
    onAddNote,
    onUpdateNote,
    onDeleteNote,
}: Readonly<CustomerHistoryProps>) {
    const { noteState, noteEditorOpen, handleEditNote, setNoteEditorOpen } = useHistoryNoteEditor();

    const handleDeleteNote = (noteId: string) => {
        onDeleteNote?.(noteId);
    };

    const handleNoteEditorSave = (noteId: string, note: string, isPrivate: boolean) => {
        onUpdateNote?.(noteId, note, isPrivate);
    };

    const { getTimelineIcon, getTitle, getIconColor, getActorName, isPrimaryEvent } =
        customerHistoryUtils(customer);

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
        if (entry.type === 'CUSTOMER_REGISTERED' || entry.type === 'CUSTOMER_VERIFIED') {
            return <CustomerRegisteredOrVerifiedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_DETAIL_UPDATED') {
            return <CustomerDetailUpdatedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_ADDED_TO_GROUP' || entry.type === 'CUSTOMER_REMOVED_FROM_GROUP') {
            return <CustomerAddRemoveGroupComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_ADDRESS_CREATED') {
            return <CustomerAddressCreatedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_ADDRESS_UPDATED') {
            return <CustomerAddressUpdatedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_ADDRESS_DELETED') {
            return <CustomerAddressDeletedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_NOTE') {
            return (
                <HistoryNoteEntry {...props} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} />
            );
        } else if (entry.type === 'CUSTOMER_PASSWORD_UPDATED') {
            return <CustomerPasswordUpdatedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_PASSWORD_RESET_REQUESTED') {
            return <CustomerPasswordResetRequestedComponent {...props} />;
        } else if (entry.type === 'CUSTOMER_PASSWORD_RESET_VERIFIED') {
            return <CustomerPasswordResetVerifiedComponent {...props} />;
        } else if (
            entry.type === 'CUSTOMER_EMAIL_UPDATE_REQUESTED' ||
            entry.type === 'CUSTOMER_EMAIL_UPDATE_VERIFIED'
        ) {
            return <CustomerEmailUpdateComponent {...props} />;
        }
        return null;
    };

    return (
        <>
            <HistoryTimelineWithGrouping
                historyEntries={historyEntries}
                isPrimaryEvent={isPrimaryEvent}
                renderEntryContent={renderEntryContent}
                entity={customer}
            >
                <HistoryNoteInput onAddNote={onAddNote} />
            </HistoryTimelineWithGrouping>
            <HistoryNoteEditor
                key={noteState.noteId}
                open={noteEditorOpen}
                onOpenChange={setNoteEditorOpen}
                onNoteChange={handleNoteEditorSave}
                note={noteState.note}
                isPrivate={noteState.isPrivate}
                noteId={noteState.noteId}
            />
        </>
    );
}
