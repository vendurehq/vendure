import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { CustomFieldConfig, OrderDetailFragment, ServerConfigService } from '@vendure/admin-ui/core';
import { isObject } from '@vendure/common/lib/shared-utils';

@Component({
    selector: 'vdr-fulfillment-detail',
    templateUrl: './fulfillment-detail.component.html',
    styleUrls: ['./fulfillment-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FulfillmentDetailComponent implements OnInit, OnChanges {
    @Input() fulfillmentId: string;
    @Input() order: OrderDetailFragment;

    customFieldConfig: CustomFieldConfig[] = [];
    customFieldFormGroup = new UntypedFormGroup({});

    constructor(private serverConfigService: ServerConfigService) {}

    ngOnInit() {
        this.customFieldConfig = this.serverConfigService.getCustomFieldsFor('Fulfillment');
    }

    ngOnChanges(changes: SimpleChanges) {
        this.buildCustomFieldsFormGroup();
    }

    get fulfillment(): NonNullable<OrderDetailFragment['fulfillments']>[number] | undefined | null {
        return this.order.fulfillments && this.order.fulfillments.find(f => f.id === this.fulfillmentId);
    }

    get items(): Array<{ name: string; quantity: number }> {
        return (
            this.fulfillment?.lines.map(row => ({
                name: this.order.lines.find(line => line.id === row.orderLineId)?.productVariant.name ?? '',
                quantity: row.quantity,
            })) ?? []
        );
    }

    buildCustomFieldsFormGroup() {
        const customFields = (this.fulfillment as any).customFields;
        for (const fieldDef of this.serverConfigService.getCustomFieldsFor('Fulfillment')) {
            this.customFieldFormGroup.addControl(
                fieldDef.name,
                new UntypedFormControl(customFields[fieldDef.name]),
            );
        }
    }

    customFieldIsObject(customField: unknown) {
        return Array.isArray(customField) || isObject(customField);
    }
}
