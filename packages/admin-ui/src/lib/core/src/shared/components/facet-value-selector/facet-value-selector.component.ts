import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    OnDestroy,
    OnInit,
    Output,
    ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import { concat, merge, Observable, of, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, mapTo, switchMap, tap } from 'rxjs/operators';

import { FacetValue, FacetValueFragment } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * A form control for selecting facet values.
 *
 * @example
 * ```HTML
 * <vdr-facet-value-selector
 *   (selectedValuesChange)="selectedValues = $event"
 * ></vdr-facet-value-selector>
 * ```
 * The `selectedValuesChange` event will emit an array of `FacetValue` objects.
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-facet-value-selector',
    templateUrl: './facet-value-selector.component.html',
    styleUrls: ['./facet-value-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: FacetValueSelectorComponent,
            multi: true,
        },
    ],
    standalone: false,
})
export class FacetValueSelectorComponent implements OnInit, OnDestroy, ControlValueAccessor {
    @Output() selectedValuesChange = new EventEmitter<FacetValueFragment[]>();
    @Input() readonly = false;
    @Input() transformControlValueAccessorValue: (value: FacetValueFragment[]) => any[] = value => value;
    searchInput$ = new Subject<string>();
    searchLoading = false;
    searchResults$: Observable<FacetValueFragment[]>;
    selectedIds$ = new Subject<string[]>();

    @ViewChild(NgSelectComponent) private ngSelect: NgSelectComponent;

    onChangeFn: (val: any) => void;
    onTouchFn: () => void;
    disabled = false;
    value: Array<string | FacetValueFragment>;
    private subscription: Subscription;
    constructor(
        private dataService: DataService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

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
                return this.dataService.facet
                    .getFacetValues({ take: 100, filter: { name: { contains: term } } })
                    .mapSingle(result => result.facetValues.items);
            }),
            tap(() => (this.searchLoading = false)),
        );
        this.subscription = this.selectedIds$
            .pipe(
                switchMap(ids => {
                    if (!ids.length) {
                        return of([]);
                    }
                    return this.dataService.facet
                        .getFacetValues({ take: 100, filter: { id: { in: ids } } }, 'cache-first')
                        .mapSingle(result => result.facetValues.items);
                }),
            )
            .subscribe(val => {
                this.value = val;
                this.changeDetectorRef.markForCheck();
            });

        const clear$ = this.selectedValuesChange.pipe(mapTo([]));
        this.searchResults$ = concat(of([]), merge(searchItems$, clear$));
    }
    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    onChange(selected: FacetValueFragment[]) {
        if (this.readonly) {
            return;
        }
        for (const sel of selected) {
            console.log(`selected: ${sel.facet.name}:${sel.code}`);
        }
        this.selectedValuesChange.emit(selected);
        if (this.onChangeFn) {
            const transformedValue = this.transformControlValueAccessorValue(selected);
            this.onChangeFn(transformedValue);
        }
    }

    registerOnChange(fn: any) {
        this.onChangeFn = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouchFn = fn;
    }

    setDisabledState(isDisabled: boolean): void {
        this.disabled = isDisabled;
    }

    focus() {
        this.ngSelect.focus();
    }

    writeValue(obj: string | FacetValueFragment[] | Array<string | number> | null): void {
        let valueIds: string[] | undefined;
        if (typeof obj === 'string') {
            try {
                const facetValueIds = JSON.parse(obj) as string[];
                valueIds = facetValueIds;
            } catch (err) {
                // TODO: log error
                throw err;
            }
        } else if (Array.isArray(obj)) {
            const isIdArray = (input: unknown[]): input is Array<string | number> =>
                input.every(i => typeof i === 'number' || typeof i === 'string');
            if (isIdArray(obj)) {
                valueIds = obj.map(fv => fv.toString());
            } else {
                valueIds = obj.map(fv => fv.id);
            }
        }
        if (valueIds) {
            // this.value = valueIds;
            this.selectedIds$.next(valueIds);
        }
    }
}
