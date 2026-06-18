import { inject, Type } from '@angular/core';
import { AbstractControl, UntypedFormGroup } from '@angular/forms';
import { ActivatedRoute, ActivationStart, ResolveFn, Router } from '@angular/router';
import { ResultOf, TypedDocumentNode } from '@graphql-typed-document-node/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { combineLatest, Observable, of, Subject } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, switchMap, takeUntil, tap } from 'rxjs/operators';

import { DataService } from '../data/providers/data.service';
import { ServerConfigService } from '../data/server-config';
import { BreadcrumbValue } from '../providers/breadcrumb/breadcrumb.service';
import { PermissionsService } from '../providers/permissions/permissions.service';

import { DeactivateAware } from './deactivate-aware';
import { CustomFieldConfig, CustomFields, LanguageCode } from './generated-types';
import { TranslationOf } from './utilities/find-translation';

/**
 * @description
 * A base class for entity detail views. It should be used in conjunction with the
 * {@link BaseEntityResolver}.
 *
 * @example
 * ```ts
 * \@Component({
 *   selector: 'app-my-entity',
 *   templateUrl: './my-entity.component.html',
 *   styleUrls: ['./my-entity.component.scss'],
 *   changeDetection: ChangeDetectionStrategy.OnPush,
 * })
 * export class GlobalSettingsComponent extends BaseDetailComponent<MyEntityFragment> implements OnInit {
 *   detailForm: FormGroup;
 *
 *   constructor(
 *     router: Router,
 *     route: ActivatedRoute,
 *     serverConfigService: ServerConfigService,
 *     protected dataService: DataService,
 *     private formBuilder: FormBuilder,
 *   ) {
 *     super(route, router, serverConfigService, dataService);
 *     this.detailForm = this.formBuilder.group({
 *       name: [''],
 *     });
 *   }
 *
 *   protected setFormValues(entity: MyEntityFragment, languageCode: LanguageCode): void {
 *     this.detailForm.patchValue({
 *       name: entity.name,
 *     });
 *   }
 * }
 * ```
 *
 * @docsCategory list-detail-views
 */
export abstract class BaseDetailComponent<Entity extends { id: string; updatedAt?: string }>
    implements DeactivateAware
{
    entity$: Observable<Entity>;
    availableLanguages$: Observable<LanguageCode[]>;
    languageCode$: Observable<LanguageCode>;
    languageCode: LanguageCode;
    isNew$: Observable<boolean>;
    id: string;
    abstract detailForm: UntypedFormGroup;
    protected destroy$ = new Subject<void>();

    protected constructor(
        protected route: ActivatedRoute,
        protected router: Router,
        protected serverConfigService: ServerConfigService,
        protected dataService: DataService,
        protected permissionsService: PermissionsService,
    ) {}

    init() {
        this.entity$ = this.route.data.pipe(
            switchMap(data => (data.entity as Observable<Entity>).pipe(takeUntil(this.destroy$))),
            filter(notNullOrUndefined),
            tap(entity => (this.id = entity.id)),
            shareReplay(1),
        );
        this.isNew$ = this.entity$.pipe(
            map(entity => !entity?.id),
            shareReplay(1),
        );
        this.setUpStreams();
    }

    protected setUpStreams() {
        this.languageCode$ = this.route.paramMap.pipe(
            map(paramMap => paramMap.get('lang')),
            switchMap(lang => {
                if (lang) {
                    return of(lang as LanguageCode);
                } else {
                    return this.dataService.client.uiState().mapSingle(data => data.uiState.contentLanguage);
                }
            }),
            distinctUntilChanged(),
            tap(val => (this.languageCode = val)),
            shareReplay(1),
        );

        this.availableLanguages$ = this.serverConfigService.getAvailableLanguages();

        combineLatest(this.entity$, this.languageCode$)
            .pipe(takeUntil(this.destroy$))
            .subscribe(([entity, languageCode]) => {
                if (entity) {
                    this.setFormValues(entity, languageCode);
                }
                this.detailForm.markAsPristine();
            });
    }

    destroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    setLanguage(code: LanguageCode) {
        this.setQueryParam('lang', code);
        this.dataService.client.setContentLanguage(code).subscribe();
    }

    canDeactivate(): boolean {
        return this.detailForm && this.detailForm.pristine;
    }

    protected abstract setFormValues(entity: Entity, languageCode: LanguageCode): void;

    protected setCustomFieldFormValues<T = Entity>(
        customFields: CustomFieldConfig[],
        formGroup: AbstractControl | null,
        entity: T,
        currentTranslation?: TranslationOf<T>,
    ) {
        for (const fieldDef of customFields) {
            const key = fieldDef.name;
            const value =
                fieldDef.type === 'localeString' || fieldDef.type === 'localeText'
                    ? (currentTranslation as any)?.customFields?.[key]
                    : (entity as any).customFields?.[key];
            const control = formGroup?.get(key);
            if (control) {
                control.patchValue(value);
            }
        }
    }

    protected getCustomFieldConfig(key: Exclude<keyof CustomFields, '__typename'>): CustomFieldConfig[] {
        return this.serverConfigService.getCustomFieldsFor(key).filter(f => {
            if (f.requiresPermission?.length) {
                return this.permissionsService.userHasPermissions(f.requiresPermission);
            }
            return true;
        });
    }

    protected setQueryParam(key: string, value: any) {
        this.router.navigate(
            [
                './',
                {
                    ...this.route.snapshot.params,
                    [key]: value,
                },
            ],
            {
                relativeTo: this.route,
                queryParamsHandling: 'merge',
            },
        );
    }
}

