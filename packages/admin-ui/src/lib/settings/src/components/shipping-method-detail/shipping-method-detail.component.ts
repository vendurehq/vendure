import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    configurableDefinitionToInstance,
    ConfigurableOperation,
    ConfigurableOperationDefinition,
    CreateShippingMethodInput,
    createUpdatedTranslatable,
    DataService,
    findTranslation,
    GetActiveChannelQuery,
    getConfigArgValue,
    getCustomFieldsDefaults,
    GetShippingMethodDetailDocument,
    GetShippingMethodDetailQuery,
    LanguageCode,
    NotificationService,
    Permission,
    SHIPPING_METHOD_FRAGMENT,
    ShippingMethodFragment,
    TestShippingMethodInput,
    TestShippingMethodResult,
    toConfigurableOperationInput,
    TypedBaseDetailComponent,
    UpdateShippingMethodInput,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { gql } from 'apollo-angular';
import { combineLatest, merge, Observable, of, Subject } from 'rxjs';
import { mergeMap, switchMap, take, takeUntil } from 'rxjs/operators';

import { TestAddress } from '../test-address-form/test-address-form.component';
import { TestOrderLine } from '../test-order-builder/test-order-builder.component';

export const GET_SHIPPING_METHOD_DETAIL = gql`
    query GetShippingMethodDetail($id: ID!) {
        shippingMethod(id: $id) {
            ...ShippingMethod
        }
    }
    ${SHIPPING_METHOD_FRAGMENT}
`;

