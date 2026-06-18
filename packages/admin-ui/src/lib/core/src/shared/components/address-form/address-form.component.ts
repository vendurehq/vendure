import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';

import { CustomFieldConfig, GetAvailableCountriesQuery } from '../../../common/generated-types';

@Component({
    selector: 'vdr-address-form',
    templateUrl: './address-form.component.html',
    styleUrls: ['./address-form.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddressFormComponent {
    @Input() customFields: CustomFieldConfig;
    @Input() formGroup: UntypedFormGroup;
    @Input() availableCountries: Array<GetAvailableCountriesQuery['countries']['items']>;
}
