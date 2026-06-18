import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { CustomFieldConfig, Dialog, GetAvailableCountriesQuery } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-address-detail-dialog',
    templateUrl: './address-detail-dialog.component.html',
    styleUrls: ['./address-detail-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddressDetailDialogComponent implements Dialog<UntypedFormGroup>, OnInit {
    addressForm: UntypedFormGroup;
    customFields: CustomFieldConfig;
    availableCountries: GetAvailableCountriesQuery['countries']['items'] = [];
    resolveWith: (result?: UntypedFormGroup) => void;

    constructor(private changeDetector: ChangeDetectorRef) {}

    ngOnInit() {
        this.addressForm.valueChanges.subscribe(() => this.changeDetector.markForCheck());
    }

    cancel() {
        this.resolveWith();
    }

    save() {
        this.resolveWith(this.addressForm);
    }
}
