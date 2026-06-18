import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { PaginationInstance } from 'ngx-pagination';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { debounceTime, delay, finalize, map, take as rxjsTake, takeUntil, tap } from 'rxjs/operators';

import {
    Asset,
    GetAssetListQuery,
    GetAssetListQueryVariables,
    LogicalOperator,
    SortOrder,
    TagFragment,
} from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';
import { QueryResult } from '../../../data/query-result';
import { Dialog } from '../../../providers/modal/modal.types';
import { NotificationService } from '../../../providers/notification/notification.service';
import { AssetGalleryComponent } from '../asset-gallery/asset-gallery.component';
import { AssetLike } from '../asset-gallery/asset-gallery.types';
import { AssetSearchInputComponent } from '../asset-search-input/asset-search-input.component';

/**
 * @description
 * A dialog which allows the creation and selection of assets.
 *
 * @example
 * ```ts
 * selectAssets() {
 *   this.modalService
 *     .fromComponent(AssetPickerDialogComponent, {
 *         size: 'xl',
 *     })
 *     .subscribe(result => {
 *         if (result && result.length) {
 *             // ...
 *         }
 *     });
 * }
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-asset-picker-dialog',
    templateUrl: './asset-picker-dialog.component.html',
    styleUrls: ['./asset-picker-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetPickerDialogComponent implements OnInit, AfterViewInit, OnDestroy, Dialog<Asset[]> {
    assets$: Observable<AssetLike[]>;
    allTags$: Observable<TagFragment[]>;
    paginationConfig: PaginationInstance = {
        currentPage: 1,
        itemsPerPage: 25,
        totalItems: 1,
    };
    @ViewChild('assetSearchInputComponent')
    private assetSearchInputComponent: AssetSearchInputComponent;
    @ViewChild('assetGalleryComponent')
    private assetGalleryComponent: AssetGalleryComponent;

    multiSelect = true;
    initialTags: string[] = [];

    resolveWith: (result?: Asset[]) => void;
    selection: Asset[] = [];
    searchTerm$ = new BehaviorSubject<string | undefined>(undefined);
    filterByTags$ = new BehaviorSubject<TagFragment[] | undefined>(undefined);
    uploading = false;
    private listQuery: QueryResult<GetAssetListQuery, GetAssetListQueryVariables>;
    private destroy$ = new Subject<void>();

    constructor(
        private dataService: DataService,
        private notificationService: NotificationService,
    ) {}

    ngOnInit() {
        this.listQuery = this.dataService.product.getAssetList(this.paginationConfig.itemsPerPage, 0);
        this.allTags$ = this.dataService.product.getTagList().mapSingle(data => data.tags.items);
        this.assets$ = this.listQuery.stream$.pipe(
            tap(result => (this.paginationConfig.totalItems = result.assets.totalItems)),
            map(result => result.assets.items),
        );
        this.searchTerm$.pipe(debounceTime(250), takeUntil(this.destroy$)).subscribe(() => {
            this.fetchPage(this.paginationConfig.currentPage, this.paginationConfig.itemsPerPage);
        });
        this.filterByTags$.pipe(debounceTime(100), takeUntil(this.destroy$)).subscribe(() => {
            this.fetchPage(this.paginationConfig.currentPage, this.paginationConfig.itemsPerPage);
        });
    }

    ngAfterViewInit() {
        if (0 < this.initialTags.length) {
            this.allTags$
                .pipe(
                    rxjsTake(1),
                    map(allTags => allTags.filter(tag => this.initialTags.includes(tag.value))),
                    tap(tags => this.filterByTags$.next(tags)),
                    delay(1),
                )
                .subscribe(tags => this.assetSearchInputComponent.setTags(tags));
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    pageChange(page: number) {
        this.paginationConfig.currentPage = page;
        this.fetchPage(this.paginationConfig.currentPage, this.paginationConfig.itemsPerPage);
    }

    itemsPerPageChange(itemsPerPage: number) {
        this.paginationConfig.itemsPerPage = itemsPerPage;
        this.fetchPage(this.paginationConfig.currentPage, this.paginationConfig.itemsPerPage);
    }

    cancel() {
        this.resolveWith();
    }

    select() {
        this.resolveWith(this.selection);
    }

    createAssets(files: File[]) {
        if (files.length) {
            this.uploading = true;
            this.dataService.product
                .createAssets(files)
                .pipe(finalize(() => (this.uploading = false)))
                .subscribe(res => {
                    this.fetchPage(this.paginationConfig.currentPage, this.paginationConfig.itemsPerPage);
                    this.notificationService.success(_('asset.notify-create-assets-success'), {
                        count: files.length,
                    });
                    const assets = res.createAssets.filter(a => a.__typename === 'Asset') as AssetLike[];
                    this.assetGalleryComponent.selectMultiple(assets);
                });
        }
    }

    private fetchPage(currentPage: number, itemsPerPage: number) {
        const take = +itemsPerPage;
        const skip = (currentPage - 1) * +itemsPerPage;
        const searchTerm = this.searchTerm$.value;
        const tags = this.filterByTags$.value?.map(t => t.value);
        this.listQuery.ref.refetch({
            options: {
                skip,
                take,
                filter: {
                    name: {
                        contains: searchTerm,
                    },
                },
                sort: {
                    createdAt: SortOrder.DESC,
                },
                tags,
                tagsOperator: LogicalOperator.AND,
            },
        });
    }
}
