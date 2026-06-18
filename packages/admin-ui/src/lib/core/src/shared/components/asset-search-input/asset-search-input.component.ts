import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { NgSelectComponent, SELECTION_MODEL_FACTORY } from '@ng-select/ng-select';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { SearchProductsQuery, TagFragment } from '../../../common/generated-types';
import { SingleSearchSelectionModelFactory } from '../../../common/single-search-selection-model';

@Component({
    selector: 'vdr-asset-search-input',
    templateUrl: './asset-search-input.component.html',
    styleUrls: ['./asset-search-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [{ provide: SELECTION_MODEL_FACTORY, useValue: SingleSearchSelectionModelFactory }],
    standalone: false,
})
export class AssetSearchInputComponent {
    @Input() tags: TagFragment[];
    @Output() searchTermChange = new EventEmitter<string>();
    @Output() tagsChange = new EventEmitter<TagFragment[]>();
    @ViewChild('selectComponent', { static: true }) private selectComponent: NgSelectComponent;
    private lastTerm = '';
    private lastTagIds: string[] = [];

    setSearchTerm(term: string | null) {
        if (term) {
            this.selectComponent.select({ label: term, value: { label: term } });
        } else {
            const currentTerm = this.selectComponent.selectedItems.find(i => !this.isTag(i.value));
            if (currentTerm) {
                this.selectComponent.unselect(currentTerm);
            }
        }
    }

    setTags(tags: TagFragment[]) {
        const items = this.selectComponent.items;

        this.selectComponent.selectedItems.forEach(item => {
            if (this.isTag(item.value) && !tags.map(t => t.id).includes(item.id)) {
                this.selectComponent.unselect(item);
            }
        });

        tags.map(tag => items?.find(item => this.isTag(item) && item.id === tag.id))
            .filter(notNullOrUndefined)
            .forEach(item => {
                const isSelected = this.selectComponent.selectedItems.find(i => {
                    const val = i.value;
                    if (this.isTag(val)) {
                        return val.id === item.id;
                    }
                    return false;
                });
                if (!isSelected) {
                    this.selectComponent.select({ label: '', value: item });
                }
            });
    }

    filterTagResults = (
        term: string,
        item: SearchProductsQuery['search']['facetValues'] | { label: string },
    ) => {
        if (!this.isTag(item)) {
            return false;
        }
        return item.value.toLowerCase().startsWith(term.toLowerCase());
    };

    onSelectChange(selectedItems: Array<TagFragment | { label: string }>) {
        if (!Array.isArray(selectedItems)) {
            selectedItems = [selectedItems];
        }

        const searchTermItems = selectedItems.filter(item => !this.isTag(item));
        if (1 < searchTermItems.length) {
            for (let i = 0; i < searchTermItems.length - 1; i++) {
                // this.selectComponent.unselect(searchTermItems[i] as any);
            }
        }

        const searchTermItem = searchTermItems[searchTermItems.length - 1] as { label: string } | undefined;

        const searchTerm = searchTermItem ? searchTermItem.label : '';

        const tags = selectedItems.filter(this.isTag);

        if (searchTerm !== this.lastTerm) {
            this.searchTermChange.emit(searchTerm);
            this.lastTerm = searchTerm;
        }
        if (this.lastTagIds.join(',') !== tags.map(t => t.id).join(',')) {
            this.tagsChange.emit(tags);
            this.lastTagIds = tags.map(t => t.id);
        }
    }

    isSearchHeaderSelected(): boolean {
        return this.selectComponent.itemsList.markedIndex === -1;
    }

    addTagFn(item: any) {
        return { label: item };
    }

    private isTag = (input: unknown): input is TagFragment =>
        typeof input === 'object' && !!input && input.hasOwnProperty('value');
}
