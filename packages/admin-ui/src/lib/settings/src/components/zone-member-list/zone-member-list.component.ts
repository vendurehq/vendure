import {
    ChangeDetectionStrategy,
    Component,
    ContentChild,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import { FormControl } from '@angular/forms';
import {
    BulkActionLocationId,
    DataService,
    GetZoneListQuery,
    GetZoneMembersDocument,
    GetZoneMembersQuery,
    ItemOf,
    SelectionManager,
} from '@vendure/admin-ui/core';
import { BehaviorSubject, combineLatest, merge, Observable, of, Subject, switchMap } from 'rxjs';
import { map, startWith, take, takeUntil } from 'rxjs/operators';

import { ZoneMemberControlsDirective } from './zone-member-controls.directive';
import { ZoneMemberListHeaderDirective } from './zone-member-list-header.directive';

export type ZoneMember = { id: string; name: string; code: string };

@Component({
    selector: 'vdr-zone-member-list',
    templateUrl: './zone-member-list.component.html',
    styleUrls: ['./zone-member-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ZoneMemberListComponent implements OnInit, OnChanges, OnDestroy {
    @Input() locationId: BulkActionLocationId;
    @Input() members?: ZoneMember[];
    @Input() selectedMemberIds: string[] = [];
    @Input() activeZone: ItemOf<GetZoneListQuery, 'zones'>;
    @Output() selectionChange = new EventEmitter<string[]>();
    @ContentChild(ZoneMemberListHeaderDirective) headerTemplate: ZoneMemberListHeaderDirective;
    @ContentChild(ZoneMemberControlsDirective) controlsTemplate: ZoneMemberControlsDirective;
    members$: Observable<NonNullable<GetZoneMembersQuery['zone']>['members'] | ZoneMember[]>;
    filterTermControl = new FormControl('');
    filteredMembers$: Observable<ZoneMember[]>;
    totalItems$: Observable<number>;
    currentPage = 1;
    itemsPerPage = 10;
    selectionManager = new SelectionManager<ZoneMember>({
        multiSelect: true,
        itemsAreEqual: (a, b) => a.id === b.id,
        additiveMode: true,
    });
    private membersInput$ = new Subject<ZoneMember[]>();
    private activeZoneInput$ = new BehaviorSubject<ItemOf<GetZoneListQuery, 'zones'> | undefined>(undefined);
    private destroy$ = new Subject<void>();
    private refresh$ = new Subject<void>();

    constructor(private dataService: DataService) {}

    ngOnInit() {
        const activeZoneMembers$ = merge(this.activeZoneInput$, this.refresh$).pipe(
            switchMap(activeZone =>
                this.activeZone
                    ? this.dataService
                          .query(GetZoneMembersDocument, { zoneId: this.activeZone.id })
                          .mapSingle(({ zone }) => zone?.members ?? [])
                    : of([]),
            ),
        );
        this.members$ = merge(activeZoneMembers$, this.membersInput$);

        this.members$.pipe(take(1)).subscribe(members => {
            this.selectionManager.setCurrentItems(
                members?.filter(m => this.selectedMemberIds.includes(m.id)) ?? [],
            );
        });
        this.selectionManager.selectionChanges$.pipe(takeUntil(this.destroy$)).subscribe(selection => {
            this.selectionChange.emit(selection.map(s => s.id));
        });
        this.filteredMembers$ = combineLatest(
            this.members$,
            this.filterTermControl.valueChanges.pipe(startWith('')),
        ).pipe(
            map(([members, filterTerm]) => {
                if (filterTerm) {
                    const term = filterTerm?.toLocaleLowerCase() ?? '';
                    return members.filter(
                        m =>
                            m.name.toLocaleLowerCase().includes(term) ||
                            m.code.toLocaleLowerCase().includes(term),
                    );
                } else {
                    return members;
                }
            }),
        );
        this.totalItems$ = this.filteredMembers$.pipe(map(members => members.length));
    }

    ngOnChanges(changes: SimpleChanges) {
        if ('members' in changes) {
            this.membersInput$.next(this.members ?? []);
        }
        if ('activeZone' in changes) {
            this.activeZoneInput$.next(this.activeZone);
        }
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    refresh() {
        this.refresh$.next();
    }
}
