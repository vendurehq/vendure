import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    Asset,
    BaseListComponent,
    DataService,
    DeletionResult,
    GetAssetListQuery,
    GetAssetListQueryVariables,
    ItemOf,
    LogicalOperator,
    ModalService,
    NotificationService,
    SortOrder,
    TagFragment,
} from '@vendure/admin-ui/core';
import { PaginationInstance } from 'ngx-pagination';
import { BehaviorSubject, combineLatest, EMPTY, Observable } from 'rxjs';
import { debounceTime, finalize, map, switchMap, takeUntil } from 'rxjs/operators';

@Component({
    selector: 'vdr-asset-list',
    templateUrl: './asset-list.component.html',
    styleUrls: ['./asset-list.component.scss'],
    standalone: false
})
export class AssetListComponent
    extends BaseListComponent<
        GetAssetListQuery,
        ItemOf<GetAssetListQuery, 'assets'>,
        GetAssetListQueryVariables
    >
    implements OnInit
{
    searchTerm$ = new BehaviorSubject<string | undefined>(undefined);
    filterByTags$ = new BehaviorSubject<TagFragment[] | undefined>(undefined);
    uploading = false;
    allTags$: Observable<TagFragment[]>;
    paginationConfig$: Observable<PaginationInstance>;

    constructor(
        private notificationService: NotificationService,
        private modalService: ModalService,
        private dataService: DataService,
        router: Router,
        route: ActivatedRoute,
    ) {
        super(router, route);
        super.setQueryFn(
            (...args: any[]) => this.dataService.product.getAssetList(...args).refetchOnChannelChange(),
            data => data.assets,
            (skip, take) => {
                const searchTerm = this.searchTerm$.value;
                const tags = this.filterByTags$.value?.map(t => t.value);
                return {
                    options: {
                        skip,
                        take,
                        ...(searchTerm
                            ? {
                                  filter: {
                                      name: { contains: searchTerm },
                                  },
                              }
                            : {}),
                        sort: {
                            createdAt: SortOrder.DESC,
                        },
                        tags,
                        tagsOperator: LogicalOperator.AND,
                    },
                };
            },
            { take: 25, skip: 0 },
        );
    }

    ngOnInit() {
        super.ngOnInit();
        this.paginationConfig$ = combineLatest(this.itemsPerPage$, this.currentPage$, this.totalItems$).pipe(
            map(([itemsPerPage, currentPage, totalItems]) => ({ itemsPerPage, currentPage, totalItems })),
        );
        this.searchTerm$.pipe(debounceTime(250), takeUntil(this.destroy$)).subscribe(() => this.refresh());

        this.filterByTags$.pipe(takeUntil(this.destroy$)).subscribe(() => this.refresh());
        this.allTags$ = this.dataService.product.getTagList().mapStream(data => data.tags.items);
    }

    filesSelected(files: File[]) {
        if (files.length) {
            this.uploading = true;
            this.dataService.product
                .createAssets(files)
                .pipe(finalize(() => (this.uploading = false)))
                .subscribe(({ createAssets }) => {
                    let successCount = 0;
                    for (const result of createAssets) {
                        switch (result.__typename) {
                            case 'Asset':
                                successCount++;
                                break;
                            case 'MimeTypeError':
                                this.notificationService.error(result.message);
                                break;
                        }
                    }
                    if (0 < successCount) {
                        super.refresh();
                        this.notificationService.success(_('asset.notify-create-assets-success'), {
                            count: successCount,
                        });
                    }
                });
        }
    }

    deleteAssets(assets: Asset[]) {
        this.showModalAndDelete(assets.map(a => a.id))
            .pipe(
                switchMap(response => {
                    if (response.result === DeletionResult.DELETED) {
                        return [true];
                    } else {
                        return this.showModalAndDelete(
                            assets.map(a => a.id),
                            response.message || '',
                        ).pipe(map(r => r.result === DeletionResult.DELETED));
                    }
                }),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-delete-success'), {
                        entity: 'Assets',
                    });
                    this.refresh();
                },
                err => {
                    this.notificationService.error(_('common.notify-delete-error'), {
                        entity: 'Assets',
                    });
                },
            );
    }

    private showModalAndDelete(assetIds: string[], message?: string) {
        return this.modalService
            .dialog({
                title: _('catalog.confirm-delete-assets'),
                translationVars: {
                    count: assetIds.length,
                },
                body: message,
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(res => (res ? this.dataService.product.deleteAssets(assetIds, !!message) : EMPTY)),
                map(res => res.deleteAssets),
            );
    }
}
