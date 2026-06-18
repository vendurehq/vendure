import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    GetCollectionListDocument,
    GetCollectionListQuery,
    ItemOf,
    LanguageCode,
    NotificationService,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { combineLatest, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';
import { CollectionOrderEvent } from '../collection-data-table/collection-data-table.component';

@Component({
    selector: 'vdr-collection-list',
    templateUrl: './collection-list.component.html',
    styleUrls: ['./collection-list.component.scss', './collection-list-common.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CollectionListComponent
    extends TypedBaseListComponent<typeof GetCollectionListDocument, 'collections'>
    implements OnInit
{
    activeCollectionId$: Observable<string | null>;
    activeCollectionIndex$: Observable<number>;
    activeCollectionTitle$: Observable<string>;
    subCollections$: Observable<Array<ItemOf<GetCollectionListQuery, 'collections'>>>;
    expandedIds: string[] = [];
    dataTableListId = 'collection-list';
    readonly customFields = this.getCustomFieldConfig('Collection');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'slug',
            label: _('common.slug'),
            type: { kind: 'text' },
            filterField: 'slug',
        })
        .addFilter({
            name: 'visibility',
            type: { kind: 'boolean' },
            label: _('common.visibility'),
            toFilterInput: value => ({
                isPrivate: { eq: !value },
            }),
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);
    readonly sorts = this.createSortCollection()
        .defaultSort('position', 'ASC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'name' })
        .addSort({ name: 'slug' })
        .addSort({ name: 'position' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor(
        protected dataService: DataService,
        private notificationService: NotificationService,
    ) {
        super();
        super.configure({
            document: GetCollectionListDocument,
            getItems: data => data.collections,
            setVariables: (skip, _take) => {
                const topLevelOnly =
                    this.searchTermControl.value === '' && this.filters.activeFilters.length === 0
                        ? true
                        : undefined;
                return {
                    options: {
                        skip,
                        take: _take,
                        filter: {
                            name: { contains: this.searchTermControl.value },
                            ...this.filters.createFilterInput(),
                        },
                        topLevelOnly,
                        sort: this.sorts.createSortInput(),
                    },
                };
            },
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    ngOnInit() {
        super.ngOnInit();
        this.activeCollectionId$ = this.route.paramMap.pipe(
            map(pm => pm.get('contents')),
            distinctUntilChanged(),
        );
        const expandedIds$ = this.route.queryParamMap.pipe(
            map(qpm => qpm.get('expanded')),
            distinctUntilChanged(),
            map(ids => (ids ? ids.split(',') : [])),
        );
        expandedIds$.pipe(takeUntil(this.destroy$)).subscribe(ids => {
            this.expandedIds = ids;
        });
        this.subCollections$ = combineLatest(expandedIds$, this.refresh$).pipe(
            switchMap(([ids]) => {
                if (ids.length) {
                    return this.dataService.collection
                        .getCollections({
                            take: 999,
                            filter: {
                                parentId: { in: ids },
                            },
                        })
                        .mapStream(data => data.collections.items);
                } else {
                    return of([]);
                }
            }),
        );

        this.activeCollectionTitle$ = combineLatest(
            this.activeCollectionId$,
            this.items$,
            this.subCollections$,
        ).pipe(
            map(([id, collections, subCollections]) => {
                if (id) {
                    const match = [...collections, ...subCollections].find(c => c.id === id);
                    return match ? match.name : '';
                }
                return '';
            }),
        );
        this.activeCollectionIndex$ = combineLatest(
            this.activeCollectionId$,
            this.items$,
            this.subCollections$,
        ).pipe(
            map(([id, collections, subCollections]) => {
                if (id) {
                    const allCollections: typeof collections = [];
                    for (const collection of collections) {
                        allCollections.push(collection);
                        const subCollectionMatches = subCollections.filter(
                            c => c.parentId && c.parentId === collection.id,
                        );
                        allCollections.push(...subCollectionMatches);
                    }
                    return allCollections.findIndex(c => c.id === id);
                }
                return -1;
            }),
        );
    }

    onRearrange(event: CollectionOrderEvent) {
        this.dataService.collection.moveCollection([event]).subscribe({
            next: () => {
                this.notificationService.success(_('common.notify-saved-changes'));
                this.refresh();
            },
            error: err => {
                this.notificationService.error(_('common.notify-save-changes-error'));
            },
        });
    }

    closeContents() {
        const params = { ...this.route.snapshot.params };
        delete params.contents;
        this.router.navigate(['./', params], { relativeTo: this.route, queryParamsHandling: 'preserve' });
    }

    setLanguage(code: LanguageCode) {
        this.dataService.client.setContentLanguage(code).subscribe();
    }

    toggleExpanded(collection: ItemOf<GetCollectionListQuery, 'collections'>) {
        let expandedIds = this.expandedIds;
        if (!expandedIds.includes(collection.id)) {
            expandedIds.push(collection.id);
        } else {
            expandedIds = expandedIds.filter(id => id !== collection.id);
        }
        this.router.navigate(['./'], {
            queryParams: {
                expanded: expandedIds.filter(id => !!id).join(','),
            },
            queryParamsHandling: 'merge',
            relativeTo: this.route,
        });
    }
}
