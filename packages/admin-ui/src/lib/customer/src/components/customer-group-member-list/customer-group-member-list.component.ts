import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Input,
    OnDestroy,
    OnInit,
    Output,
} from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
    BulkActionLocationId,
    Customer,
    DataService,
    GetCustomerGroupsQuery,
    ItemOf,
    SelectionManager,
} from '@vendure/admin-ui/core';
import { BehaviorSubject, combineLatest, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, takeUntil, tap } from 'rxjs/operators';

export interface CustomerGroupMemberFetchParams {
    skip: number;
    take: number;
    filterTerm: string;
}

export type CustomerGroupMember = Pick<
    Customer,
    'id' | 'createdAt' | 'updatedAt' | 'title' | 'firstName' | 'lastName' | 'emailAddress'
>;

@Component({
    selector: 'vdr-customer-group-member-list',
    templateUrl: './customer-group-member-list.component.html',
    styleUrls: ['./customer-group-member-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerGroupMemberListComponent implements OnInit, OnDestroy {
    @Input() locationId: BulkActionLocationId;
    @Input() members: CustomerGroupMember[];
    @Input() totalItems: number;
    @Input() route: ActivatedRoute;
    @Input() selectedMemberIds: string[] = [];
    @Input() activeGroup: ItemOf<GetCustomerGroupsQuery, 'customerGroups'>;
    @Output() selectionChange = new EventEmitter<string[]>();
    @Output() fetchParamsChange = new EventEmitter<CustomerGroupMemberFetchParams>();

    membersItemsPerPage$: Observable<number>;
    membersCurrentPage$: Observable<number>;
    filterTermControl = new FormControl('');
    selectionManager = new SelectionManager<CustomerGroupMember>({
        multiSelect: true,
        itemsAreEqual: (a, b) => a.id === b.id,
        additiveMode: true,
    });
    private refresh$ = new BehaviorSubject<boolean>(true);
    private destroy$ = new Subject<void>();

    constructor(
        private router: Router,
        private dataService: DataService,
    ) {}

    ngOnInit() {
        this.membersCurrentPage$ = this.route.paramMap.pipe(
            map(qpm => qpm.get('membersPage')),
            map(page => (!page ? 1 : +page)),
            startWith(1),
            distinctUntilChanged(),
        );

        this.membersItemsPerPage$ = this.route.paramMap.pipe(
            map(qpm => qpm.get('membersPerPage')),
            map(perPage => (!perPage ? 10 : +perPage)),
            startWith(10),
            distinctUntilChanged(),
        );

        const filterTerm$ = this.filterTermControl.valueChanges.pipe(
            debounceTime(250),
            tap(() => this.setContentsPageNumber(1)),
            startWith(''),
        );

        combineLatest(this.membersCurrentPage$, this.membersItemsPerPage$, filterTerm$, this.refresh$)
            .pipe(takeUntil(this.destroy$))
            .subscribe(([currentPage, itemsPerPage, filterTerm]) => {
                const take = itemsPerPage;
                const skip = (currentPage - 1) * itemsPerPage;
                this.fetchParamsChange.emit({
                    filterTerm: filterTerm ?? '',
                    skip,
                    take,
                });
            });
        this.selectionManager.setCurrentItems(
            this.members?.filter(m => this.selectedMemberIds.includes(m.id)) ?? [],
        );
        this.selectionManager.selectionChanges$.pipe(takeUntil(this.destroy$)).subscribe(selection => {
            this.selectionChange.emit(selection.map(s => s.id));
        });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    setContentsPageNumber(page: number) {
        this.setParam('membersPage', page);
    }

    setContentsItemsPerPage(perPage: number) {
        this.setParam('membersPerPage', perPage);
    }

    refresh() {
        this.refresh$.next(true);
    }

    private setParam(key: string, value: any) {
        this.router.navigate(['./', { ...this.route.snapshot.params, [key]: value }], {
            relativeTo: this.route,
            queryParamsHandling: 'merge',
        });
    }
}
