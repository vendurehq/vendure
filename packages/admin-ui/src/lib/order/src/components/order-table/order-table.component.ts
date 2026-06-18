import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { AdjustmentType, CustomFieldConfig, OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-order-table',
    templateUrl: './order-table.component.html',
    styleUrls: ['./order-table.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderTableComponent implements OnInit {
    @Input() order: OrderDetailFragment;
    @Input() orderLineCustomFields: CustomFieldConfig[];
    @Input() isDraft = false;
    @Output() adjust = new EventEmitter<{ lineId: string; quantity: number }>();
    @Output() remove = new EventEmitter<{ lineId: string }>();
    orderLineCustomFieldsVisible = false;
    customFieldsForLine: {
        [lineId: string]: Array<{ config: CustomFieldConfig; formGroup: UntypedFormGroup; value: any }>;
    } = {};

    get visibleOrderLineCustomFields(): CustomFieldConfig[] {
        return this.orderLineCustomFieldsVisible ? this.orderLineCustomFields : [];
    }

    get showElided(): boolean {
        return !this.orderLineCustomFieldsVisible && 0 < this.orderLineCustomFields.length;
    }

    ngOnInit(): void {
        this.orderLineCustomFieldsVisible = this.orderLineCustomFields.length < 2;
        this.getLineCustomFields();
    }

    draftInputBlur(line: OrderDetailFragment['lines'][number], quantity: number) {
        if (line.quantity !== quantity) {
            this.adjust.emit({ lineId: line.id, quantity });
        }
    }

    toggleOrderLineCustomFields() {
        this.orderLineCustomFieldsVisible = !this.orderLineCustomFieldsVisible;
    }

    getLineDiscounts(line: OrderDetailFragment['lines'][number]) {
        return line.discounts.filter(a => a.type === AdjustmentType.PROMOTION);
    }

    private getLineCustomFields() {
        for (const line of this.order.lines) {
            const formGroup = new UntypedFormGroup({});
            const result = this.orderLineCustomFields
                .map(config => {
                    const value = (line as any).customFields[config.name];
                    formGroup.addControl(config.name, new UntypedFormControl(value));
                    return {
                        config,
                        formGroup,
                        value,
                    };
                })
                .filter(field => (this.orderLineCustomFieldsVisible ? true : field.value != null));
            this.customFieldsForLine[line.id] = result;
        }
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
