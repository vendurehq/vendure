import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { CustomFieldType } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import extend from 'just-extend';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, takeUntil } from 'rxjs/operators';
import {
    CustomFieldConfig,
    DateOperators,
    IdOperators,
    NumberOperators,
    StringOperators,
} from '../../common/generated-types';
import {
    DataTableFilter,
    DataTableFilterBooleanType,
    DataTableFilterCustomType,
    DataTableFilterDateRangeType,
    DataTableFilterIDType,
    DataTableFilterNumberType,
    DataTableFilterOptions,
    DataTableFilterSelectType,
    DataTableFilterTextType,
    DataTableFilterType,
    DataTableFilterValue,
} from './data-table-filter';

export class FilterWithValue<Type extends DataTableFilterType = DataTableFilterType> {
    private onUpdateFns = new Set<(value: DataTableFilterValue<Type>) => void>();

    constructor(
        public readonly filter: DataTableFilter<any, Type>,
        public value: DataTableFilterValue<Type>,
        onUpdate?: (value: DataTableFilterValue<Type>) => void,
    ) {
        if (onUpdate) {
            this.onUpdateFns.add(onUpdate);
        }
    }

    onUpdate(fn: (value: DataTableFilterValue<Type>) => void) {
        this.onUpdateFns.add(fn);
    }

    updateValue(value: DataTableFilterValue<Type>) {
        this.value = value;
        for (const fn of this.onUpdateFns) {
            fn(value);
        }
    }

    isId(): this is FilterWithValue<DataTableFilterIDType> {
        return this.filter.type.kind === 'id';
    }

    isText(): this is FilterWithValue<DataTableFilterTextType> {
        return this.filter.type.kind === 'text';
    }

    isNumber(): this is FilterWithValue<DataTableFilterNumberType> {
        return this.filter.type.kind === 'number';
    }

    isBoolean(): this is FilterWithValue<DataTableFilterBooleanType> {
        return this.filter.type.kind === 'boolean';
    }

    isSelect(): this is FilterWithValue<DataTableFilterSelectType> {
        return this.filter.type.kind === 'select';
    }

    isDateRange(): this is FilterWithValue<DataTableFilterDateRangeType> {
        return this.filter.type.kind === 'dateRange';
    }

    isCustom(): this is FilterWithValue<DataTableFilterCustomType> {
        return this.filter.type.kind === 'custom';
    }
}

export class DataTableFilterCollection<FilterInput extends Record<string, any> = Record<string, any>> {
    readonly #filters: Array<DataTableFilter<FilterInput, any>> = [];
    #activeFilters: FilterWithValue[] = [];
    #valueChanges$ = new Subject<FilterWithValue[]>();
    #connectedToRouter = false;
    valueChanges = this.#valueChanges$.asObservable().pipe(debounceTime(10));
    readonly #filtersQueryParamName = 'filters';
    private readonly destroy$ = new Subject<void>();

    constructor(private router: Router) {}

    get length(): number {
        return this.#filters.length;
    }

    get activeFilters(): FilterWithValue[] {
        return this.#activeFilters;
    }

    destroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    addFilter<FilterType extends DataTableFilterType>(
        config: DataTableFilterOptions<FilterInput, FilterType>,
    ): DataTableFilterCollection<FilterInput> {
        if (this.#connectedToRouter) {
            throw new Error(
                'Cannot add filter after connecting to router. Make sure to call addFilter() before connectToRoute()',
            );
        }
        this.#filters.push(
            new DataTableFilter(config, (filter, value) => this.onActivateFilter(filter, value)),
        );
        return this;
    }

    addFilters<FilterType extends DataTableFilterType>(
        configs: Array<DataTableFilterOptions<FilterInput, FilterType>>,
    ): DataTableFilterCollection<FilterInput> {
        for (const config of configs) {
            this.addFilter(config);
        }
        return this;
    }

    addIdFilter(): FilterInput extends {
        id?: IdOperators | null;
    }
        ? DataTableFilterCollection<FilterInput>
        : never {
        this.addFilter({
            name: 'id',
            type: { kind: 'id' },
            label: _('common.id'),
            filterField: 'id',
        });
        return this as any;
    }

    addDateFilters(): FilterInput extends {
        createdAt?: DateOperators | null;
        updatedAt?: DateOperators | null;
    }
        ? DataTableFilterCollection<FilterInput>
        : never {
        this.addFilter({
            name: 'createdAt',
            type: { kind: 'dateRange' },
            label: _('common.created-at'),
            filterField: 'createdAt',
        });
        this.addFilter({
            name: 'updatedAt',
            type: { kind: 'dateRange' },
            label: _('common.updated-at'),
            filterField: 'updatedAt',
        });
        return this as any;
    }

    addCustomFieldFilters(customFields: CustomFieldConfig[]) {
        for (const config of customFields) {
            const type = config.type as CustomFieldType;
            if (config.list) {
                continue;
            }
            let filterType: DataTableFilterType | undefined;
            switch (type) {
                case 'boolean':
                    filterType = { kind: 'boolean' };
                    break;
                case 'int':
                case 'float':
                    filterType = { kind: 'number' };
                    break;
                case 'datetime':
                    filterType = { kind: 'dateRange' };
                    break;
                case 'string':
                case 'localeString':
                case 'localeText':
                case 'text':
                    filterType = { kind: 'text' };
                    break;
                case 'relation':
                case 'struct':
                    // Cannot filter relations
                    break;
                default:
                    assertNever(type);
            }
            if (filterType) {
                this.addFilter({
                    name: config.name,
                    type: filterType,
                    label: config.label ?? config.name,
                    filterField: config.name,
                });
            }
        }
        return this;
    }

    getFilter(name: string): DataTableFilter<FilterInput> | undefined {
        return this.#filters.find(f => f.name === name);
    }

    getFilters(): Array<DataTableFilter<FilterInput>> {
        return this.#filters;
    }

    removeActiveFilterAtIndex(index: number) {
        this.#activeFilters.splice(index, 1);
        this.#valueChanges$.next(this.#activeFilters);
    }

    createFilterInput(): FilterInput {
        return this.#activeFilters.reduce((acc, { filter, value }) => {
            const newValue = value != null ? filter.toFilterInput(value) : {};
            const result = extend(true, acc, newValue);
            return result as FilterInput;
        }, {} as FilterInput);
    }

    connectToRoute(route: ActivatedRoute) {
        this.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(val => {
            const currentFilters = route.snapshot.queryParamMap.get(this.#filtersQueryParamName);
            if (val.length === 0 && !currentFilters) {
                return;
            }
            this.router.navigate(['./'], {
                queryParams: { [this.#filtersQueryParamName]: this.serialize(), page: 1 },
                relativeTo: route,
                queryParamsHandling: 'merge',
            });
        });
        route.queryParamMap
            .pipe(
                map(params => params.get(this.#filtersQueryParamName)),
                distinctUntilChanged(),
                startWith(route.snapshot.queryParamMap.get(this.#filtersQueryParamName) ?? ''),
                takeUntil(this.destroy$),
            )
            .subscribe(value => {
                this.#activeFilters = [];
                if (value === '' || value === null) {
                    this.#valueChanges$.next(this.#activeFilters);
                    return;
                }
                const filterQueryParams = (value ?? '')
                    .split(';')
                    .map(value => value.split(':'))
                    .map(([name, value]) => ({ name, value }));
                for (const { name, value } of filterQueryParams) {
                    const filter = this.getFilter(name);
                    if (filter) {
                        const val = this.deserializeValue(filter, value);
                        filter.activate(val);
                    }
                }
            });

        this.#connectedToRouter = true;

        return this;
    }

    serialize(): string {
        return this.#activeFilters
            .map(
                (filterWithValue, i) =>
                    `${filterWithValue.filter.name}:${this.serializeValue(filterWithValue)}`,
            )
            .join(';');
    }

    private serializeValue<Type extends DataTableFilterType>(
        filterWithValue: FilterWithValue<Type>,
    ): string | undefined {
        if (filterWithValue.isId()) {
            const val = filterWithValue.value;
            return `${val?.operator},${val?.term}`;
        }
        if (filterWithValue.isText()) {
            const val = filterWithValue.value;
            return `${val?.operator},${val?.term}`;
        } else if (filterWithValue.isNumber()) {
            const val = filterWithValue.value;
            return `${val.operator},${val.amount}`;
        } else if (filterWithValue.isSelect()) {
            const val = filterWithValue.value;
            return val.join(',');
        } else if (filterWithValue.isBoolean()) {
            const val = filterWithValue.value;
            return val ? '1' : '0';
        } else if (filterWithValue.isDateRange()) {
            const val = filterWithValue.value;
            if (val.mode === 'relative') {
                return `${val.mode},${val.relativeValue},${val.relativeUnit}`;
            } else {
                const start = val.start ? new Date(val.start).getTime() : '';
                const end = val.end ? new Date(val.end).getTime() : '';
                return `${start},${end}`;
            }
        } else if (filterWithValue.isCustom()) {
            return filterWithValue.filter.type.serializeValue(filterWithValue.value);
        }
    }

    private deserializeValue(
        filter: DataTableFilter,
        value: string,
    ): DataTableFilterValue<DataTableFilterType> {
        switch (filter.type.kind) {
            case 'id': {
                const [operator, term] = value.split(',') as [keyof StringOperators, string];
                return { operator, term };
            }
            case 'text': {
                const [operator, term] = value.split(',') as [keyof StringOperators, string];
                return { operator, term };
            }
            case 'number': {
                const [operator, amount] = value.split(',') as [keyof NumberOperators, string];
                return { operator, amount: +amount };
            }
            case 'select':
                return value.split(',');
            case 'boolean':
                return value === '1';
            case 'dateRange':
                let mode = 'relative';
                let relativeValue: number | undefined;
                let relativeUnit: 'day' | 'month' | 'year' | undefined;
                let start: string | undefined;
                let end: string | undefined;
                if (value.startsWith('relative')) {
                    mode = 'relative';
                    const [_, relativeValueStr, relativeUnitStr] = value.split(',');
                    relativeValue = Number(relativeValueStr);
                    relativeUnit = relativeUnitStr as 'day' | 'month' | 'year';
                } else {
                    mode = 'range';
                    const [startTimestamp, endTimestamp] = value.split(',');
                    start = startTimestamp ? new Date(Number(startTimestamp)).toISOString() : '';
                    end = endTimestamp ? new Date(Number(endTimestamp)).toISOString() : '';
                }
                return { mode, relativeValue, relativeUnit, start, end };
            case 'custom':
                return filter.type.deserializeValue(value);
            default:
                assertNever(filter.type);
        }
    }

    private onActivateFilter(filter: DataTableFilter<any, any>, value: DataTableFilterValue<any>) {
        this.#activeFilters.push(this.createFilterWithValue(filter, value));
        this.#valueChanges$.next(this.#activeFilters);
    }

    private createFilterWithValue(
        filter: DataTableFilter<any, any>,
        value: DataTableFilterValue<DataTableFilterType>,
    ) {
        return new FilterWithValue(filter, value, v => this.#valueChanges$.next(v));
    }
}
