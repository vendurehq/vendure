import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import {
    CurrencyCode,
    DataService,
    Dialog,
    GetAddManualPaymentMethodListDocument,
    GetAddManualPaymentMethodListQuery,
    GetPaymentMethodListQuery,
    ItemOf,
    ManualPaymentInput,
    PAYMENT_METHOD_FRAGMENT,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';

const GET_PAYMENT_METHODS_FOR_MANUAL_ADD = gql`
    query GetAddManualPaymentMethodList($options: PaymentMethodListOptions!) {
        paymentMethods(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                code
                description
                enabled
            }
            totalItems
        }
    }
`;

@Component({
    selector: 'vdr-add-manual-payment-dialog',
    templateUrl: './add-manual-payment-dialog.component.html',
    styleUrls: ['./add-manual-payment-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddManualPaymentDialogComponent implements OnInit, Dialog<Omit<ManualPaymentInput, 'orderId'>> {
    // populated by ModalService call
    outstandingAmount: number;
    currencyCode: CurrencyCode;

    resolveWith: (result?: Omit<ManualPaymentInput, 'orderId'>) => void;
    form = new UntypedFormGroup({
        method: new UntypedFormControl('', Validators.required),
        transactionId: new UntypedFormControl('', Validators.required),
    });
    paymentMethods$: Observable<Array<ItemOf<GetAddManualPaymentMethodListQuery, 'paymentMethods'>>>;
    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.paymentMethods$ = this.dataService
            .query(GetAddManualPaymentMethodListDocument, {
                options: {
                    take: 999,
                },
            })
            .mapSingle(data => data.paymentMethods.items);
    }

    submit() {
        const formValue = this.form.value;
        this.resolveWith({
            method: formValue.method,
            transactionId: formValue.transactionId,
        });
    }

    cancel() {
        this.resolveWith();
    }
}
