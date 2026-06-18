import { Injectable } from '@angular/core';

import { FormInputComponent } from '../../common/component-registry-types';
import { CustomFields, CustomFieldsFragment } from '../../common/generated-types';
import { ComponentRegistryService } from '../component-registry/component-registry.service';

export type CustomFieldConfigType = CustomFieldsFragment;

export interface CustomFieldControl extends FormInputComponent<CustomFieldConfigType> {}

export type CustomFieldEntityName = Exclude<keyof CustomFields, '__typename'>;

/**
 * This service allows the registration of custom controls for customFields.
 *
 * @deprecated The ComponentRegistryService now handles custom field components directly.
 */
@Injectable({
    providedIn: 'root',
})
export class CustomFieldComponentService {
    constructor(private componentRegistryService: ComponentRegistryService) {}

    /**
     * Checks whether a custom component is registered for the given entity custom field,
     * and if so returns the ID of that component.
     */
    customFieldComponentExists(entity: CustomFieldEntityName, fieldName: string): string | undefined {
        const id = this.generateId(entity, fieldName, true);
        return this.componentRegistryService.getInputComponent(id) ? id : undefined;
    }

    private generateId(entity: CustomFieldEntityName, fieldName: string, isCustomField: boolean) {
        let id = entity;
        if (isCustomField) {
            id += '-customFields';
        }
        id += '-' + fieldName;
        return id;
    }
}
