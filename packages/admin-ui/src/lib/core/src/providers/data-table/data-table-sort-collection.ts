import { ActivatedRoute, Router } from '@angular/router';
import { CustomFieldType } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CustomFieldConfig } from '../../common/generated-types';
import { DataTableSort, DataTableSortOptions, DataTableSortOrder } from './data-table-sort';

export class DataTableSortCollection<
    SortInput extends Record<string, 'ASC' | 'DESC'>,
    Names extends [...Array<keyof SortInput>] = [],
> {
    readonly #sorts: Array<DataTableSort<SortInput>> = [];
    #valueChanges$ = new Subject<Array<{ name: string; sortOrder: DataTableSortOrder | undefined }>>();
    #connectedToRouter = false;
    valueChanges = this.#valueChanges$.asObservable();
    readonly #sortQueryParamName = 'sort';
    #defaultSort: { name: keyof SortInput; sortOrder: DataTableSortOrder } | undefined;
    private readonly destroy$ = new Subject<void>();

    constructor(private router: Router) {}

    get length(): number {
        return this.#sorts.length;
    }

    destroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    addSort<Name extends keyof SortInput>(
        config: DataTableSortOptions<SortInput, Name>,
    ): DataTableSortCollection<SortInput, [...Names, Name]> {
        if (this.#connectedToRouter) {
            throw new Error(
                'Cannot add sort after connecting to router. Make sure to call addSort() before connectToRoute()',
            );
        }
        this.#sorts.push(new DataTableSort<SortInput>(config, () => this.onSetValue()));
        return this as unknown as DataTableSortCollection<SortInput, [...Names, Name]>;
    }

    addSorts<Name extends keyof SortInput>(
        configs: Array<DataTableSortOptions<SortInput, Name>>,
    ): DataTableSortCollection<SortInput, [...Names, Name]> {
        for (const config of configs) {
            this.addSort(config);
        }
        return this as unknown as DataTableSortCollection<SortInput, [...Names, Name]>;
    }

    addCustomFieldSorts(customFields: CustomFieldConfig[]) {
        for (const config of customFields) {
            const type = config.type as CustomFieldType;
            if (config.list) {
                continue;
            }
            switch (type) {
                case 'string':
                case 'localeString':
                case 'boolean':
                case 'int':
                case 'float':
                case 'datetime':
                case 'localeText':
                case 'text':
                    this.addSort({ name: config.name });
                    break;
                case 'relation':
                case 'struct':
                    // Cannot sort relations
                    break;
                default:
                    assertNever(type);
            }
        }
        return this;
    }

    defaultSort(name: keyof SortInput, sortOrder: DataTableSortOrder) {
        this.#defaultSort = { name, sortOrder };
        return this;
    }

    get(name: Names[number]): DataTableSort<SortInput> | undefined {
        return this.#sorts.find(s => s.name === name);
    }

    connectToRoute(route: ActivatedRoute) {
        this.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
            this.router.navigate(['./'], {
                queryParams: { [this.#sortQueryParamName]: this.serialize() },
                relativeTo: route,
                queryParamsHandling: 'merge',
            });
        });
        const filterQueryParams = (route.snapshot.queryParamMap.get(this.#sortQueryParamName) ?? '')
            .split(';')
            .map(value => value.split(':'))
            .map(([name, value]) => ({ name, value }));
        for (const { name, value } of filterQueryParams) {
            const sort = this.get(name);
            if (sort) {
                sort.setSortOrder(value as any);
            }
        }
        this.#connectedToRouter = true;
        return this;
    }

    createSortInput(): SortInput {
        const activeSorts = this.#sorts.filter(s => s.sortOrder !== undefined);
        let sortInput = {} as SortInput;
        if (activeSorts.length === 0 && this.#defaultSort) {
            return { [this.#defaultSort.name]: this.#defaultSort.sortOrder } as SortInput;
        }
        for (const sort of activeSorts) {
            sortInput = { ...sortInput, [sort.name]: sort.sortOrder };
        }
        return sortInput;
    }

    private serialize(): string {
        const activeSorts = this.#sorts.filter(s => s.sortOrder !== undefined);
        return activeSorts.map(s => `${s.name as string}:${s.sortOrder}`).join(';');
    }

    private onSetValue() {
        this.#valueChanges$.next(
            this.#sorts
                .filter(f => f.sortOrder !== undefined)
                .map(s => ({ name: s.name as any, sortOrder: s.sortOrder })),
        );
    }
}
