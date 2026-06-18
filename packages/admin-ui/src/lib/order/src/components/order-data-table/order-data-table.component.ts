import { ChangeDetectionStrategy, Component, ContentChildren, Input, QueryList } from '@angular/core';
import { DataTable2Component, OrderDetailFragment } from '@vendure/admin-ui/core';
import { OrderTotalColumnComponent } from './order-total-column.component';

@Component({
    selector: 'vdr-order-data-table',
    templateUrl: './order-data-table.component.html',
    styleUrls: [
        '../../../../core/src/shared/components/data-table-2/data-table2.component.scss',
        './order-data-table.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderDataTableComponent extends DataTable2Component<OrderDetailFragment> {
    @ContentChildren(OrderTotalColumnComponent) totalColumns: QueryList<OrderTotalColumnComponent<any>>;
    @Input() order: OrderDetailFragment;

    get allColumns() {
        return [...(this.columns ?? []), ...(this.customFieldColumns ?? []), ...(this.totalColumns ?? [])];
    }

    getPromotionLink(promotion: OrderDetailFragment['discounts'][number]): any[] {
        const id = promotion.adjustmentSource.split(':')[1];
        return ['/marketing', 'promotions', id];
    }

    getCouponCodeForAdjustment(
        order: OrderDetailFragment,
        promotionAdjustment: OrderDetailFragment['discounts'][number],
    ): string | undefined {
        const id = promotionAdjustment.adjustmentSource.split(':')[1];
        const promotion = order.promotions.find(p => p.id === id);
        if (promotion) {
            return promotion.couponCode || undefined;
        }
    }

    getShippingNames(order: OrderDetailFragment) {
        if (order.shippingLines.length) {
            return order.shippingLines.map(shippingLine => shippingLine.shippingMethod.name).join(', ');
        } else {
            return '';
        }
    }
}
