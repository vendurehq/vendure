import { NgOption, SelectionModel } from '@ng-select/ng-select';

/**
 * A custom SelectionModel for the NgSelect component which only allows a single
 * search term at a time.
 */
export class SingleSearchSelectionModel implements SelectionModel {
    private _selected: NgOption[] = [];

    get value(): NgOption[] {
        return this._selected;
    }

    select(item: NgOption, multiple: boolean, groupAsModel: boolean) {
        item.selected = true;
        if (groupAsModel || !item.children) {
            if ((item.value as any).label) {
                const isSearchTerm = (i: any) => !!i.value.label;
                const searchTerms = this._selected.filter(isSearchTerm);
                if (searchTerms.length > 0) {
                    // there is already a search term, so replace it with this new one.
                    this._selected = this._selected.filter(i => !isSearchTerm(i)).concat(item);
                } else {
                    this._selected.push(item);
                }
            } else {
                this._selected.push(item);
            }
        }
    }

    unselect(item: NgOption, multiple: boolean) {
        this._selected = this._selected.filter(x => x !== item);
        item.selected = false;
    }

    clear(keepDisabled: boolean) {
        this._selected = keepDisabled ? this._selected.filter(x => x.disabled) : [];
    }

    private _setChildrenSelectedState(children: NgOption[], selected: boolean) {
        children.forEach(x => (x.selected = selected));
    }

    private _removeChildren(parent: NgOption) {
        this._selected = this._selected.filter(x => x.parent !== parent);
    }

    private _removeParent(parent: NgOption) {
        this._selected = this._selected.filter(x => x !== parent);
    }
}

export function SingleSearchSelectionModelFactory() {
    return new SingleSearchSelectionModel();
}
