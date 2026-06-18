import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit } from '@angular/core';
import { OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-modification-detail',
    templateUrl: './modification-detail.component.html',
    styleUrls: ['./modification-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ModificationDetailComponent implements OnChanges {
    @Input() order: OrderDetailFragment;
    @Input() modification: OrderDetailFragment['modifications'][number];
    private addedItems = new Map<OrderDetailFragment['lines'][number], number>();
    private removedItems = new Map<OrderDetailFragment['lines'][number], number>();
    private modifiedItems = new Set<OrderDetailFragment['lines'][number]>();

    ngOnChanges(): void {
        const { added, removed, modified } = this.getModifiedLines();
        this.addedItems = added;
        this.removedItems = removed;
        this.modifiedItems = modified;
    }

    getSurcharge(id: string) {
        return this.order.surcharges.find(m => m.id === id);
    }

    getAddedItems() {
        return [...this.addedItems.entries()].map(([line, count]) => ({
            name: line.productVariant.name,
            quantity: count,
        }));
    }

    getRemovedItems() {
        return [...this.removedItems.entries()].map(([line, count]) => ({
            name: line.productVariant.name,
            quantity: count,
        }));
    }

    getModifiedItems() {
        return [...this.modifiedItems].map(line => ({
            name: line.productVariant.name,
        }));
    }

    private getModifiedLines() {
        const added = new Map<OrderDetailFragment['lines'][number], number>();
        const removed = new Map<OrderDetailFragment['lines'][number], number>();
        const modified = new Set<OrderDetailFragment['lines'][number]>();
        for (const modificationLine of this.modification.lines || []) {
            const line = this.order.lines.find(l => l.id === modificationLine.orderLineId);
            if (!line) {
                continue;
            }
            if (modificationLine.quantity === 0) {
                modified.add(line);
            } else if (modificationLine.quantity < 0) {
                removed.set(line, -modificationLine.quantity);
            } else {
                added.set(line, modificationLine.quantity);
            }
        }
        return { added, removed, modified };
    }
}
