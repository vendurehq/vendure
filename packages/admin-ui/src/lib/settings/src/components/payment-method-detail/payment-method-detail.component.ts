import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    configurableDefinitionToInstance,
    ConfigurableOperation,
    ConfigurableOperationDefinition,
    CreatePaymentMethodInput,
    createUpdatedTranslatable,
    DataService,
    findTranslation,
    getConfigArgValue,
    getCustomFieldsDefaults,
    GetPaymentMethodDetailDocument,
    GetPaymentMethodDetailQuery,
    LanguageCode,
    NotificationService,
    PAYMENT_METHOD_FRAGMENT,
    PaymentMethodFragment,
    Permission,
    toConfigurableOperationInput,
    TypedBaseDetailComponent,
    UpdatePaymentMethodInput,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { gql } from 'apollo-angular';
import { combineLatest } from 'rxjs';
import { mergeMap, take } from 'rxjs/operators';

export const GET_PAYMENT_METHOD_DETAIL = gql`
    query GetPaymentMethodDetail($id: ID!) {
        paymentMethod(id: $id) {
            ...PaymentMethod
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;

@Component({
    selector: 'vdr-payment-method-detail',
    templateUrl: './payment-method-detail.component.html',
    styleUrls: ['./payment-method-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PaymentMethodDetailComponent
    extends TypedBaseDetailComponent<typeof GetPaymentMethodDetailDocument, 'paymentMethod'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('PaymentMethod');
    detailForm = this.formBuilder.group({
        code: ['', Validators.required],
        name: ['', Validators.required],
        description: '',
        enabled: [true, Validators.required],
        checker: {} as NonNullable<GetPaymentMethodDetailQuery['paymentMethod']>['checker'],
        handler: {} as NonNullable<GetPaymentMethodDetailQuery['paymentMethod']>['handler'],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    checkers: ConfigurableOperationDefinition[] = [];
    handlers: ConfigurableOperationDefinition[] = [];
    selectedChecker?: ConfigurableOperation | null;
    selectedCheckerDefinition?: ConfigurableOperationDefinition;
    selectedHandler?: ConfigurableOperation | null;
    selectedHandlerDefinition?: ConfigurableOperationDefinition;
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdatePaymentMethod];

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        this.dataService.settings.getPaymentMethodOperations().single$.subscribe(data => {
            this.checkers = data.paymentMethodEligibilityCheckers;
            this.handlers = data.paymentMethodHandlers;
            this.changeDetector.markForCheck();
            this.selectedCheckerDefinition = data.paymentMethodEligibilityCheckers.find(
                c => c.code === this.entity?.checker?.code,
            );
            this.selectedHandlerDefinition = data.paymentMethodHandlers.find(
                c => c.code === this.entity?.handler?.code,
            );
        });
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    updateCode(currentCode: string | undefined, nameValue: string) {
        if (!currentCode) {
            const codeControl = this.detailForm.get('code');
            if (codeControl && codeControl.pristine) {
                codeControl.setValue(normalizeString(nameValue, '-'));
            }
        }
    }

    selectChecker(checker: ConfigurableOperationDefinition) {
        this.selectedCheckerDefinition = checker;
        this.selectedChecker = configurableDefinitionToInstance(checker);
        const formControl = this.detailForm.get('checker');
        if (formControl) {
            formControl.clearValidators();
            formControl.updateValueAndValidity({ onlySelf: true });
            formControl.patchValue(this.selectedChecker);
        }
        this.detailForm.markAsDirty();
    }

    selectHandler(handler: ConfigurableOperationDefinition) {
        this.selectedHandlerDefinition = handler;
        this.selectedHandler = configurableDefinitionToInstance(handler);
        const formControl = this.detailForm.get('handler');
        if (formControl) {
            formControl.clearValidators();
            formControl.updateValueAndValidity({ onlySelf: true });
            formControl.patchValue(this.selectedHandler);
        }
        this.detailForm.markAsDirty();
    }

    removeChecker() {
        this.selectedChecker = null;
        this.detailForm.markAsDirty();
    }

    removeHandler() {
        this.selectedHandler = null;
        this.detailForm.markAsDirty();
    }

    create() {
        const selectedChecker = this.selectedChecker;
        const selectedHandler = this.selectedHandler;
        if (!selectedHandler) {
            return;
        }
        const input = this.getUpdatedPaymentMethod(
            {
                id: '',
                createdAt: '',
                updatedAt: '',
                name: '',
                code: '',
                description: '',
                enabled: true,
                checker: undefined as any,
                handler: undefined as any,
                translations: [],
            },
            this.detailForm,
            this.languageCode,
            selectedHandler,
            selectedChecker,
        ) as CreatePaymentMethodInput;
        this.dataService.settings.createPaymentMethod(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'PaymentMethod',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createPaymentMethod.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'PaymentMethod',
                });
            },
        );
    }

    save() {
        const selectedChecker = this.selectedChecker;
        const selectedHandler = this.selectedHandler;
        if (!selectedHandler) {
            return;
        }
        combineLatest(this.entity$, this.languageCode$)
            .pipe(
                take(1),
                mergeMap(([paymentMethod, languageCode]) => {
                    const input = this.getUpdatedPaymentMethod(
                        paymentMethod,
                        this.detailForm,
                        languageCode,
                        selectedHandler,
                        selectedChecker,
                    ) as UpdatePaymentMethodInput;
                    return this.dataService.settings.updatePaymentMethod(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'PaymentMethod',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'PaymentMethod',
                    });
                },
            );
    }

    /**
     * Given a PaymentMethod and the value of the detailForm, this method creates an updated copy of it which
     * can then be persisted to the API.
     */
    private getUpdatedPaymentMethod(
        paymentMethod: PaymentMethodFragment,
        formGroup: UntypedFormGroup,
        languageCode: LanguageCode,
        selectedHandler: ConfigurableOperation,
        selectedChecker?: ConfigurableOperation | null,
    ): UpdatePaymentMethodInput | CreatePaymentMethodInput {
        const input = createUpdatedTranslatable({
            translatable: paymentMethod,
            updatedFields: formGroup.value,
            customFieldConfig: this.customFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: paymentMethod.name || '',
                description: paymentMethod.description || '',
            },
        });
        return {
            ...input,
            checker: selectedChecker
                ? toConfigurableOperationInput(selectedChecker, formGroup.value.checker)
                : null,
            handler: toConfigurableOperationInput(selectedHandler, formGroup.value.handler),
        };
    }

    protected setFormValues(
        paymentMethod: NonNullable<GetPaymentMethodDetailQuery['paymentMethod']>,
        languageCode: LanguageCode,
    ): void {
        const currentTranslation = findTranslation(paymentMethod, languageCode);
        this.detailForm.patchValue({
            name: currentTranslation?.name,
            code: paymentMethod.code,
            description: currentTranslation?.description,
            enabled: paymentMethod.enabled,
            checker: paymentMethod.checker || ({} as any),
            handler: paymentMethod.handler || ({} as any),
        });
        if (!this.selectedChecker) {
            this.selectedChecker = paymentMethod.checker && {
                code: paymentMethod.checker.code,
                args: paymentMethod.checker.args.map(a => ({ ...a, value: getConfigArgValue(a.value) })),
            };
        }
        if (!this.selectedHandler) {
            this.selectedHandler = paymentMethod.handler && {
                code: paymentMethod.handler.code,
                args: paymentMethod.handler.args.map(a => ({ ...a, value: getConfigArgValue(a.value) })),
            };
        }
        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get('customFields'),
                paymentMethod,
                currentTranslation,
            );
        }
    }
}
