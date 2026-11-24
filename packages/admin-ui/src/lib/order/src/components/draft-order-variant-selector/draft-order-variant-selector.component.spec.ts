import { CustomFieldConfig, DataService } from '@vendure/admin-ui/core';

import { DraftOrderVariantSelectorComponent } from './draft-order-variant-selector.component';

describe('DraftOrderVariantSelectorComponent', () => {
    // #3698 - adding the first item to a draft order failed GraphQL coercion for non-string custom fields
    it('sends null for untouched order line custom fields', () => {
        const component = new DraftOrderVariantSelectorComponent({} as DataService);
        component.orderLineCustomFields = [
            { name: 'giftWrap', type: 'boolean', nullable: true },
            { name: 'engravingCount', type: 'int', nullable: true },
        ] as CustomFieldConfig[];
        component.ngOnInit();

        let emitted: any;
        component.addItem.subscribe((value: any) => (emitted = value));
        component.addItemClick({ id: 'T_1' } as any);

        expect(emitted.customFields).toEqual({ giftWrap: null, engravingCount: null });
    });
});
