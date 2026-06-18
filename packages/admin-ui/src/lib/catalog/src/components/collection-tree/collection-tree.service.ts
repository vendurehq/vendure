import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { RootNode, TreeNode } from './array-to-tree';
import { CollectionPartial, RearrangeEvent } from './collection-tree.types';

/**
 * Facilitates communication between the CollectionTreeComponent and child CollectionTreeNodeComponents
 * without introducing a cyclic dependency.
 */
@Injectable()
export class CollectionTreeService implements OnDestroy {
    private allMoveListItems: Array<{ path: string; id: string; ancestorIdPath: Set<string> }> = [];
    private collectionTree: RootNode<CollectionPartial>;
    private _rearrange$ = new Subject<RearrangeEvent>();
    private _delete$ = new Subject<string>();

    public rearrange$: Observable<RearrangeEvent>;
    public delete$: Observable<string>;

    constructor() {
        this.rearrange$ = this._rearrange$.asObservable();
        this.delete$ = this._delete$.asObservable();
    }

    ngOnDestroy() {
        this._rearrange$.complete();
        this._delete$.complete();
    }

    setCollectionTree(tree: RootNode<CollectionPartial>) {
        this.collectionTree = tree;
    }

    resetMoveList() {
        this.allMoveListItems = [];
    }

    getMoveListItems(collection: CollectionPartial) {
        if (this.allMoveListItems.length === 0) {
            this.allMoveListItems = this.calculateAllMoveListItems();
        }
        return this.allMoveListItems.filter(
            item =>
                item.id !== collection.id &&
                !item.ancestorIdPath.has(collection.id) &&
                item.id !== collection.parent?.id,
        );
    }

    onDrop(event: CdkDragDrop<CollectionPartial | RootNode<CollectionPartial>>) {
        const item = event.item.data as CollectionPartial;
        const newParent = event.container.data;
        const newParentId = newParent.id;
        if (newParentId == null) {
            throw new Error(`Could not determine the ID of the root Collection`);
        }
        this._rearrange$.next({
            collectionId: item.id,
            parentId: newParentId,
            index: event.currentIndex,
        });
    }

    onMove(event: RearrangeEvent) {
        this._rearrange$.next(event);
    }

    onDelete(id: string) {
        this._delete$.next(id);
    }

    private calculateAllMoveListItems() {
        const visit = (
            node: TreeNode<any>,
            parentPath: string[],
            ancestorIdPath: Set<string>,
            output: Array<{ path: string; id: string; ancestorIdPath: Set<string> }>,
        ) => {
            const path = parentPath.concat(node.name);
            output.push({ path: path.slice(1).join(' / ') || 'root', id: node.id, ancestorIdPath });
            node.children.forEach(child =>
                visit(child, path, new Set<string>([...ancestorIdPath, node.id]), output),
            );
            return output;
        };
        return visit(this.collectionTree, [], new Set<string>(), []);
    }
}
