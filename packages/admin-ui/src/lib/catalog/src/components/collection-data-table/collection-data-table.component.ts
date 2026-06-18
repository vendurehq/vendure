import { CdkDrag, CdkDragDrop, CdkDropList, DragRef } from '@angular/cdk/drag-drop';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    QueryList,
    SimpleChanges,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { DataService, DataTable2Component, GetCollectionListQuery, ItemOf } from '@vendure/admin-ui/core';

export type CollectionTableItem = ItemOf<GetCollectionListQuery, 'collections'>;
export type CollectionOrderEvent = {
    collectionId: string;
    parentId: string;
    index: number;
};
@Component({
    selector: 'vdr-collection-data-table',
    templateUrl: './collection-data-table.component.html',
    styleUrls: [
        '../../../../core/src/shared/components/data-table-2/data-table2.component.scss',
        './collection-data-table.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CollectionDataTableComponent
    extends DataTable2Component<CollectionTableItem>
    implements OnChanges, AfterViewInit
{
    @Input() subCollections: CollectionTableItem[];
    @Output() changeOrder = new EventEmitter<CollectionOrderEvent>();
    @ViewChild(CdkDropList, { static: true }) dropList: CdkDropList<{
        depth: number;
        collection: CollectionTableItem;
    }>;
    @ViewChildren('collectionRow', { read: CdkDrag }) collectionRowList: QueryList<CdkDrag>;
    dragRefs: DragRef[] = [];
    absoluteIndex: { [id: string]: number } = {};
    constructor(
        protected changeDetectorRef: ChangeDetectorRef,
        protected dataService: DataService,
    ) {
        super(changeDetectorRef, dataService);
    }

    ngOnChanges(changes: SimpleChanges) {
        super.ngOnChanges(changes);
        if (changes.subCollections || changes.items) {
            const allCollections: CollectionTableItem[] = [];
            for (const collection of this.items ?? []) {
                allCollections.push(collection);
                const subCollectionMatches = this.getSubcollections(collection);
                allCollections.push(...subCollectionMatches.flat());
            }
            allCollections.forEach((collection, index) => (this.absoluteIndex[collection.id] = index));
        }
    }

    ngAfterViewInit() {
        this.collectionRowList.changes.subscribe((val: QueryList<CdkDrag>) => {
            this.dropList.getSortedItems().forEach(item => this.dropList.removeItem(item));
            for (const ref of val.toArray()) {
                ref.dropContainer = this.dropList;
                ref._dragRef._withDropContainer(this.dropList._dropListRef);
                this.dropList.addItem(ref);
            }
        });
    }

    getSubcollections(item: CollectionTableItem) {
        return this.subCollections?.filter(c => c.parentId === item.id) ?? [];
    }

    sortPredicate = (index: number, item: CdkDrag<{ depth: number; collection: CollectionTableItem }>) => {
        const itemAtIndex = this.dropList.getSortedItems()[index];
        return itemAtIndex?.data.collection.parentId === item.data.collection.parentId;
    };

    onDrop(
        event: CdkDragDrop<{
            depth: number;
            collection: CollectionTableItem;
        }>,
    ) {
        const isTopLevel = event.item.data.collection.breadcrumbs.length === 2;
        const pageIndexOffset = isTopLevel ? (this.currentPage - 1) * this.itemsPerPage : 0;
        const parentId = event.item.data.collection.parentId;
        const parentIndex = this.items.findIndex(i => i.id === parentId);
        const adjustedIndex = pageIndexOffset + event.currentIndex - parentIndex - 1;
        this.changeOrder.emit({
            collectionId: event.item.data.collection.id,
            index: adjustedIndex,
            parentId: event.item.data.collection.parentId,
        });

        if (isTopLevel) {
            this.items = [...this.items];
            this.items.splice(event.previousIndex, 1);
            this.items.splice(event.currentIndex, 0, event.item.data.collection);
        } else {
            const parent = this.items.find(i => i.id === parentId);
            if (parent) {
                const subCollections = this.getSubcollections(parent);
                const adjustedPreviousIndex = pageIndexOffset + event.previousIndex - parentIndex - 1;
                subCollections.splice(adjustedPreviousIndex, 1);
                subCollections.splice(event.currentIndex, 0, event.item.data.collection);
            }
        }
        this.changeDetectorRef.markForCheck();
    }
}
