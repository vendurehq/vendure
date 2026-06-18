import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
    CustomerFragment,
    GetCustomerHistoryQuery,
    HistoryEntryComponentService,
    HistoryEntryType,
    TimelineDisplayType,
    TimelineHistoryEntry,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-customer-history',
    templateUrl: './customer-history.component.html',
    styleUrls: ['./customer-history.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerHistoryComponent {
    @Input() customer: CustomerFragment;
    @Input() history: TimelineHistoryEntry[];
    @Output() addNote = new EventEmitter<{ note: string }>();
    @Output() updateNote = new EventEmitter<TimelineHistoryEntry>();
    @Output() deleteNote = new EventEmitter<TimelineHistoryEntry>();
    note = '';
    expanded = false;
    readonly type = HistoryEntryType;

    constructor(private historyEntryComponentService: HistoryEntryComponentService) {}

    hasCustomComponent(type: string): boolean {
        return !!this.historyEntryComponentService.getComponent(type);
    }

    getDisplayType(entry: TimelineHistoryEntry): TimelineDisplayType {
        switch (entry.type) {
            case HistoryEntryType.CUSTOMER_VERIFIED:
            case HistoryEntryType.CUSTOMER_EMAIL_UPDATE_VERIFIED:
            case HistoryEntryType.CUSTOMER_PASSWORD_RESET_VERIFIED:
                return 'success';
            case HistoryEntryType.CUSTOMER_REGISTERED:
                return 'muted';
            case HistoryEntryType.CUSTOMER_REMOVED_FROM_GROUP:
                return 'error';
            default:
                return 'default';
        }
    }

    getTimelineIcon(entry: TimelineHistoryEntry): string | [string, string] | undefined {
        switch (entry.type) {
            case HistoryEntryType.CUSTOMER_REGISTERED:
                return 'user';
            case HistoryEntryType.CUSTOMER_VERIFIED:
                return ['assign-user', 'is-solid'];
            case HistoryEntryType.CUSTOMER_NOTE:
                return 'note';
            case HistoryEntryType.CUSTOMER_ADDED_TO_GROUP:
            case HistoryEntryType.CUSTOMER_REMOVED_FROM_GROUP:
                return 'users';
        }
    }

    isFeatured(entry: TimelineHistoryEntry): boolean {
        switch (entry.type) {
            case HistoryEntryType.CUSTOMER_REGISTERED:
            case HistoryEntryType.CUSTOMER_VERIFIED:
                return true;
            default:
                return false;
        }
    }

    getName(entry: TimelineHistoryEntry): string {
        const { administrator } = entry;
        if (administrator) {
            return `${administrator.firstName} ${administrator.lastName}`;
        } else {
            return `${this.customer.firstName} ${this.customer.lastName}`;
        }
    }

    addNoteToCustomer() {
        this.addNote.emit({ note: this.note });
        this.note = '';
    }
}
