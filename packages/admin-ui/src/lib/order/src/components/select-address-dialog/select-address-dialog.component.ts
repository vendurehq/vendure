import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import {
    AddressFragment,
    CreateAddressInput,
    DataService,
    Dialog,
    GetAvailableCountriesQuery,
    GetCustomerAddressesDocument,
    OrderAddressFragment,
} from '@vendure/admin-ui/core';
import { pick } from '@vendure/common/lib/pick';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

import { Customer } from '../select-customer-dialog/select-customer-dialog.component';

@Component({
    selector: 'vdr-select-address-dialog',
    templateUrl: './select-address-dialog.component.html',
    styleUrls: ['./select-address-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SelectAddressDialogComponent implements OnInit, Dialog<CreateAddressInput> {
    resolveWith: (result?: CreateAddressInput) => void;
    availableCountries$: Observable<GetAvailableCountriesQuery['countries']['items']>;
    addresses$: Observable<AddressFragment[]>;
    customerId: string | undefined;
    currentAddress: OrderAddressFragment | undefined;
    addressForm: UntypedFormGroup;
    selectedAddress: AddressFragment | undefined;
    useExisting = true;
    createNew = false;

    constructor(private dataService: DataService, private formBuilder: UntypedFormBuilder) {}

    ngOnInit(): void {
        this.addressForm = this.formBuilder.group({
            fullName: [this.currentAddress?.fullName ?? ''],
            company: [this.currentAddress?.company ?? ''],
            streetLine1: [this.currentAddress?.streetLine1 ?? '', Validators.required],
            streetLine2: [this.currentAddress?.streetLine2 ?? ''],
            city: [this.currentAddress?.city ?? '', Validators.required],
            province: [this.currentAddress?.province ?? ''],
            postalCode: [this.currentAddress?.postalCode ?? '', Validators.required],
            countryCode: [this.currentAddress?.countryCode ?? '', Validators.required],
            phoneNumber: [this.currentAddress?.phoneNumber ?? ''],
        });
        this.useExisting = !!this.customerId;
        this.addresses$ = this.customerId
            ? this.dataService
                  .query(GetCustomerAddressesDocument, { customerId: this.customerId })
                  .mapSingle(({ customer }) => customer?.addresses ?? [])
                  .pipe(
                      tap(addresses => {
                          if (this.currentAddress) {
                              this.selectedAddress = addresses.find(
                                  a =>
                                      a.streetLine1 === this.currentAddress?.streetLine1 &&
                                      a.postalCode === this.currentAddress?.postalCode,
                              );
                          }
                          if (addresses.length === 0) {
                              this.createNew = true;
                              this.useExisting = false;
                          }
                      }),
                  )
            : of([]);
        this.availableCountries$ = this.dataService.settings
            .getAvailableCountries()
            .mapSingle(({ countries }) => countries.items);
    }

    trackByFn(item: Customer) {
        return item.id;
    }

    addressIdFn(item: AddressFragment) {
        return item.streetLine1 + item.postalCode;
    }

    cancel() {
        this.resolveWith();
    }

    select() {
        if (this.useExisting && this.selectedAddress) {
            this.resolveWith({
                ...pick(this.selectedAddress, [
                    'fullName',
                    'company',
                    'streetLine1',
                    'streetLine2',
                    'city',
                    'province',
                    'phoneNumber',
                    'postalCode',
                ]),
                countryCode: this.selectedAddress.country.code,
            });
        }
        if (this.createNew && this.addressForm.valid) {
            const formValue = this.addressForm.value;
            this.resolveWith(formValue);
        }
    }
}
