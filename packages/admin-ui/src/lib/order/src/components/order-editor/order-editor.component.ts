import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import {
    FormControl,
    FormGroup,
    UntypedFormArray,
    UntypedFormControl,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import {
    CustomFieldConfig,
    DataService,
    DraftOrderEligibleShippingMethodsQuery,
    ErrorResult,
    GetAvailableCountriesQuery,
    HistoryEntryType,
    LanguageCode,
    ModalService,
    ModifyOrderInput,
    NotificationService,
    OrderAddressFragment,
    OrderDetailFragment,
    OrderDetailQueryDocument,
    SortOrder,
    SurchargeInput,
    transformRelationCustomFieldInputs,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { assertNever, notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { simpleDeepClone } from '@vendure/common/lib/simple-deep-clone';
import { EMPTY, Observable, of } from 'rxjs';
import { map, mapTo, shareReplay, switchMap, take, takeUntil } from 'rxjs/operators';
import {
    AddedLine,
    ModifyOrderData,
    OrderSnapshot,
    ProductSelectorItem,
} from '../../common/modify-order-types';

import { OrderTransitionService } from '../../providers/order-transition.service';
import {
    OrderEditResultType,
    OrderEditsPreviewDialogComponent,
} from '../order-edits-preview-dialog/order-edits-preview-dialog.component';
import { SelectShippingMethodDialogComponent } from '../select-shipping-method-dialog/select-shipping-method-dialog.component';

@Component({
    selector: 'vdr-order-editor',
    templateUrl: './order-editor.component.html',
    styleUrls: ['./order-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderEditorComponent
    extends TypedBaseDetailComponent<typeof OrderDetailQueryDocument, 'order'>
    implements OnInit, OnDestroy
{
    availableCountries$: Observable<GetAvailableCountriesQuery['countries']['items']>;
    addressCustomFields: CustomFieldConfig[];
    uiLanguage$: Observable<LanguageCode>;
    detailForm = new UntypedFormGroup({});
    couponCodesControl = new FormControl<string[]>([]);
    orderLineCustomFieldsFormArray: UntypedFormArray;
    addItemCustomFieldsFormArray: UntypedFormArray;
    addItemCustomFieldsForm: UntypedFormGroup;
    addItemSelectedVariant: ProductSelectorItem | undefined;
    orderLineCustomFields: CustomFieldConfig[];
    orderSnapshot: OrderSnapshot;
    modifyOrderInput: ModifyOrderData = {
        dryRun: true,
        orderId: '',
        addItems: [],
        adjustOrderLines: [],
        surcharges: [],
        note: '',
        refunds: [],
        updateShippingAddress: {},
        updateBillingAddress: {},
    };
    surchargeForm = new FormGroup({
        description: new FormControl('', Validators.minLength(1)),
        sku: new FormControl(''),
        price: new FormControl(0),
        priceIncludesTax: new FormControl(true),
        taxRate: new FormControl(0),
        taxDescription: new FormControl(''),
    });
    shippingAddressForm = new FormGroup({
        fullName: new FormControl(''),
        company: new FormControl(''),
        streetLine1: new FormControl(''),
        streetLine2: new FormControl(''),
        city: new FormControl(''),
        province: new FormControl(''),
        postalCode: new FormControl(''),
        countryCode: new FormControl(''),
        phoneNumber: new FormControl(''),
    });
    billingAddressForm = new FormGroup({
        fullName: new FormControl(''),
        company: new FormControl(''),
        streetLine1: new FormControl(''),
        streetLine2: new FormControl(''),
        city: new FormControl(''),
        province: new FormControl(''),
        postalCode: new FormControl(''),
        countryCode: new FormControl(''),
        phoneNumber: new FormControl(''),
    });
    note = '';
    recalculateShipping = true;
    previousState: string;
    editingShippingAddress = false;
    editingBillingAddress = false;
    updatedShippingMethods: {
        [
            shippingLineId: string
        ]: DraftOrderEligibleShippingMethodsQuery['eligibleShippingMethodsForDraftOrder'][number];
    } = {};
    private addedVariants = new Map<string, ProductSelectorItem>();

    constructor(
        protected dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
        private orderTransitionService: OrderTransitionService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {
        super();
    }

    ngOnInit(): void {
        this.init();
        this.addressCustomFields = this.getCustomFieldConfig('Address');
        this.modifyOrderInput.orderId = this.route.snapshot.paramMap.get('id') as string;
        this.orderLineCustomFields = this.getCustomFieldConfig('OrderLine');
        this.entity$.pipe(take(1)).subscribe(order => {
            this.orderSnapshot = this.createOrderSnapshot(order);
            if (order.couponCodes.length) {
                this.couponCodesControl.setValue(order.couponCodes);
            }
            this.surchargeForm.reset();
            for (const [name, control] of Object.entries(this.shippingAddressForm.controls)) {
                control.setValue(order.shippingAddress?.[name]);
            }
            this.addAddressCustomFieldsFormGroup(this.shippingAddressForm, order.shippingAddress);
            for (const [name, control] of Object.entries(this.billingAddressForm.controls)) {
                control.setValue(order.billingAddress?.[name]);
            }
            this.addAddressCustomFieldsFormGroup(this.billingAddressForm, order.billingAddress);
            this.orderLineCustomFieldsFormArray = new UntypedFormArray([]);
            for (const line of order.lines) {
                const formGroup = new UntypedFormGroup({});
                for (const { name } of this.orderLineCustomFields) {
                    formGroup.addControl(name, new UntypedFormControl((line as any).customFields[name]));
                }
                formGroup.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(value => {
                    let modifyRow = this.modifyOrderInput.adjustOrderLines.find(
                        l => l.orderLineId === line.id,
                    );
                    if (!modifyRow) {
                        modifyRow = {
                            orderLineId: line.id,
                            quantity: line.quantity,
                        };
                        this.modifyOrderInput.adjustOrderLines.push(modifyRow);
                    }
                    if (this.orderLineCustomFields.length) {
                        modifyRow.customFields = value;
                    }
                });
                this.orderLineCustomFieldsFormArray.push(formGroup);
            }
        });

        this.addItemCustomFieldsFormArray = new UntypedFormArray([]);
        this.addItemCustomFieldsForm = new UntypedFormGroup({});
        for (const customField of this.orderLineCustomFields) {
            this.addItemCustomFieldsForm.addControl(customField.name, new UntypedFormControl());
        }
        this.availableCountries$ = this.dataService.settings
            .getAvailableCountries()
            .mapSingle(result => result.countries.items)
            .pipe(shareReplay(1));
        this.dataService.order
            .getOrderHistory(this.id, {
                take: 1,
                sort: {
                    createdAt: SortOrder.DESC,
                },
                filter: { type: { eq: HistoryEntryType.ORDER_STATE_TRANSITION } },
            })
            .single$.subscribe(({ order }) => {
                this.previousState = order?.history.items[0].data.from;
            });
        this.uiLanguage$ = this.dataService.client
            .uiState()
            .stream$.pipe(map(({ uiState }) => uiState.language));
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    get addedLines(): AddedLine[] {
        const getSinglePriceValue = (price: ProductSelectorItem['price']) =>
            price.__typename === 'SinglePrice' ? price.value : 0;
        return (this.modifyOrderInput.addItems || [])
            .map(row => {
                const variantInfo = this.addedVariants.get(row.productVariantId);
                if (variantInfo) {
                    return {
                        id: this.getIdForAddedItem(row),
                        featuredAsset: variantInfo.productAsset,
                        productVariant: {
                            id: variantInfo.productVariantId,
                            name: variantInfo.productVariantName,
                            sku: variantInfo.sku,
                        },
                        unitPrice: getSinglePriceValue(variantInfo.price),
                        unitPriceWithTax: getSinglePriceValue(variantInfo.priceWithTax),
                        quantity: row.quantity,
                    };
                }
            })
            .filter(notNullOrUndefined);
    }

    private getIdForAddedItem(row: ModifyOrderData['addItems'][number]) {
        return `added-${row.productVariantId}-${JSON.stringify(row.customFields || {})}`;
    }

    transitionToPriorState(order: OrderDetailFragment) {
        this.orderTransitionService
            .transitionToPreModifyingState(order.id, order.nextStates)
            .subscribe(result => {
                this.router.navigate(['..'], { relativeTo: this.route });
            });
    }

    hasModifications(): boolean {
        const { addItems, adjustOrderLines, surcharges } = this.modifyOrderInput;
        return (
            !!addItems?.length ||
            !!surcharges?.length ||
            !!adjustOrderLines?.length ||
            (this.shippingAddressForm.dirty && this.shippingAddressForm.valid) ||
            (this.billingAddressForm.dirty && this.billingAddressForm.valid) ||
            this.couponCodesControl.dirty ||
            Object.entries(this.updatedShippingMethods).length > 0
        );
    }

    isLineModified(line: OrderDetailFragment['lines'][number]): boolean {
        return !!this.modifyOrderInput.adjustOrderLines?.find(
            l => l.orderLineId === line.id && l.quantity !== line.quantity,
        );
    }

    getInitialLineQuantity(lineId: string): number {
        const adjustedLine = this.modifyOrderInput.adjustOrderLines?.find(l => l.orderLineId === lineId);
        if (adjustedLine) {
            return adjustedLine.quantity;
        }
        const addedLine = this.modifyOrderInput.addItems?.find(l => this.getIdForAddedItem(l) === lineId);
        if (addedLine) {
            return addedLine.quantity ?? 1;
        }
        const line = this.orderSnapshot.lines.find(l => l.id === lineId);
        return line ? line.quantity : 1;
    }

    updateLineQuantity(line: OrderDetailFragment['lines'][number] | AddedLine, quantity: string) {
        const { adjustOrderLines } = this.modifyOrderInput;
        if (this.isAddedLine(line)) {
            const row = this.modifyOrderInput.addItems?.find(
                l => l.productVariantId === line.productVariant.id,
            );
            if (row) {
                row.quantity = +quantity;
            }
        } else {
            let row = adjustOrderLines?.find(l => l.orderLineId === line.id);
            if (row && +quantity === line.quantity) {
                // Remove the modification if the quantity is the same as
                // the original order
                adjustOrderLines?.splice(adjustOrderLines?.indexOf(row), 1);
            }
            if (!row) {
                row = { orderLineId: line.id, quantity: +quantity };
                adjustOrderLines?.push(row);
            }
            row.quantity = +quantity;
        }
    }

    isAddedLine(line: OrderDetailFragment['lines'][number] | AddedLine): line is AddedLine {
        return (line as AddedLine).id.startsWith('added-');
    }

    updateAddedItemQuantity(item: AddedLine, quantity: string) {
        const row = this.modifyOrderInput.addItems?.find(l => l.productVariantId === item.productVariant.id);
        if (row) {
            row.quantity = +quantity;
        }
    }

    trackByProductVariantId(index: number, item: AddedLine) {
        return item.productVariant.id;
    }

    getSelectedItemPrice(result: ProductSelectorItem | undefined): number {
        switch (result?.priceWithTax.__typename) {
            case 'SinglePrice':
                return result.priceWithTax.value;
            default:
                return 0;
        }
    }

    addItemToOrder(result: ProductSelectorItem | undefined) {
        if (!result) {
            return;
        }
        const customFields = this.orderLineCustomFields.length
            ? this.addItemCustomFieldsForm.value
            : undefined;
        let row = this.modifyOrderInput.addItems?.find(l =>
            this.isMatchingAddItemRow(l, result, customFields),
        );
        if (!row) {
            row = { productVariantId: result.productVariantId, quantity: 1 };
            if (customFields) {
                row.customFields = customFields;
            }
            this.modifyOrderInput.addItems?.push(row);
        } else {
            row.quantity++;
        }
        if (customFields) {
            const formGroup = new UntypedFormGroup({});
            for (const [key, value] of Object.entries(customFields)) {
                formGroup.addControl(key, new UntypedFormControl(value));
            }
            this.addItemCustomFieldsFormArray.push(formGroup);
            formGroup.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(value => {
                if (row) {
                    row.customFields = value;
                }
            });
        }
        this.addItemCustomFieldsForm.reset({});
        this.addItemSelectedVariant = undefined;
        this.addedVariants.set(result.productVariantId, result);
    }

    getShippingLineDetails(shippingLine: OrderDetailFragment['shippingLines'][number]): {
        name: string;
        price: number;
    } {
        const updatedMethod = this.updatedShippingMethods[shippingLine.id];
        if (updatedMethod) {
            return {
                name: updatedMethod.name || updatedMethod.code,
                price: updatedMethod.priceWithTax,
            };
        } else {
            return {
                name: shippingLine.shippingMethod.name || shippingLine.shippingMethod.code,
                price: shippingLine.discountedPriceWithTax,
            };
        }
    }

    setShippingMethod(shippingLineId: string) {
        const currentShippingMethod =
            this.updatedShippingMethods[shippingLineId] ??
            this.entity?.shippingLines.find(l => l.id === shippingLineId)?.shippingMethod;
        if (!currentShippingMethod) {
            return;
        }
        this.dataService.order
            .getDraftOrderEligibleShippingMethods(this.id)
            .mapSingle(({ eligibleShippingMethodsForDraftOrder }) => eligibleShippingMethodsForDraftOrder)
            .pipe(
                switchMap(methods =>
                    this.modalService
                        .fromComponent(SelectShippingMethodDialogComponent, {
                            locals: {
                                eligibleShippingMethods: methods,
                                currencyCode: this.entity?.currencyCode,
                                currentSelectionId: currentShippingMethod.id,
                            },
                        })
                        .pipe(
                            map(result => {
                                if (result) {
                                    return methods.find(method => method.id === result);
                                }
                            }),
                        ),
                ),
            )
            .subscribe(result => {
                if (result) {
                    this.updatedShippingMethods[shippingLineId] = result;
                    this.changeDetectorRef.markForCheck();
                }
            });
    }

    private isMatchingAddItemRow(
        row: ModifyOrderData['addItems'][number],
        result: ProductSelectorItem,
        customFields: any,
    ): boolean {
        return (
            row.productVariantId === result.productVariantId &&
            JSON.stringify(row.customFields) === JSON.stringify(customFields)
        );
    }

    removeAddedItem(id: string) {
        this.modifyOrderInput.addItems = this.modifyOrderInput.addItems?.filter(l => {
            const itemId = this.getIdForAddedItem(l);
            return itemId !== id;
        });
    }

    getSurchargePrices(surcharge: SurchargeInput) {
        const priceWithTax = surcharge.priceIncludesTax
            ? surcharge.price
            : Math.round(surcharge.price * ((100 + (surcharge.taxRate || 0)) / 100));
        const price = surcharge.priceIncludesTax
            ? Math.round(surcharge.price / ((100 + (surcharge.taxRate || 0)) / 100))
            : surcharge.price;
        return {
            price,
            priceWithTax,
        };
    }

    addSurcharge(value: any) {
        this.modifyOrderInput.surcharges?.push(value);
        this.surchargeForm.reset({
            price: 0,
            priceIncludesTax: true,
            taxRate: 0,
        });
    }

    removeSurcharge(index: number) {
        this.modifyOrderInput.surcharges?.splice(index, 1);
    }

    previewAndModify(order: OrderDetailFragment) {
        const modifyOrderInput: ModifyOrderData = {
            ...this.modifyOrderInput,
            adjustOrderLines: this.modifyOrderInput.adjustOrderLines.map(line =>
                transformRelationCustomFieldInputs(simpleDeepClone(line), this.orderLineCustomFields),
            ),
        };
        const input: ModifyOrderInput = {
            ...modifyOrderInput,
            ...(this.billingAddressForm.dirty ? { updateBillingAddress: this.billingAddressForm.value } : {}),
            ...(this.shippingAddressForm.dirty
                ? { updateShippingAddress: this.shippingAddressForm.value }
                : {}),
            dryRun: true,
            couponCodes: this.couponCodesControl.dirty ? this.couponCodesControl.value : undefined,
            note: this.note ?? '',
            options: {
                recalculateShipping: this.recalculateShipping,
            },
        };
        if (Object.entries(this.updatedShippingMethods).length) {
            input.shippingMethodIds = order.shippingLines.map(l =>
                this.updatedShippingMethods[l.id]
                    ? this.updatedShippingMethods[l.id].id
                    : l.shippingMethod.id,
            );
        }
        this.dataService.order
            .modifyOrder(input)
            .pipe(
                switchMap(({ modifyOrder }) => {
                    switch (modifyOrder.__typename) {
                        case 'Order':
                            return this.modalService.fromComponent(OrderEditsPreviewDialogComponent, {
                                size: 'xl',
                                closable: false,
                                locals: {
                                    order: modifyOrder,
                                    orderSnapshot: this.orderSnapshot,
                                    orderLineCustomFields: this.orderLineCustomFields,
                                    modifyOrderInput: input,
                                    addedLines: this.addedLines,
                                    shippingAddressForm: this.shippingAddressForm,
                                    billingAddressForm: this.billingAddressForm,
                                    couponCodesControl: this.couponCodesControl,
                                    updatedShippingMethods: this.updatedShippingMethods,
                                },
                            });
                        case 'InsufficientStockError':
                        case 'NegativeQuantityError':
                        case 'NoChangesSpecifiedError':
                        case 'OrderLimitError':
                        case 'OrderModificationStateError':
                        case 'PaymentMethodMissingError':
                        case 'RefundPaymentIdMissingError':
                        case 'CouponCodeLimitError':
                        case 'CouponCodeExpiredError':
                        case 'IneligibleShippingMethodError':
                        case 'CouponCodeInvalidError': {
                            this.notificationService.error(modifyOrder.message);
                            return of(false as const);
                        }
                        case null:
                        case undefined:
                            return of(false as const);
                        default:
                            assertNever(modifyOrder);
                    }
                }),
                switchMap(result => {
                    if (!result || result.result === OrderEditResultType.Cancel) {
                        // re-fetch so that the preview values get overwritten in the cache.
                        return this.dataService.order.getOrder(this.id).mapSingle(() => false);
                    } else {
                        // Do the modification
                        const wetRunInput = {
                            ...input,
                            dryRun: false,
                        };
                        if (result.result === OrderEditResultType.Refund) {
                            wetRunInput.refunds = result.refunds;
                        }
                        return this.dataService.order.modifyOrder(wetRunInput).pipe(
                            switchMap(({ modifyOrder }) => {
                                if (modifyOrder.__typename === 'Order') {
                                    const priceDelta =
                                        modifyOrder.totalWithTax - this.orderSnapshot.totalWithTax;
                                    const nextState =
                                        0 < priceDelta ? 'ArrangingAdditionalPayment' : this.previousState;

                                    return this.dataService.order
                                        .transitionToState(order.id, nextState)
                                        .pipe(mapTo(true));
                                } else {
                                    this.notificationService.error((modifyOrder as ErrorResult).message);
                                    return EMPTY;
                                }
                            }),
                        );
                    }
                }),
            )
            .subscribe(result => {
                if (result) {
                    this.router.navigate(['../'], { relativeTo: this.route });
                }
            });
    }

    private addAddressCustomFieldsFormGroup(
        parentFormGroup: UntypedFormGroup,
        address?: OrderAddressFragment | null,
    ) {
        if (address && this.addressCustomFields.length) {
            const addressCustomFieldsFormGroup = new UntypedFormGroup({});
            for (const customFieldDef of this.addressCustomFields) {
                const name = customFieldDef.name;
                const value = (address as any).customFields?.[name];
                addressCustomFieldsFormGroup.addControl(name, new UntypedFormControl(value));
            }
            parentFormGroup.addControl('customFields', addressCustomFieldsFormGroup);
        }
    }

    private createOrderSnapshot(order: OrderDetailFragment): OrderSnapshot {
        return {
            totalWithTax: order.totalWithTax,
            currencyCode: order.currencyCode,
            couponCodes: order.couponCodes,
            lines: [...order.lines].map(line => ({ ...line })),
            shippingLines: [...order.shippingLines].map(line => ({ ...line })),
        };
    }

    protected setFormValues(entity: OrderDetailFragment, languageCode: LanguageCode): void {
        /* not used */
    }
}
