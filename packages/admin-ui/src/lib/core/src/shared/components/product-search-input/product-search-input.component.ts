import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { NgSelectComponent, SELECTION_MODEL_FACTORY } from '@ng-select/ng-select';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { SearchProductsQuery } from '../../../common/generated-types';
import { SingleSearchSelectionModelFactory } from '../../../common/single-search-selection-model';

type FacetValueResult = SearchProductsQuery['search']['facetValues'][number];

@Component({
    selector: 'vdr-product-search-input',
    templateUrl: './product-search-input.component.html',
    styleUrls: ['./product-search-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [{ provide: SELECTION_MODEL_FACTORY, useValue: SingleSearchSelectionModelFactory }],
    standalone: false,
})
export class ProductSearchInputComponent {
    @Input() facetValueResults: FacetValueResult;
    @Output() searchTermChange = new EventEmitter<string>();
    @Output() facetValueChange = new EventEmitter<string[]>();
    @ViewChild('selectComponent', { static: true }) private selectComponent: NgSelectComponent;
    private lastTerm = '';
    private lastFacetValueIds: string[] = [];

    setSearchTerm(term: string | null) {
        if (term) {
            this.selectComponent.select({ label: term, value: { label: term } });
        } else {
            const currentTerm = this.selectComponent.selectedItems.find(i => !this.isFacetValueItem(i.value));
            if (currentTerm) {
                this.selectComponent.unselect(currentTerm);
            }
        }
    }

    setFacetValues(ids: string[]) {
        const items = this.selectComponent.items;

        this.selectComponent.selectedItems.forEach(item => {
            if (this.isFacetValueItem(item.value) && !ids.includes(item.value.facetValue.id)) {
                this.selectComponent.unselect(item);
            }
        });

        ids.map(id => items?.find(item => this.isFacetValueItem(item) && item.facetValue.id === id))
            .filter(notNullOrUndefined)
            .forEach(item => {
                const isSelected = this.selectComponent.selectedItems.find(i => {
                    const val = i.value;
                    if (this.isFacetValueItem(val)) {
                        return val.facetValue.id === item.facetValue.id;
                    }
                    return false;
                });
                if (!isSelected) {
                    this.selectComponent.select({ label: '', value: item });
                }
            });
    }

    filterFacetResults = (term: string, item: FacetValueResult | { label: string }) => {
        if (!this.isFacetValueItem(item)) {
            return false;
        }

        const cix = term.indexOf(':');
        const facetName = cix > -1 ? term.toLowerCase().slice(0, cix) : null;
        const facetVal = cix > -1 ? term.toLowerCase().slice(cix + 1) : term.toLowerCase();

        if (facetName) {
            return (
                item.facetValue.facet.name.toLowerCase().includes(facetName) &&
                item.facetValue.name.toLocaleLowerCase().includes(facetVal)
            );
        }

        return (
            item.facetValue.name.toLowerCase().includes(term.toLowerCase()) ||
            item.facetValue.facet.name.toLowerCase().includes(term.toLowerCase())
        );
    };

    onSelectChange(selectedItems: Array<FacetValueResult | { label: string }>) {
        if (!Array.isArray(selectedItems)) {
            selectedItems = [selectedItems];
        }
        const searchTermItem = selectedItems.find(item => !this.isFacetValueItem(item)) as
            | { label: string }
            | undefined;
        const searchTerm = searchTermItem ? searchTermItem.label : '';

        const facetValueIds = selectedItems.filter(this.isFacetValueItem).map(i => i.facetValue.id);

        if (searchTerm !== this.lastTerm) {
            this.searchTermChange.emit(searchTerm);
            this.lastTerm = searchTerm;
        }
        if (this.lastFacetValueIds.join(',') !== facetValueIds.join(',')) {
            this.facetValueChange.emit(facetValueIds);
            this.lastFacetValueIds = facetValueIds;
        }
    }

    addTagFn(item: any) {
        return { label: item };
    }

    isSearchHeaderSelected(): boolean {
        return this.selectComponent.itemsList.markedIndex === -1;
    }

    private isFacetValueItem = (input: unknown): input is FacetValueResult =>
        typeof input === 'object' && !!input && input.hasOwnProperty('facetValue');
}
