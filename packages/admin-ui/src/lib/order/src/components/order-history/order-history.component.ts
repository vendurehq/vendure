import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
    HistoryEntryComponentService,
    HistoryEntryType,
    OrderDetailFragment,
    TimelineDisplayType,
    TimelineHistoryEntry,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-order-history',
    templateUrl: './order-history.component.html',
    styleUrls: ['./order-history.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderHistoryComponent {
    @Input() order: OrderDetailFragment;
    @Input() history: TimelineHistoryEntry[];
    @Output() addNote = new EventEmitter<{ note: string; isPublic: boolean }>();
    @Output() updateNote = new EventEmitter<TimelineHistoryEntry>();
    @Output() deleteNote = new EventEmitter<TimelineHistoryEntry>();
    note = '';
    noteIsPrivate = true;
    expanded = false;
    readonly type = HistoryEntryType;

    constructor(private historyEntryComponentService: HistoryEntryComponentService) {}

    hasCustomComponent(type: string): boolean {
        return !!this.historyEntryComponentService.getComponent(type);
    }

    getDisplayType(entry: TimelineHistoryEntry): TimelineDisplayType {
        if (entry.type === HistoryEntryType.ORDER_STATE_TRANSITION) {
            if (entry.data.to === 'Delivered') {
                return 'success';
            }
            if (entry.data.to === 'Cancelled') {
                return 'error';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_FULFILLMENT_TRANSITION) {
            if (entry.data.to === 'Delivered') {
                return 'success';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_PAYMENT_TRANSITION) {
            if (entry.data.to === 'Declined' || entry.data.to === 'Cancelled') {
                return 'error';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_CANCELLATION) {
            return 'warning';
        }
        if (entry.type === HistoryEntryType.ORDER_REFUND_TRANSITION) {
            return 'warning';
        }
        return 'default';
    }

    getTimelineIcon(entry: TimelineHistoryEntry) {
        if (entry.type === HistoryEntryType.ORDER_STATE_TRANSITION) {
            if (entry.data.to === 'Delivered') {
                return ['success-standard', 'is-solid'];
            }
            if (entry.data.to === 'Cancelled') {
                return 'ban';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_PAYMENT_TRANSITION) {
            if (entry.data.to === 'Settled') {
                return 'credit-card';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_REFUND_TRANSITION) {
            if (entry.data.to === 'Settled') {
                return 'credit-card';
            }
        }
        if (entry.type === HistoryEntryType.ORDER_NOTE) {
            return 'note';
        }
        if (entry.type === HistoryEntryType.ORDER_MODIFIED) {
            return 'pencil';
        }
        if (entry.type === HistoryEntryType.ORDER_CUSTOMER_UPDATED) {
            return 'switch';
        }
        if (entry.type === HistoryEntryType.ORDER_FULFILLMENT_TRANSITION) {
            if (entry.data.to === 'Shipped') {
                return 'truck';
            }
            if (entry.data.to === 'Delivered') {
                return 'truck';
            }
        }
    }

    isFeatured(entry: TimelineHistoryEntry): boolean {
        switch (entry.type) {
            case HistoryEntryType.ORDER_STATE_TRANSITION: {
                return (
                    entry.data.to === 'Delivered' ||
                    entry.data.to === 'Cancelled' ||
                    entry.data.to === 'Settled'
                );
            }
            case HistoryEntryType.ORDER_REFUND_TRANSITION:
                return entry.data.to === 'Settled';
            case HistoryEntryType.ORDER_PAYMENT_TRANSITION:
                return entry.data.to === 'Settled' || entry.data.to === 'Cancelled';
            case HistoryEntryType.ORDER_FULFILLMENT_TRANSITION:
                return entry.data.to === 'Delivered' || entry.data.to === 'Shipped';
            case HistoryEntryType.ORDER_NOTE:
            case HistoryEntryType.ORDER_MODIFIED:
            case HistoryEntryType.ORDER_CUSTOMER_UPDATED:
                return true;
            default:
                return false;
        }
    }

    getFulfillment(
        entry: TimelineHistoryEntry,
    ): NonNullable<OrderDetailFragment['fulfillments']>[number] | undefined {
        if (
            (entry.type === HistoryEntryType.ORDER_FULFILLMENT ||
                entry.type === HistoryEntryType.ORDER_FULFILLMENT_TRANSITION) &&
            this.order.fulfillments
        ) {
            return this.order.fulfillments.find(f => f.id == entry.data.fulfillmentId);
        }
    }

    getPayment(
        entry: TimelineHistoryEntry,
    ): NonNullable<OrderDetailFragment['payments']>[number] | undefined {
        if (entry.type === HistoryEntryType.ORDER_PAYMENT_TRANSITION && this.order.payments) {
            return this.order.payments.find(p => p.id === entry.data.paymentId);
        }
    }

    getRefund(
        entry: TimelineHistoryEntry,
    ): NonNullable<OrderDetailFragment['payments']>[number]['refunds'][number] | undefined {
        if (entry.type === HistoryEntryType.ORDER_REFUND_TRANSITION && this.order.payments) {
            const allRefunds = this.order.payments.reduce(
                (refunds, payment) => refunds.concat(payment.refunds),
                [] as NonNullable<OrderDetailFragment['payments']>[number]['refunds'],
            );
            return allRefunds.find(r => r.id === entry.data.refundId);
        }
    }

    getCancelledQuantity(entry: TimelineHistoryEntry): number {
        return entry.data.lines.reduce((total, line) => total + line.quantity, 0);
    }

    getCancelledItems(
        cancellationLines: Array<{ orderLineId: string; quantity: number }>,
    ): Array<{ name: string; quantity: number }> {
        const itemMap = new Map<string, number>();
        for (const line of this.order.lines) {
            const cancellationLine = cancellationLines.find(l => l.orderLineId === line.id);
            if (cancellationLine) {
                itemMap.set(line.productVariant.name, cancellationLine.quantity);
            }
        }
        return Array.from(itemMap.entries()).map(([name, quantity]) => ({ name, quantity }));
    }

    getModification(id: string) {
        return this.order.modifications.find(m => m.id === id);
    }

    getName(entry: TimelineHistoryEntry): string {
        const { administrator } = entry;
        if (administrator) {
            return `${administrator.firstName} ${administrator.lastName}`;
        } else {
            const customer = this.order.customer;
            if (customer) {
                return `${customer.firstName} ${customer.lastName}`;
            }
        }
        return '';
    }

    addNoteToOrder() {
        this.addNote.emit({ note: this.note, isPublic: !this.noteIsPrivate });
        this.note = '';
        this.noteIsPrivate = true;
    }
}
