import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    OnChanges,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { CustomFieldConfig, GetAvailableCountriesQuery, ModalService } from '@vendure/admin-ui/core';
import { BehaviorSubject } from 'rxjs';
import { filter, take } from 'rxjs/operators';

import { AddressDetailDialogComponent } from '../address-detail-dialog/address-detail-dialog.component';

@Component({
    selector: 'vdr-address-card',
    templateUrl: './address-card.component.html',
    styleUrls: ['./address-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddressCardComponent implements OnInit, OnChanges {
    @Input() addressForm: UntypedFormGroup;
    @Input() customFields: CustomFieldConfig;
    @Input() availableCountries: GetAvailableCountriesQuery['countries']['items'] = [];
    @Input() isDefaultBilling: string;
    @Input() isDefaultShipping: string;
    @Input() editable = true;
    @Output() setAsDefaultShipping = new EventEmitter<string>();
    @Output() setAsDefaultBilling = new EventEmitter<string>();
    @Output() deleteAddress = new EventEmitter<string>();
    private dataDependenciesPopulated = new BehaviorSubject<boolean>(false);

    constructor(
        private modalService: ModalService,
        private changeDetector: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        const streetLine1 = this.addressForm.get('streetLine1') as UntypedFormControl;
        // Make the address dialog display automatically if there is no address line
        // as is the case when adding a new address.
        if (!streetLine1.value) {
            this.dataDependenciesPopulated
                .pipe(
                    filter(value => value),
                    take(1),
                )
                .subscribe(() => {
                    this.editAddress();
                });
        }
    }

    ngOnChanges(changes: SimpleChanges) {
        if (this.customFields != null && this.availableCountries != null) {
            this.dataDependenciesPopulated.next(true);
        }
    }

    getCountryName(countryCode: string) {
        if (!this.availableCountries) {
            return '';
        }
        const match = this.availableCountries.find(c => c.code === countryCode);
        return match ? match.name : '';
    }

    setAsDefaultBillingAddress() {
        this.setAsDefaultBilling.emit(this.addressForm.value.id);
        this.addressForm.markAsDirty();
    }

    setAsDefaultShippingAddress() {
        this.setAsDefaultShipping.emit(this.addressForm.value.id);
        this.addressForm.markAsDirty();
    }

    delete() {
        this.deleteAddress.emit(this.addressForm.value.id);
        this.addressForm.markAsDirty();
    }

    editAddress() {
        this.modalService
            .fromComponent(AddressDetailDialogComponent, {
                locals: {
                    addressForm: this.addressForm,
                    customFields: this.customFields,
                    availableCountries: this.availableCountries,
                },
                size: 'md',
                closable: true,
            })
            .subscribe(() => {
                this.changeDetector.markForCheck();
            });
    }
}
