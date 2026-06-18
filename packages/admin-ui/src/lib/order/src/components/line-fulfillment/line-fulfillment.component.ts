import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { OrderDetailFragment } from '@vendure/admin-ui/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';

export type FulfillmentStatus = 'full' | 'partial' | 'none';
type Fulfillment = NonNullable<OrderDetailFragment['fulfillments']>[number];

@Component({
    selector: 'vdr-line-fulfillment',
    templateUrl: './line-fulfillment.component.html',
    styleUrls: ['./line-fulfillment.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class LineFulfillmentComponent implements OnChanges {
    @Input() line: OrderDetailFragment['lines'][number];
    @Input() allOrderFulfillments: OrderDetailFragment['fulfillments'];
    @Input() orderState: string;
    fulfilledCount = 0;
    fulfillmentStatus: FulfillmentStatus;
    fulfillments: Array<{
        count: number;
        fulfillment: Fulfillment;
    }> = [];

    ngOnChanges(changes: SimpleChanges): void {
        if (this.line) {
            this.fulfilledCount = this.getDeliveredCount(this.line);
            this.fulfillmentStatus = this.getFulfillmentStatus(this.fulfilledCount, this.line.quantity);
            this.fulfillments = this.getFulfillments(this.line);
        }
    }

    /**
     * Returns the number of items in an OrderLine which are fulfilled.
     */
    private getDeliveredCount(line: OrderDetailFragment['lines'][number]): number {
        return (
            line.fulfillmentLines?.reduce((sum, fulfillmentLine) => sum + fulfillmentLine.quantity, 0) ?? 0
        );
    }

    private getFulfillmentStatus(fulfilledCount: number, lineQuantity: number): FulfillmentStatus {
        if (fulfilledCount === lineQuantity) {
            return 'full';
        }
        if (0 < fulfilledCount && fulfilledCount < lineQuantity) {
            return 'partial';
        }
        return 'none';
    }

    private getFulfillments(
        line: OrderDetailFragment['lines'][number],
    ): Array<{ count: number; fulfillment: NonNullable<OrderDetailFragment['fulfillments']>[number] }> {
        return (
            line.fulfillmentLines
                ?.map(fulfillmentLine => {
                    const fulfillment = this.allOrderFulfillments?.find(
                        f => f.id === fulfillmentLine.fulfillmentId,
                    );
                    if (!fulfillment) {
                        return;
                    }
                    return {
                        count: fulfillmentLine.quantity,
                        fulfillment,
                    };
                })
                .filter(notNullOrUndefined) ?? []
        );
    }
}
