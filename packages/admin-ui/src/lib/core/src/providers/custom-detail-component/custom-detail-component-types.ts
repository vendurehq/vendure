import { Provider, Type } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { Observable } from 'rxjs';

import { CustomDetailComponentLocationId } from '../../common/component-registry-types';

/**
 * @description
 * CustomDetailComponents allow any arbitrary Angular components to be embedded in entity detail
 * pages of the Admin UI.
 *
 * @docsCategory custom-detail-components
 */
export interface CustomDetailComponent {
    entity$: Observable<any>;
    detailForm: UntypedFormGroup;
}

/**
 * @description
 * Configures a {@link CustomDetailComponent} to be placed in the given location.
 *
 * @docsCategory custom-detail-components
 */
export interface CustomDetailComponentConfig {
    locationId: CustomDetailComponentLocationId;
    component: Type<CustomDetailComponent>;
    providers?: Provider[];
}
