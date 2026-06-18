import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import {
    FormBuilder,
    FormControl,
    FormGroup,
    FormRecord,
    UntypedFormControl,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateFacetInput,
    createUpdatedTranslatable,
    DataService,
    DeletionResult,
    FACET_WITH_VALUE_LIST_FRAGMENT,
    FacetWithValueListFragment,
    findTranslation,
    getCustomFieldsDefaults,
    GetFacetDetailDocument,
    GetFacetDetailQuery,
    GetFacetDetailQueryVariables,
    LanguageCode,
    ModalService,
    NotificationService,
    Permission,
    TypedBaseDetailComponent,
    UpdateFacetInput,
    UpdateFacetValueInput,
} from '@vendure/admin-ui/core';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { gql } from 'apollo-angular';
import { BehaviorSubject, combineLatest, EMPTY, forkJoin, Observable } from 'rxjs';
import { debounceTime, map, mergeMap, switchMap, take, takeUntil } from 'rxjs/operators';
import { CreateFacetValueDialogComponent } from '../create-facet-value-dialog/create-facet-value-dialog.component';

export const FACET_DETAIL_QUERY = gql`
    query GetFacetDetail($id: ID!, $facetValueListOptions: FacetValueListOptions) {
        facet(id: $id) {
            ...FacetWithValueList
        }
    }
    ${FACET_WITH_VALUE_LIST_FRAGMENT}
`;

type ValueItem =
    | FacetWithValueListFragment['valueList']['items'][number]
    | { id: string; name: string; code: string };

