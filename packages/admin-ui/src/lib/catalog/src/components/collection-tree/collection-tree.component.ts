import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Input,
    OnChanges,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import { Collection, SelectionManager } from '@vendure/admin-ui/core';

import { arrayToTree, RootNode } from './array-to-tree';
import { CollectionTreeService } from './collection-tree.service';
import { CollectionPartial, RearrangeEvent } from './collection-tree.types';

@Component({
    selector: 'vdr-collection-tree',
    templateUrl: 'collection-tree.component.html',
    styleUrls: ['./collection-tree.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [CollectionTreeService],
    standalone: false
})
export class CollectionTreeComponent implements OnInit, OnChanges {
    @Input() collections: CollectionPartial[];
    @Input() activeCollectionId: string;
    @Input() expandAll = false;
    @Input() expandedIds: string[] = [];
    @Input() selectionManager: SelectionManager<CollectionPartial>;
    @Output() rearrange = new EventEmitter<RearrangeEvent>();
    @Output() deleteCollection = new EventEmitter<string>();
    collectionTree: RootNode<CollectionPartial>;

    constructor(private collectionTreeService: CollectionTreeService) {}

    ngOnChanges(changes: SimpleChanges) {
        if ('collections' in changes && this.collections) {
            this.collectionTree = arrayToTree(this.collections, this.collectionTree, this.expandedIds);
            this.collectionTreeService.setCollectionTree(this.collectionTree);
            this.collectionTreeService.resetMoveList();
        }
    }

    ngOnInit() {
        this.collectionTreeService.rearrange$.subscribe(event => this.rearrange.emit(event));
        this.collectionTreeService.delete$.subscribe(id => this.deleteCollection.emit(id));
    }
}
