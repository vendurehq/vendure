import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CancelOrderInput,
    Dialog,
    getAppConfig,
    I18nService,
    OrderDetailFragment,
    OrderLineInput,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-cancel-order-dialog',
    templateUrl: './cancel-order-dialog.component.html',
    styleUrls: ['./cancel-order-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CancelOrderDialogComponent implements OnInit, Dialog<CancelOrderInput> {
    order: OrderDetailFragment;
    cancelAll = true;
    resolveWith: (result?: CancelOrderInput) => void;
    reason: string;
    lineQuantities: { [lineId: string]: number } = {};
    reasons: string[] = getAppConfig().cancellationReasons ?? [
        _('order.cancel-reason-customer-request'),
        _('order.cancel-reason-not-available'),
    ];

    get selectionCount(): number {
        return Object.values(this.lineQuantities).reduce((sum, n) => sum + n, 0);
    }

    constructor(private i18nService: I18nService) {
        this.reasons = this.reasons.map(r => this.i18nService.translate(r));
    }

    ngOnInit() {
        this.lineQuantities = this.order.lines.reduce(
            (result, line) => ({ ...result, [line.id]: line.quantity }),
            {},
        );
    }

    radioChanged() {
        if (this.cancelAll) {
            for (const line of this.order.lines) {
                this.lineQuantities[line.id] = line.quantity;
            }
        } else {
            for (const line of this.order.lines) {
                this.lineQuantities[line.id] = 0;
            }
        }
    }

    checkIfAllSelected() {
        for (const [lineId, quantity] of Object.entries(this.lineQuantities)) {
            const quantityInOrder = this.order.lines.find(line => line.id === lineId)?.quantity;
            if (quantityInOrder && quantity < quantityInOrder) {
                return;
            }
        }
        // If we got here, all of the selected quantities are equal to the order
        // line quantities, i.e. everything is selected.
        this.cancelAll = true;
    }

    select() {
        this.resolveWith({
            orderId: this.order.id,
            lines: this.getLineInputs(),
            reason: this.reason,
            cancelShipping: this.cancelAll,
        });
    }

    cancel() {
        this.resolveWith();
    }

    private getLineInputs(): OrderLineInput[] | undefined {
        if (this.order.active) {
            return;
        }
        return Object.entries(this.lineQuantities)
            .map(([orderLineId, quantity]) => ({
                orderLineId,
                quantity,
            }))
            .filter(l => 0 < l.quantity);
    }
}