@Component({
    selector: 'vdr-facet-detail',
    templateUrl: './facet-detail.component.html',
    styleUrls: ['./facet-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class FacetDetailComponent
    extends TypedBaseDetailComponent<typeof GetFacetDetailDocument, 'facet'>
    implements OnInit, OnDestroy
{
    readonly customFields = this.getCustomFieldConfig('Facet');
    readonly customValueFields = this.getCustomFieldConfig('FacetValue');
    detailForm = this.formBuilder.group({
        facet: this.formBuilder.group({
            code: ['', Validators.required],
            name: '',
            visible: true,
            customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
        }),
        values: this.formBuilder.record<
            FormGroup<{
                id: FormControl<string>;
                name: FormControl<string>;
                code: FormControl<string>;
                customFields: FormGroup;
            }>
        >({}),
    });
    currentPage = 1;
    itemsPerPage = 10;
    totalItems = 0;
    filterControl = new FormControl('');
    values$ = new BehaviorSubject<ValueItem[]>([]);
    readonly updatePermission = [Permission.UpdateCatalog, Permission.UpdateFacet];

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
        private modalService: ModalService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        this.filterControl.valueChanges
            .pipe(debounceTime(200), takeUntil(this.destroy$))
            .subscribe(filterTerm => {
                this.currentPage = 1;
                this.fetchFacetValues(this.currentPage, this.itemsPerPage, filterTerm);
            });
    }

    ngOnDestroy() {
        this.destroy();
    }

    updateCode(currentCode: string, nameValue: string) {
        if (!currentCode) {
            const codeControl = this.detailForm.get(['facet', 'code']);
            if (codeControl && codeControl.pristine) {
                codeControl.setValue(normalizeString(nameValue, '-'));
            }
        }
    }

    updateValueCode(currentCode: string, nameValue: string, valueId: string) {
        if (!currentCode) {
            const codeControl = this.detailForm.get(['values', valueId, 'code']);
            if (codeControl && codeControl.pristine) {
                codeControl.setValue(normalizeString(nameValue, '-'));
            }
        }
    }

    customValueFieldIsSet(index: number, name: string): boolean {
        return !!this.detailForm.get(['values', index, 'customFields', name]);
    }

    addFacetValue() {
        this.modalService
            .fromComponent(CreateFacetValueDialogComponent, {
                locals: {
                    languageCode: this.languageCode,
                    facetId: this.id,
                },
            })
            .pipe(
                switchMap(result => {
                    if (!result) {
                        return EMPTY;
                    } else {
                        return this.dataService.facet.createFacetValues([result]);
                    }
                }),
            )
            .subscribe(result => {
                if (result.createFacetValues) {
                    this.notificationService.success(_('common.notify-create-success'), {
                        entity: 'FacetValue',
                    });
                    this.currentPage = 1;
                    this.fetchFacetValues(this.currentPage, this.itemsPerPage);
                }
            });
    }

    create() {
        const facetForm = this.detailForm.get('facet') as (typeof this.detailForm)['controls']['facet'];
        if (!facetForm || !facetForm.dirty) {
            return;
        }
        const newFacet = this.getUpdatedFacet(
            {
                id: '',
                createdAt: '',
                updatedAt: '',
                isPrivate: false,
                languageCode: this.languageCode,
                name: '',
                code: '',
                translations: [],
            },
            facetForm,
            this.languageCode,
        ) as CreateFacetInput;
        this.dataService.facet.createFacet(newFacet).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), { entity: 'Facet' });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createFacet.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'Facet',
                });
            },
        );
    }

    save() {
        const valuesFormRecord = this.detailForm.get(
            'values',
        ) as (typeof this.detailForm)['controls']['values'];
        combineLatest(this.entity$, this.languageCode$)
            .pipe(
                take(1),
                mergeMap(([facet, languageCode]) => {
                    const facetForm = this.detailForm.get(
                        'facet',
                    ) as (typeof this.detailForm)['controls']['facet'];
                    const updateOperations: Array<Observable<any>> = [];

                    if (facetForm && facetForm.dirty) {
                        const updatedFacetInput = this.getUpdatedFacet(
                            facet,
                            facetForm,
                            languageCode,
                        ) as UpdateFacetInput;
                        if (updatedFacetInput) {
                            updateOperations.push(this.dataService.facet.updateFacet(updatedFacetInput));
                        }
                    }
                    if (valuesFormRecord && valuesFormRecord.dirty) {
                        const updatedValues = this.getUpdatedFacetValues(valuesFormRecord, languageCode);
                        if (updatedValues.length) {
                            updateOperations.push(this.dataService.facet.updateFacetValues(updatedValues));
                        }
                    }
                    return forkJoin(updateOperations);
                }),
            )
            .subscribe(
                () => {
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.notificationService.success(_('common.notify-update-success'), { entity: 'Facet' });
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Facet',
                    });
                },
            );
    }

    deleteFacetValue(facetValueId: string) {
        this.showModalAndDelete(facetValueId)
            .pipe(
                switchMap(response => {
                    if (response.result === DeletionResult.DELETED) {
                        return [true];
                    } else {
                        return this.showModalAndDelete(facetValueId, response.message || '').pipe(
                            map(r => r.result === DeletionResult.DELETED),
                        );
                    }
                }),
                switchMap(deleted =>
                    deleted
                        ? this.dataService.query(GetFacetDetailDocument, {
                              id: this.id,
                          }).single$
                        : [],
                ),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-delete-success'), {
                        entity: 'FacetValue',
                    });
                    this.fetchFacetValues(this.currentPage, this.itemsPerPage, this.filterControl.value);
                },
                err => {
                    this.notificationService.error(_('common.notify-delete-error'), {
                        entity: 'FacetValue',
                    });
                },
            );
    }

    private showModalAndDelete(facetValueId: string, message?: string) {
        return this.modalService
            .dialog({
                title: _('catalog.confirm-delete-facet-value'),
                body: message,
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(result =>
                    result ? this.dataService.facet.deleteFacetValues([facetValueId], !!message) : EMPTY,
                ),
                map(result => result.deleteFacetValues[0]),
            );
    }

    protected setCurrentPage(newPage: number) {
        this.currentPage = newPage;
        this.fetchFacetValues(this.currentPage, this.itemsPerPage, this.filterControl.value);
    }

    protected setItemsPerPage(itemsPerPage: number) {
        this.itemsPerPage = itemsPerPage;
        this.fetchFacetValues(this.currentPage, this.itemsPerPage, this.filterControl.value);
    }

    private fetchFacetValues(currentPage: number, itemsPerPage: number, filterTerm?: string | null) {
        this.dataService
            .query<GetFacetDetailQuery, GetFacetDetailQueryVariables>(FACET_DETAIL_QUERY, {
                id: this.id,
                facetValueListOptions: {
                    take: itemsPerPage,
                    skip: (currentPage - 1) * itemsPerPage,
                    sort: {
                        createdAt: SortOrder.DESC,
                    },
                    ...(filterTerm ? { filter: { name: { contains: filterTerm } } } : {}),
                },
            })
            .single$.subscribe(({ facet }) => {
                if (facet) {
                    this.values$.next([...facet.valueList.items]);
                    this.totalItems = facet.valueList.totalItems;
                    this.setFacetValueFormValues(facet, this.languageCode);
                }
            });
    }

    /**
     * Sets the values of the form on changes to the facet or current language.
     */
    protected setFormValues(facet: FacetWithValueListFragment, languageCode: LanguageCode) {
        const currentTranslation = findTranslation(facet, languageCode);

        this.detailForm.patchValue({
            facet: {
                code: facet.code,
                visible: !facet.isPrivate,
                name: currentTranslation?.name ?? '',
            },
        });

        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get(['facet', 'customFields']),
                facet,
                currentTranslation,
            );
        }
        this.values$.next([...facet.valueList.items]);
        this.totalItems = facet.valueList.totalItems;
        this.setFacetValueFormValues(facet, languageCode);
    }

    private setFacetValueFormValues(facet: FacetWithValueListFragment, languageCode: LanguageCode) {
        const currentValuesFormGroup = this.detailForm.get('values') as FormRecord;
        facet.valueList.items.forEach(value => {
            const valueTranslation = findTranslation(value, languageCode);
            const group = {
                id: value.id,
                code: value.code,
                name: valueTranslation ? valueTranslation.name : '',
            };
            let valueControl = currentValuesFormGroup.get(value.id) as FormGroup;
            if (!valueControl) {
                valueControl = this.formBuilder.group(group);
                currentValuesFormGroup.addControl(value.id, valueControl);
            } else {
                valueControl.patchValue(group);
            }
            if (this.customValueFields.length) {
                let customValueFieldsGroup = valueControl.get(['customFields']) as
                    | UntypedFormGroup
                    | undefined;
                if (!customValueFieldsGroup) {
                    customValueFieldsGroup = new UntypedFormGroup({});
                    valueControl.addControl('customFields', customValueFieldsGroup);
                }

                if (customValueFieldsGroup) {
                    for (const fieldDef of this.customValueFields) {
                        const key = fieldDef.name;
                        const fieldValue =
                            fieldDef.type === 'localeString'
                                ? (valueTranslation as any | undefined)?.customFields?.[key]
                                : (value as any).customFields[key];
                        const control = customValueFieldsGroup.get(key);
                        if (control) {
                            control.setValue(fieldValue);
                        } else {
                            customValueFieldsGroup.addControl(key, new UntypedFormControl(fieldValue));
                        }
                    }
                }
            }
        });
    }

    /**
     * Given a facet and the value of the detailForm, this method creates an updated copy of the facet which
     * can then be persisted to the API.
     */
    private getUpdatedFacet(
        facet: Omit<FacetWithValueListFragment, 'valueList'>,
        facetFormGroup: (typeof this.detailForm)['controls']['facet'],
        languageCode: LanguageCode,
    ): CreateFacetInput | UpdateFacetInput {
        const input = createUpdatedTranslatable({
            translatable: facet,
            updatedFields: facetFormGroup.value,
            customFieldConfig: this.customFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: facet.name || '',
            },
        });
        input.isPrivate = !facetFormGroup.value.visible;
        return input;
    }

    /**
     * Given an array of facet values and the values from the detailForm, this method creates a new array
     * which can be persisted to the API via an updateFacetValues mutation.
     */
    private getUpdatedFacetValues(
        valuesFormGroup: FormGroup,
        languageCode: LanguageCode,
    ): UpdateFacetValueInput[] {
        const dirtyValueValues = Object.values(valuesFormGroup.controls)
            .filter(c => c.dirty)
            .map(c => c.value);

        return dirtyValueValues
            .map((value, i) =>
                createUpdatedTranslatable({
                    translatable: value,
                    updatedFields: value,
                    customFieldConfig: this.customValueFields,
                    languageCode,
                    defaultTranslation: {
                        languageCode,
                        name: '',
                    },
                }),
            )
            .filter(notNullOrUndefined);
    }
}
