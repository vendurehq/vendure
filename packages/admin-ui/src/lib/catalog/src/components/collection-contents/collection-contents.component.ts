import {
    ChangeDetectionStrategy,
    Component,
    ContentChild,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    TemplateRef,
} from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
    CollectionFilterParameter,
    ConfigurableOperationInput,
    DataService,
    GetCollectionContentsQuery,
} from '@vendure/admin-ui/core';
import { BehaviorSubject, combineLatest, Observable, of, Subject } from 'rxjs';
import {
    catchError,
    debounceTime,
    distinctUntilChanged,
    filter,
    finalize,
    map,
    startWith,
    switchMap,
    takeUntil,
    tap,
} from 'rxjs/operators';

@Component({
    selector: 'vdr-collection-contents',
    templateUrl: './collection-contents.component.html',
    styleUrls: ['./collection-contents.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CollectionContentsComponent implements OnInit, OnChanges, OnDestroy {
    @Input() collectionId: string;
    @Input() parentId: string;
    @Input() inheritFilters: boolean;
    @Input() updatedFilters: ConfigurableOperationInput[] | undefined;
    @Input() previewUpdatedFilters = false;
    @ContentChild(TemplateRef, { static: true }) headerTemplate: TemplateRef<any>;

    contents$: Observable<NonNullable<GetCollectionContentsQuery['collection']>['productVariants']['items']>;
    contentsTotalItems$: Observable<number>;
    contentsItemsPerPage$: Observable<number>;
    contentsCurrentPage$: Observable<number>;
    filterTermControl = new UntypedFormControl('');
    isLoading = false;
    private collectionIdChange$ = new BehaviorSubject<string>('');
    private parentIdChange$ = new BehaviorSubject<string>('');
    private filterChanges$ = new BehaviorSubject<ConfigurableOperationInput[]>([]);
    private inheritFiltersChanges$ = new BehaviorSubject<boolean>(true);
    private refresh$ = new BehaviorSubject<boolean>(true);
    private destroy$ = new Subject<void>();

    constructor(private route: ActivatedRoute, private router: Router, private dataService: DataService) {}

    ngOnInit() {
        this.contentsCurrentPage$ = this.route.queryParamMap.pipe(
            map(qpm => qpm.get('contentsPage')),
            map(page => (!page ? 1 : +page)),
            startWith(1),
            distinctUntilChanged(),
        );

        this.contentsItemsPerPage$ = this.route.queryParamMap.pipe(
            map(qpm => qpm.get('contentsPerPage')),
            map(perPage => (!perPage ? 10 : +perPage)),
            startWith(10),
            distinctUntilChanged(),
        );

        const filterTerm$ = this.filterTermControl.valueChanges.pipe(
            debounceTime(250),
            tap(() => this.setContentsPageNumber(1)),
            startWith(''),
        );

        const filterChanges$ = this.filterChanges$.asObservable().pipe(
            filter(() => this.previewUpdatedFilters),
            tap(() => this.setContentsPageNumber(1)),
            startWith([]),
        );

        const inheritFiltersChanges$ = this.inheritFiltersChanges$.asObservable().pipe(
            filter(() => this.inheritFilters != null),
            distinctUntilChanged(),
            tap(() => this.setContentsPageNumber(1)),
            startWith(true),
        );

        const fetchUpdate$ = combineLatest(
            this.collectionIdChange$,
            this.parentIdChange$,
            this.contentsCurrentPage$,
            this.contentsItemsPerPage$,
            filterTerm$,
            filterChanges$,
            inheritFiltersChanges$,
            this.refresh$,
        );

        const collection$ = fetchUpdate$.pipe(
            takeUntil(this.destroy$),
            tap(() => (this.isLoading = true)),
            debounceTime(50),
            switchMap(([id, parentId, currentPage, itemsPerPage, filterTerm, filters, inheritFilters]) => {
                const take = itemsPerPage;
                const skip = (currentPage - 1) * itemsPerPage;
                if (filters.length && this.previewUpdatedFilters) {
                    const filterClause = filterTerm
                        ? ({ name: { contains: filterTerm } } as CollectionFilterParameter)
                        : undefined;
                    return this.dataService.collection
                        .previewCollectionVariants(
                            {
                                parentId,
                                filters,
                                inheritFilters,
                            },
                            {
                                take,
                                skip,
                                filter: filterClause,
                            },
                        )
                        .mapSingle(data => data.previewCollectionVariants)
                        .pipe(catchError(() => of({ items: [], totalItems: 0 })));
                } else if (id) {
                    return this.dataService.collection
                        .getCollectionContents(id, take, skip, filterTerm)
                        .mapSingle(data => data.collection?.productVariants);
                } else {
                    return of(null);
                }
            }),
            tap(() => (this.isLoading = false)),
            finalize(() => (this.isLoading = false)),
        );

        this.contents$ = collection$.pipe(map(result => (result ? result.items : [])));
        this.contentsTotalItems$ = collection$.pipe(map(result => (result ? result.totalItems : 0)));
    }

    ngOnChanges(changes: SimpleChanges): void {
        if ('collectionId' in changes) {
            this.collectionIdChange$.next(changes.collectionId.currentValue);
        }
        if ('parentId' in changes) {
            this.parentIdChange$.next(changes.parentId.currentValue);
        }
        if ('inheritFilters' in changes) {
            this.inheritFiltersChanges$.next(changes.inheritFilters.currentValue);
        }
        if ('updatedFilters' in changes) {
            if (this.updatedFilters) {
                this.filterChanges$.next(this.updatedFilters);
            }
        }
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    setContentsPageNumber(page: number) {
        this.setParam('contentsPage', page);
    }

    setContentsItemsPerPage(perPage: number) {
        this.setParam('contentsPerPage', perPage);
    }

    refresh() {
        this.refresh$.next(true);
    }

    private setParam(key: string, value: any) {
        this.router.navigate(['./'], {
            relativeTo: this.route,
            queryParams: {
                [key]: value,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }
}