/**
 * @description
 * A version of the {@link BaseDetailComponent} which is designed to be used with a
 * [TypedDocumentNode](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node).
 *
 * @docsCategory list-detail-views
 */
export abstract class TypedBaseDetailComponent<
    T extends TypedDocumentNode<any, any>,
    Field extends keyof ResultOf<T>,
> extends BaseDetailComponent<NonNullable<ResultOf<T>[Field]>> {
    protected result$: Observable<ResultOf<T>>;
    protected entity: ResultOf<T>[Field];

    protected constructor() {
        super(
            inject(ActivatedRoute),
            inject(Router),
            inject(ServerConfigService),
            inject(DataService),
            inject(PermissionsService),
        );
    }

    override init() {
        this.entity$ = this.route.data.pipe(
            switchMap(data =>
                (data.detail.entity as Observable<ResultOf<T>[Field]>).pipe(takeUntil(this.destroy$)),
            ),
            filter(notNullOrUndefined),
            tap(entity => {
                this.id = entity.id;
                this.entity = entity;
            }),
            shareReplay(1),
        );
        this.result$ = this.route.data.pipe(
            map(data => data.detail.result),
            shareReplay(1),
        );
        this.isNew$ = this.route.data.pipe(
            switchMap(data => data.detail.entity),
            map(entity => !entity),
            shareReplay(1),
        );
        this.setUpStreams();
    }
}

/**
 * @description
 * A helper function for creating tabs that point to a {@link TypedBaseDetailComponent}. This takes
 * care of the route resolver parts so that the detail component automatically has access to the
 * correct resolved detail data.
 *
 * @example
 * ```ts
 * \@NgModule({
 *   imports: [ReviewsSharedModule],
 *   declarations: [/* ... *\/],
 *   providers: [
 *     registerPageTab({
 *       location: 'product-detail',
 *       tab: 'Specs',
 *       route: 'specs',
 *       component: detailComponentWithResolver({
 *         component: ProductSpecDetailComponent,
 *         query: GetProductSpecsDocument,
 *         entityKey: 'spec',
 *       }),
 *     }),
 *   ],
 * })
 * export class ProductSpecsUiExtensionModule {}
 * ```
 * @docsCategory list-detail-views
 */
export function detailComponentWithResolver<
    T extends TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
>(config: {
    component: Type<TypedBaseDetailComponent<T, Field>>;
    query: T;
    entityKey: R;
    getBreadcrumbs?: (entity: ResultOf<T>[R]) => BreadcrumbValue;
    variables?: T extends TypedDocumentNode<any, infer V> ? Omit<V, 'id'> : never;
}) {
    return {
        resolveFn: createBaseDetailResolveFn(config),
        breadcrumbFn: (result: any) => config.getBreadcrumbs?.(result) ?? ([] as BreadcrumbValue[]),
        component: config.component,
    };
}

export function createBaseDetailResolveFn<
    T extends TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
>(config: {
    query: T;
    entityKey: R | string;
    variables?: T extends TypedDocumentNode<any, infer V> ? Omit<V, 'id'> : never;
}): ResolveFn<{
    entity: Observable<ResultOf<T>[Field] | null>;
    result?: ResultOf<T>;
}> {
    return route => {
        const router = inject(Router);
        const dataService = inject(DataService);
        const id = route.paramMap.get('id');

        // Complete the entity stream upon navigating away
        const navigateAway$ = router.events.pipe(filter(event => event instanceof ActivationStart));

        if (id == null) {
            throw new Error('No id found in route');
        }
        if (id === 'create') {
            return of({ entity: of(null) });
        } else {
            const result$ = dataService
                .query(config.query, { id, ...(config.variables ?? {}) })
                .refetchOnChannelChange()
                .stream$.pipe(takeUntil(navigateAway$), shareReplay(1));
            const entity$ = result$.pipe(map(result => result[config.entityKey]));
            const entityStream$ = entity$.pipe(filter(notNullOrUndefined));
            return result$.pipe(
                map(result => ({
                    entity: entityStream$,
                    result,
                })),
            );
        }
    };
}