@Component({
    selector: 'vdr-shipping-method-detail',
    templateUrl: './shipping-method-detail.component.html',
    styleUrls: ['./shipping-method-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ShippingMethodDetailComponent
    extends TypedBaseDetailComponent<typeof GetShippingMethodDetailDocument, 'shippingMethod'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('ShippingMethod');
    detailForm = this.formBuilder.group({
        code: ['', Validators.required],
        name: ['', Validators.required],
        description: '',
        fulfillmentHandler: ['', Validators.required],
        checker: {} as NonNullable<GetShippingMethodDetailQuery['shippingMethod']>['checker'],
        calculator: {} as NonNullable<GetShippingMethodDetailQuery['shippingMethod']>['calculator'],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    checkers: ConfigurableOperationDefinition[] = [];
    calculators: ConfigurableOperationDefinition[] = [];
    fulfillmentHandlers: ConfigurableOperationDefinition[] = [];
    selectedChecker?: ConfigurableOperation | null;
    selectedCheckerDefinition?: ConfigurableOperationDefinition;
    selectedCalculator?: ConfigurableOperation | null;
    selectedCalculatorDefinition?: ConfigurableOperationDefinition;
    activeChannel$: Observable<GetActiveChannelQuery['activeChannel']>;
    testAddress: TestAddress;
    testOrderLines: TestOrderLine[];
    testDataUpdated = false;
    testResult$: Observable<TestShippingMethodResult | undefined>;
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateShippingMethod];
    private fetchTestResult$ = new Subject<[TestAddress, TestOrderLine[]]>();

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
        this.dataService.shippingMethod.getShippingMethodOperations().single$.subscribe(data => {
            this.checkers = data.shippingEligibilityCheckers;
            this.calculators = data.shippingCalculators;
            this.fulfillmentHandlers = data.fulfillmentHandlers;
            this.changeDetector.markForCheck();
            this.selectedCheckerDefinition = data.shippingEligibilityCheckers.find(
                c => c.code === this.entity?.checker?.code,
            );
            this.selectedCalculatorDefinition = data.shippingCalculators.find(
                c => c.code === this.entity?.calculator?.code,
            );
        });

        this.activeChannel$ = this.dataService.settings
            .getActiveChannel()
            .mapStream(data => data.activeChannel);

        this.testResult$ = this.fetchTestResult$.pipe(
            switchMap(([address, lines]) => {
                const { checker, calculator } = this.detailForm.value;
                if (!this.selectedChecker || !this.selectedCalculator || !checker || !calculator) {
                    return of(undefined);
                }
                const input: TestShippingMethodInput = {
                    shippingAddress: { ...address, streetLine1: 'test' },
                    lines: lines.map(l => ({ productVariantId: l.id, quantity: l.quantity })),
                    checker: toConfigurableOperationInput(this.selectedChecker, checker),
                    calculator: toConfigurableOperationInput(this.selectedCalculator, calculator),
                };
                return this.dataService.shippingMethod
                    .testShippingMethod(input)
                    .mapSingle(result => result.testShippingMethod);
            }),
        );

        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        merge(
            this.detailForm.get(['checker'])!.valueChanges,
            this.detailForm.get(['calculator'])!.valueChanges,
        )
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => (this.testDataUpdated = true));
        /* eslint-enable @typescript-eslint/no-non-null-assertion */
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    updateCode(currentCode: string | undefined, nameValue: string) {
        if (!currentCode) {
            const codeControl = this.detailForm.get(['code']);
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

    selectCalculator(calculator: ConfigurableOperationDefinition) {
        this.selectedCalculatorDefinition = calculator;
        this.selectedCalculator = configurableDefinitionToInstance(calculator);
        const formControl = this.detailForm.get('calculator');
        if (formControl) {
            formControl.clearValidators();
            formControl.updateValueAndValidity({ onlySelf: true });
            formControl.patchValue(this.selectedCalculator);
        }
        this.detailForm.markAsDirty();
    }

    create() {
        const selectedChecker = this.selectedChecker;
        const selectedCalculator = this.selectedCalculator;
        const { checker, calculator } = this.detailForm.value;
        if (!selectedChecker || !selectedCalculator || !checker || !calculator) {
            return;
        }
        const input = {
            ...(this.getUpdatedShippingMethod(
                {
                    createdAt: '',
                    updatedAt: '',
                    id: '',
                    code: '',
                    name: '',
                    description: '',
                    fulfillmentHandlerCode: '',
                    checker: undefined as any,
                    calculator: undefined as any,
                    translations: [],
                },
                this.detailForm,
                this.languageCode,
            ) as CreateShippingMethodInput),
            checker: toConfigurableOperationInput(selectedChecker, checker),
            calculator: toConfigurableOperationInput(selectedCalculator, calculator),
        };
        this.dataService.shippingMethod.createShippingMethod(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'ShippingMethod',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createShippingMethod.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'ShippingMethod',
                });
            },
        );
    }

    save() {
        const selectedChecker = this.selectedChecker;
        const selectedCalculator = this.selectedCalculator;
        const { checker, calculator } = this.detailForm.value;
        if (!selectedChecker || !selectedCalculator || !checker || !calculator) {
            return;
        }
        combineLatest([this.entity$, this.languageCode$])
            .pipe(
                take(1),
                mergeMap(([shippingMethod, languageCode]) => {
                    const input = {
                        ...(this.getUpdatedShippingMethod(
                            shippingMethod,
                            this.detailForm,
                            languageCode,
                        ) as UpdateShippingMethodInput),
                        checker: toConfigurableOperationInput(selectedChecker, checker),
                        calculator: toConfigurableOperationInput(selectedCalculator, calculator),
                    };
                    return this.dataService.shippingMethod.updateShippingMethod(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'ShippingMethod',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    // eslint-disable-next-line no-console
                    console.error(err);
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'ShippingMethod',
                    });
                },
            );
    }

    setTestOrderLines(event: TestOrderLine[]) {
        this.testOrderLines = event;
        this.testDataUpdated = true;
    }

    setTestAddress(event: TestAddress) {
        this.testAddress = event;
        this.testDataUpdated = true;
    }

    allTestDataPresent(): boolean {
        return !!(
            this.testAddress &&
            this.testOrderLines &&
            this.testOrderLines.length &&
            this.selectedChecker &&
            this.selectedCalculator
        );
    }

    runTest() {
        this.fetchTestResult$.next([this.testAddress, this.testOrderLines]);
        this.testDataUpdated = false;
    }

    /**
     * Given a ShippingMethod and the value of the detailForm, this method creates an updated copy which
     * can then be persisted to the API.
     */
    private getUpdatedShippingMethod(
        shippingMethod: NonNullable<GetShippingMethodDetailQuery['shippingMethod']>,
        formGroup: typeof this.detailForm,
        languageCode: LanguageCode,
    ): Omit<CreateShippingMethodInput | UpdateShippingMethodInput, 'checker' | 'calculator'> {
        const formValue = formGroup.value;
        const input = createUpdatedTranslatable({
            translatable: shippingMethod,
            updatedFields: formValue,
            customFieldConfig: this.customFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: shippingMethod.name || '',
                description: shippingMethod.description || '',
            },
        });
        return { ...input, fulfillmentHandler: formValue.fulfillmentHandler };
    }

    protected setFormValues(shippingMethod: ShippingMethodFragment, languageCode: LanguageCode): void {
        const currentTranslation = findTranslation(shippingMethod, languageCode);
        this.detailForm.patchValue({
            name: currentTranslation?.name ?? '',
            description: currentTranslation?.description ?? '',
            code: shippingMethod.code,
            fulfillmentHandler: shippingMethod.fulfillmentHandlerCode,
            checker: shippingMethod.checker || {},
            calculator: shippingMethod.calculator || {},
        });
        if (!this.selectedChecker) {
            this.selectedChecker = shippingMethod.checker && {
                code: shippingMethod.checker.code,
                args: shippingMethod.checker.args.map(a => ({ ...a, value: getConfigArgValue(a.value) })),
            };
        }
        if (!this.selectedCalculator) {
            this.selectedCalculator = shippingMethod.calculator && {
                code: shippingMethod.calculator?.code,
                args: shippingMethod.calculator?.args.map(a => ({ ...a, value: getConfigArgValue(a.value) })),
            };
        }
        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get(['customFields']),
                shippingMethod,
                currentTranslation,
            );
        }
    }
}
