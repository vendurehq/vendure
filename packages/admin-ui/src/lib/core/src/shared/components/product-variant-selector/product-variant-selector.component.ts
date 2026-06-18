import { ChangeDetectionStrategy, Component, EventEmitter, OnInit, Output, ViewChild } from '@angular/core';
import { NgSelectComponent } from '@ng-select/ng-select';
import { concat, merge, Observable, of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, mapTo, switchMap, tap } from 'rxjs/operators';

import { ProductSelectorSearchQuery } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * A component for selecting product variants via an autocomplete-style select input.
 *
 * @example
 * ```HTML
 * <vdr-product-variant-selector
 *   (productSelected)="selectResult($event)"></vdr-product-variant-selector>
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-product-variant-selector',
    templateUrl: './product-variant-selector.component.html',
    styleUrls: ['./product-variant-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ProductVariantSelectorComponent implements OnInit {
    searchInput$ = new Subject<string>();
    searchLoading = false;
    searchResults$: Observable<ProductSelectorSearchQuery['search']['items']>;
    @Output() productSelected = new EventEmitter<ProductSelectorSearchQuery['search']['items'][number]>();

    @ViewChild('autoComplete', { static: true })
    private ngSelect: NgSelectComponent;
    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.initSearchResults();
    }

    private initSearchResults() {
        const searchItems$ = this.searchInput$.pipe(
            debounceTime(200),
            distinctUntilChanged(),
            tap(() => (this.searchLoading = true)),
            switchMap(term => {
                if (!term) {
                    return of([]);
                }
                return this.dataService.product
                    .productSelectorSearch(term, 10)
                    .mapSingle(result => result.search.items);
            }),
            tap(() => (this.searchLoading = false)),
        );

        const clear$ = this.productSelected.pipe(mapTo([]));
        this.searchResults$ = concat(of([]), merge(searchItems$, clear$));
    }

    selectResult(product?: ProductSelectorSearchQuery['search']['items'][number]) {
        if (product) {
            this.productSelected.emit(product);
            this.ngSelect.clearModel();
        }
    }
}
