import { DataTableSettingsMenu } from '@/vdb/components/data-table/data-table-settings-menu.js';
import { DataTableViewsTabs } from '@/vdb/components/data-table/data-table-views-tabs.js';
import { getRowLabel } from '@/vdb/components/data-table/row-label.js';
import { ButtonGroup } from '@/vdb/components/ui/button-group.js';
import { Button } from '@/vdb/components/ui/button.js';
import { CardTitle } from '@/vdb/components/ui/card.js';
import { EmptyCollectionIllustration, NoResultsIllustration } from '@/vdb/components/ui/illustrations.js';
import { Input } from '@/vdb/components/ui/input.js';
import { toast } from '@/vdb/components/ui/sonner.js';
import { EmptyState } from '@/vdb/components/ui/state-views.js';
import { TableCell, TableRow } from '@/vdb/components/ui/table.js';
import { BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useDragAndDrop } from '@/vdb/hooks/use-drag-and-drop.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { cn } from '@/vdb/lib/utils.js';
import { closestCenter, DndContext } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Trans, useLingui } from '@lingui/react/macro';
import {
    ColumnDef,
    ColumnFilter,
    ColumnFiltersState,
    flexRender,
    PaginationState,
    Row,
    SortingState,
    Table as TableType,
    VisibilityState,
} from '@tanstack/react-table';
import { RowSelectionState, TableOptions } from '@tanstack/table-core';
import { DataTable as UiDataTable } from '@vendure-io/ui/components/molecules/data-table/data-table';
import type {
    DataTableFilterColumn,
    DataTableRowCellProps,
    DataTableRowRipple,
    DataTableRowSelectProps,
} from '@vendure-io/ui/components/molecules/data-table/data-table-types';
import { GripVertical } from 'lucide-react';
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { AddFilterMenu } from './add-filter-menu.js';
import { DataTableBulkActions, getRowItemId } from './data-table-bulk-actions.js';
import { DataTableProvider } from './data-table-context.js';
import {
    DataTableFacetedFilter,
    DataTableFacetedFilterOption,
    DataTableFacetedFilterProps,
} from './data-table-faceted-filter.js';
import { DataTableFilterChipLabel } from './data-table-filter-chip-label.js';
import { DataTableFilterEditor } from './data-table-filter-editor.js';
import { createPaginationState, syncPaginationState } from './data-table-pagination-state.js';

// Skeleton rows are capped so a large pageSize doesn't bloat the DOM during
// the initial fetch.
const MAX_SKELETON_ROWS = 10;

const DRAG_HANDLE_COLUMN_ID = '__drag_handle__';

interface DraggableRowProps<TData> {
    row: Row<TData>;
    getRowCanDrag?: (row: Row<TData>) => boolean;
    /** The select-all ripple timing of this row, from the table. */
    ripple: DataTableRowRipple;
    /** The built-in body cell props of a column, from the table. */
    cellProps: (columnId: string) => DataTableRowCellProps;
    /** Click-to-select while rows are selected, from the table. */
    selectProps: DataTableRowSelectProps;
}

function DraggableRow<TData>({
    row,
    getRowCanDrag,
    ripple,
    cellProps,
    selectProps,
}: Readonly<DraggableRowProps<TData>>) {
    const { t } = useLingui();
    const rowCanDrag = getRowCanDrag ? getRowCanDrag(row) : true;

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.id,
        disabled: !rowCanDrag,
    });

    const rowLabel = getRowLabel(row.original);

    return (
        <TableRow
            {...selectProps}
            ref={setNodeRef}
            style={{
                ...ripple.style,
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.5 : 1,
            }}
            data-state={row.getIsSelected() ? 'selected' : undefined}
            className={cn('group/row', ripple.className)}
        >
            {row.getVisibleCells().map(cell => {
                const props = cellProps(cell.column.id);
                if (cell.column.id === DRAG_HANDLE_COLUMN_ID) {
                    return (
                        <TableCell key={cell.id} {...props} className={cn(props.className, 'w-10')}>
                            {rowCanDrag ? (
                                <div
                                    {...attributes}
                                    {...listeners}
                                    aria-label={rowLabel ? t`Reorder ${rowLabel}` : t`Reorder row`}
                                    className="cursor-move text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <GripVertical className="size-4" />
                                </div>
                            ) : null}
                        </TableCell>
                    );
                }
                return (
                    <TableCell key={cell.id} {...props}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                );
            })}
        </TableRow>
    );
}

export interface FacetedFilter {
    title: string;
    icon?: React.ComponentType<{ className?: string }>;
    optionsFn?: () => Promise<DataTableFacetedFilterOption[]>;
    options?: DataTableFacetedFilterOption[];
    component?: React.ComponentType<DataTableFacetedFilterProps<any, any>>;
}

/**
 * @description
 * Props for configuring the {@link DataTable}.
 *
 * @docsCategory list-views
 * @docsPage DataTable
 * @since 3.4.0
 */
interface DataTableProps<TData> {
    children?: React.ReactNode;
    columns: ColumnDef<TData, any>[];
    data: TData[];
    totalItems: number;
    isLoading?: boolean;
    page?: number;
    itemsPerPage?: number;
    sorting?: SortingState;
    columnFilters?: ColumnFiltersState;
    onPageChange?: (table: TableType<TData>, page: number, itemsPerPage: number) => void;
    onSortChange?: (table: TableType<TData>, sorting: SortingState) => void;
    onFilterChange?: (table: TableType<TData>, columnFilters: ColumnFilter[]) => void;
    onColumnVisibilityChange?: (table: TableType<TData>, columnVisibility: VisibilityState) => void;
    onSearchTermChange?: (searchTerm: string) => void;
    /**
     * @description
     * Placeholder text for the search input. Should say what the search targets,
     * e.g. "Search products...". Defaults to a generic "Search...".
     *
     * @since 3.8.0
     */
    searchPlaceholder?: string;
    defaultColumnVisibility?: VisibilityState;
    facetedFilters?: { [key: string]: FacetedFilter | undefined };
    disableViewOptions?: boolean;
    /**
     * @description
     * Enables saved-view controls for this table. This should be used for tables
     * which represent a whole data set, such as top-level list pages. It should
     * not be enabled for embedded tables or tables whose query is already scoped
     * by a predefined filter.
     *
     * @default false
     * @since 3.8.0
     */
    /**
     * Bulk actions to render for selected rows. Set to `false` to suppress the
     * bulk-action toolbar while retaining row selection.
     */
    bulkActions?: BulkActionsInput | false;
    /**
     * The selected items, used to synchronize table selection with an owning component.
     */
    selectedItems?: TData[];
    /**
     * Called when row selection changes, including selections retained across pages.
     */
    onSelectionChange?: (selection: TData[]) => void;
    /**
     * @description
     * Keeps the row selection in session storage under this key, so it survives
     * opening an item and going back, and a reload in the same tab. Name the list
     * and anything that scopes its rows, such as the channel. Without it the
     * selection lasts until the table unmounts.
     *
     * @since 4.0.0
     */
    selectionStorageKey?: string;
    /**
     * @description
     * Remembers how many rows the table showed, in local storage under this key.
     * The next first load draws that many skeleton rows, so the table keeps its
     * height when the rows arrive, also after a reload. Name the list and anything
     * that scopes its rows, such as the channel. Without it the first load draws
     * up to 10 skeleton rows.
     *
     * @since 4.0.0
     */
    rowCountKey?: string;
    /**
     * @description
     * Loading cells by column id, for cells taller than one text line (a
     * thumbnail, a two-line cell), so a skeleton row has the height of a
     * loaded row. A missing entry draws one text line.
     *
     * @since 4.0.0
     */
    skeletonCells?: Record<string, React.ReactNode>;
    /**
     * @description
     * The rows open a detail page through a `DetailPageButton`. The table
     * keeps the row link's slot after the last column while it loads and when it
     * is empty, so the columns do not move when the rows arrive.
     *
     * @since 4.0.0
     */
    rowLinks?: boolean;
    enableViews?: boolean;
    /**
     * @description
     * This property allows full control over _all_ features of TanStack Table
     * when needed.
     */
    setTableOptions?: (table: TableOptions<TData>) => TableOptions<TData>;
    onRefresh?: () => void;
    /**
     * @description
     * Callback when items are reordered via drag and drop.
     * When provided, enables drag-and-drop functionality.
     * The fourth parameter provides all items for context-aware reordering.
     */
    onReorder?: (oldIndex: number, newIndex: number, item: TData, allItems?: TData[]) => void | Promise<void>;
    /**
     * @description
     * When true, drag and drop will be disabled. This will only have an effect if the onReorder prop is also set
     */
    disableDragAndDrop?: boolean;
    /**
     * @description
     * An optional action rendered inside the first-run empty state (no data and no
     * active filters). Typically a "create your first X" CTA. Not shown in the
     * "no results match your filters" empty state, which offers "Clear filters" instead.
     */
    emptyStateAction?: React.ReactNode;
    /**
     * @description
     * An optional illustration rendered in the first-run empty state (no data and no
     * active filters). Defaults to the generic empty-collection illustration. Pass a
     * scenario illustration such as `NoProductsIllustration` when one matches.
     */
    emptyStateIllustration?: React.ReactNode;
    /**
     * @description
     * An optional title rendered in the table's header band. Intended for tables
     * embedded in detail pages (e.g. "Product variants"), where the surrounding
     * page block no longer provides a card title of its own.
     *
     * @since 3.8.0
     */
    title?: React.ReactNode;
    /**
     * @description
     * Optional action buttons (e.g. a "Manage variants" CTA) rendered in the
     * table's header band, next to the view-options and refresh controls.
     *
     * @since 3.8.0
     */
    actions?: React.ReactNode;
    /**
     * @description
     * The table's frame. `'card'` (default) renders the table on its own card:
     * a header band hosting the controls, the rows flush to the card edges, and
     * a footer band for pagination. `'plain'` renders the same band structure
     * without the card chrome, for a table embedded in an existing card (e.g. a
     * dashboard widget) — the host card must be the direct frame.
     *
     * @default 'card'
     * @since 3.8.0
     */
    frame?: 'card' | 'plain';
    /**
     * @description
     * Extra `<TableRow>`s appended after the data rows — e.g. the order table's
     * subtotal/shipping/total rows. Use the function form to receive the current
     * visible `columnCount` for `colSpan`s. Rendered only alongside real rows,
     * never with the loading or empty states. Takes precedence over `children`,
     * which remains supported for the same purpose.
     *
     * @since 3.8.0
     */
    footerRows?: React.ReactNode | ((ctx: { columnCount: number }) => React.ReactNode);
}

/**
 * @description
 * A data table which includes sorting, filtering, pagination, bulk actions, column controls etc.
 *
 * This is the building block of all data tables in the Dashboard.
 *
 * @docsCategory list-views
 * @docsPage DataTable
 * @since 3.4.0
 * @docsWeight 0
 */
export function DataTable<TData>({
    children,
    columns,
    data,
    totalItems,
    isLoading,
    page,
    itemsPerPage,
    sorting: sortingInitialState,
    columnFilters: filtersInitialState,
    onPageChange,
    onSortChange,
    onFilterChange,
    onSearchTermChange,
    searchPlaceholder,
    onColumnVisibilityChange,
    defaultColumnVisibility,
    facetedFilters,
    disableViewOptions,
    enableViews,
    bulkActions,
    selectedItems,
    onSelectionChange,
    selectionStorageKey,
    rowCountKey,
    skeletonCells,
    rowLinks,
    setTableOptions,
    onRefresh,
    onReorder,
    disableDragAndDrop = false,
    emptyStateAction,
    emptyStateIllustration,
    title,
    actions,
    frame = 'card',
    footerRows,
}: Readonly<DataTableProps<TData>>) {
    const [sorting, setSorting] = React.useState<SortingState>(sortingInitialState || []);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(filtersInitialState || []);
    const [searchTerm, setSearchTerm] = React.useState<string>('');
    const { activeChannel } = useChannel();
    const { pageId } = usePage();
    const { t } = useLingui();
    const [pagination, setPagination] = React.useState<PaginationState>(() =>
        createPaginationState(page, itemsPerPage),
    );
    const paginationPropsKey = `${page ?? ''}:${itemsPerPage ?? ''}`;
    const [lastPaginationPropsKey, setLastPaginationPropsKey] = React.useState(paginationPropsKey);
    if (lastPaginationPropsKey !== paginationPropsKey) {
        setLastPaginationPropsKey(paginationPropsKey);
        setPagination(current => syncPaginationState(current, page, itemsPerPage));
    }
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
        defaultColumnVisibility ?? {},
    );
    const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
    const rowSelectionRef = useRef<RowSelectionState>(rowSelection);
    const selectedItemsCache = useRef<Map<string, TData>>(new Map());
    // The faceted filter picked from the unified Filter menu, while its popup
    // is open. Once it has a value, its chip opens it again.
    const [openFacetedFilterKey, setOpenFacetedFilterKey] = React.useState<string | null>(null);
    const prevSearchTermRef = useRef(searchTerm);
    const prevColumnFiltersRef = useRef(columnFilters);

    // The TanStack table instance is created inside the @vendure-io/ui DataTable
    // molecule. The ref feeds change callbacks without causing renders; the state
    // copy feeds the DataTableProvider so saved-view components can reach it.
    const tableRef = useRef<TableType<TData>>(undefined as any);
    const [tableInstance, setTableInstance] = React.useState<TableType<TData>>();
    const handleTableReady = (table: TableType<TData>) => {
        tableRef.current = table;
        setTableInstance(table);
    };

    const selectedItemIds = selectedItems?.map(item => getRowItemId(item)).join(',');

    useEffect(() => {
        if (!selectedItems) return;

        selectedItems.forEach(item => {
            selectedItemsCache.current.set(getRowItemId(item), item);
        });
        const nextSelection = Object.fromEntries(selectedItems.map(item => [getRowItemId(item), true]));
        rowSelectionRef.current = nextSelection;
        setRowSelection(nextSelection);
    }, [selectedItemIds]);

    const handleRowSelectionChange = (
        updater: RowSelectionState | ((previous: RowSelectionState) => RowSelectionState),
    ) => {
        const nextSelection = typeof updater === 'function' ? updater(rowSelectionRef.current) : updater;

        data.forEach(item => {
            const id = getRowItemId(item);
            if (nextSelection[id]) {
                selectedItemsCache.current.set(id, item);
            }
        });
        for (const id of selectedItemsCache.current.keys()) {
            if (!nextSelection[id]) {
                selectedItemsCache.current.delete(id);
            }
        }
        rowSelectionRef.current = nextSelection;
        setRowSelection(nextSelection);
        onSelectionChange?.(
            Object.keys(nextSelection)
                .map(id => selectedItemsCache.current.get(id))
                .filter((item): item is TData => item !== undefined),
        );
    };

    const { sensors, localData, handleDragEnd, itemIds } = useDragAndDrop({
        data,
        onReorder,
        disabled: disableDragAndDrop,
        onError: error => {
            toast.error(t`Failed to reorder items`);
        },
    });

    // Track the last-applied `defaultColumnVisibility` content so we only reset state
    // when the prop's actual content changes (e.g. the user reset the table settings),
    // not on every re-render where the parent passes a new reference to the same value.
    const lastAppliedDefaultRef = useRef<string | undefined>(
        defaultColumnVisibility ? JSON.stringify(defaultColumnVisibility) : undefined,
    );
    useEffect(() => {
        if (!defaultColumnVisibility) return;
        const serialized = JSON.stringify(defaultColumnVisibility);
        if (lastAppliedDefaultRef.current === serialized) return;
        lastAppliedDefaultRef.current = serialized;
        setColumnVisibility(defaultColumnVisibility);
    }, [defaultColumnVisibility]);

    const isDragDisabled = disableDragAndDrop || !onReorder;
    const isDraggableEnabled = !isDragDisabled;

    // The molecule injects its own selection column (identical treatment to the
    // one generated by use-generated-columns) when its rowSelection config is
    // wired, keyed to the same 'selection' id so column order/visibility
    // settings keep working. Strip the generated one to avoid a duplicate id,
    // and use its presence as the signal that this table is selectable.
    const hasSelectionColumn = useMemo(() => columns.some(c => c.id === 'selection'), [columns]);
    const bridgeColumns = useMemo(() => {
        const dataColumns = hasSelectionColumn ? columns.filter(c => c.id !== 'selection') : columns;
        if (isDraggableEnabled) {
            const dragHandleColumn: ColumnDef<TData, any> = {
                id: DRAG_HANDLE_COLUMN_ID,
                header: '',
                cell: () => null, // Rendered by DraggableRow
                size: 40,
                enableSorting: false,
                enableHiding: false,
            };
            return [dragHandleColumn, ...dataColumns];
        }
        return dataColumns;
    }, [columns, hasSelectionColumn, isDraggableEnabled]);

    useEffect(() => {
        onPageChange?.(tableRef.current, pagination.pageIndex + 1, pagination.pageSize);
    }, [pagination]);

    useEffect(() => {
        onSortChange?.(tableRef.current, sorting);
    }, [sorting]);

    useEffect(() => {
        onColumnVisibilityChange?.(tableRef.current, columnVisibility);
    }, [columnVisibility]);

    useEffect(() => {
        if (page && page > 1 && itemsPerPage && prevSearchTermRef.current !== searchTerm) {
            // Set the page back to 1 when searchTerm changes
            setPagination({
                ...pagination,
                pageIndex: 0,
            });
        }
        prevSearchTermRef.current = searchTerm;
    }, [onPageChange, searchTerm]);

    useEffect(() => {
        onFilterChange?.(tableRef.current, columnFilters);
        if (
            page &&
            page > 1 &&
            itemsPerPage &&
            JSON.stringify(prevColumnFiltersRef.current) !== JSON.stringify(columnFilters)
        ) {
            // Set the page back to 1 when filters change
            setPagination({
                ...pagination,
                pageIndex: 0,
            });
        }
        prevColumnFiltersRef.current = columnFilters;
    }, [columnFilters]);

    const handleSearchChange = (value: string) => {
        setSearchTerm(value);
        onSearchTermChange?.(value);
    };

    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';
    const { getTranslatedFieldName } = useDynamicTranslations();
    // Distinguishes the two empty states: `hasActiveFilters` means data may
    // exist but the current query hides it (offer clear-filters), otherwise
    // it's a genuine first-run empty (neutral message; the surrounding page
    // owns any create action, so the table can't teach it).
    const hasActiveFilters = columnFilters.length > 0 || searchTerm.trim().length > 0;
    const clearFiltersAndSearch = () => {
        setColumnFilters([]);
        handleSearchChange('');
    };

    // The text a faceted filter reports for its selected values ("Draft, Active"),
    // shown in its chip.
    const [facetedValueLabels, setFacetedValueLabels] = React.useState<Record<string, string | undefined>>(
        {},
    );
    const reportFacetedValueLabel = React.useCallback((key: string, label: string | undefined) => {
        setFacetedValueLabels(old => (old[key] === label ? old : { ...old, [key]: label }));
    }, []);
    // Keyed on the filter keys: pages pass a new `facetedFilters` object each render.
    const facetedKeys = Object.keys(facetedFilters ?? {}).join('\n');
    const facetedValueLabelReporters = useMemo(
        () =>
            Object.fromEntries(
                facetedKeys
                    .split('\n')
                    .filter(Boolean)
                    .map(key => [key, (label: string | undefined) => reportFacetedValueLabel(key, label)]),
            ),
        [facetedKeys, reportFacetedValueLabel],
    );
    // A faceted filter picked from the Filter menu has no chip until it has a
    // value, so its popup lines up with the menu's button.
    const addFilterTriggerRef = useRef<HTMLButtonElement>(null);

    // Sorting and column visibility, which the dashboard renders its own UI for
    // (sort headers, view options), are wired directly into the table options
    // instead of the molecule's capability configs — passing those configs would
    // make the molecule render a second, parallel UI. Filters go through the
    // molecule's `filters` config: it draws the applied-filter chips. The
    // consumer's setTableOptions is applied last, preserving its full-control
    // contract.
    const bridgeSetTableOptions = (options: TableOptions<TData>): TableOptions<TData> => {
        let merged: TableOptions<TData> = {
            ...options,
            enableSorting: true,
            manualSorting: true,
            onSortingChange: setSorting,
            onColumnVisibilityChange: setColumnVisibility,
            state: {
                ...options.state,
                sorting,
                columnVisibility,
            },
        };
        if (typeof setTableOptions === 'function') {
            merged = setTableOptions(merged);
        }
        return merged;
    };

    const showViewsControls = !!enableViews && !!pageId && !!onFilterChange;
    const hasHeaderControls = actions != null || !disableViewOptions || onRefresh != null;
    const hasFacetedFilters = Object.keys(facetedFilters ?? {}).length > 0;
    const hasSearchOrFilter = onSearchTermChange != null || onFilterChange != null || hasFacetedFilters;
    // With a title (a table embedded in a detail-page card), every tool sits in
    // one group on the right of the title. Without a title, the tools share the
    // toolbar row with the view tabs. The molecule draws the applied-filter
    // chips below either.
    const toolsInHeader = title != null;
    const hasToolbarContent = !toolsInHeader && (hasSearchOrFilter || showViewsControls || hasHeaderControls);

    const renderFacetedEditor = (
        key: string,
        props: {
            anchor: React.RefObject<HTMLElement | null>;
            open: boolean;
            onOpenChange: (open: boolean) => void;
        },
    ) => {
        const filter = facetedFilters?.[key];
        const table = tableInstance;
        if (!filter || !table) return null;
        const FilterComponent = filter.component ?? DataTableFacetedFilter;
        return (
            <Suspense>
                <FilterComponent
                    column={table.getColumn(key) as any}
                    title={filter.title}
                    options={filter.options}
                    optionsFn={filter.optionsFn}
                    icon={filter.icon}
                    anchor={props.anchor}
                    open={props.open}
                    onOpenChange={props.onOpenChange}
                    onValueLabelChange={facetedValueLabelReporters[key]}
                />
            </Suspense>
        );
    };

    // Until a faceted filter reports its label (a custom component may never do so),
    // its chip names the value or counts the values.
    const facetedValueFallback = (value: unknown) => {
        if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : t`${value.length} selected`;
        if (value && typeof value === 'object') return Object.values(value).map(String).join(', ');
        return '';
    };

    // One entry per applied filter: the chip text and the editor its chip opens.
    const filterColumns: DataTableFilterColumn<TData>[] = columnFilters.map(filter => {
        const faceted = facetedFilters?.[filter.id];
        if (faceted) {
            return {
                id: filter.id,
                label: faceted.title,
                formatChip: () => (
                    <>
                        {faceted.title}{' '}
                        <span className="text-muted-foreground">
                            {facetedValueLabels[filter.id] ?? facetedValueFallback(filter.value)}
                        </span>
                    </>
                ),
                renderEditor: ctx => renderFacetedEditor(filter.id, ctx),
            };
        }
        const column = tableInstance?.getColumn(filter.id);
        return {
            id: filter.id,
            label: getTranslatedFieldName(filter.id),
            formatChip: () => (
                <DataTableFilterChipLabel
                    filter={filter}
                    currencyCode={currencyCode}
                    dataType={(column?.columnDef.meta as any)?.fieldInfo?.type ?? 'String'}
                />
            ),
            renderEditor: ctx => (
                <DataTableFilterEditor column={column} open={ctx.open} onOpenChange={ctx.onOpenChange} />
            ),
        };
    });

    const renderTools = (table: TableType<TData> | undefined) => {
        const showFilterMenu = !!table && (onFilterChange != null || hasFacetedFilters);
        const showSettings = !!table && hasHeaderControls;
        return (
            <div className="flex flex-wrap items-center justify-end gap-2">
                {onSearchTermChange && (
                    <Input
                        placeholder={searchPlaceholder ?? t`Search...`}
                        value={searchTerm}
                        onChange={event => handleSearchChange(event.target.value)}
                        className="w-full @sm/table:w-64"
                    />
                )}
                {/* The tools of one kind (filter, page actions, settings) are one joined group. */}
                {(showFilterMenu || showSettings || actions != null) && (
                    <ButtonGroup>
                        {table && showFilterMenu && (
                            <AddFilterMenu
                                columns={onFilterChange ? table.getAllColumns() : []}
                                facetedFilters={facetedFilters}
                                onSelectFacetedFilter={setOpenFacetedFilterKey}
                                triggerRef={addFilterTriggerRef}
                            />
                        )}
                        {actions}
                        {table && showSettings && (
                            <DataTableSettingsMenu
                                table={table}
                                disableViewOptions={disableViewOptions}
                                onRefresh={onRefresh}
                                isLoading={isLoading}
                            />
                        )}
                    </ButtonGroup>
                )}
                {/* A faceted filter picked from the Filter menu. Its popup has no
                trigger of its own and stays open while the first values are
                picked, after its chip appears. */}
                {openFacetedFilterKey &&
                    renderFacetedEditor(openFacetedFilterKey, {
                        anchor: addFilterTriggerRef,
                        open: true,
                        onOpenChange: open => {
                            if (!open) setOpenFacetedFilterKey(null);
                        },
                    })}
            </div>
        );
    };

    const renderToolbar = (table: TableType<TData>) => {
        return (
            <div className="flex flex-col gap-2 w-full">
                {/* One band: view tabs anchor the left, search/filter/settings group
                    on the right — mirroring the tabs-left, tools-right layout of
                    index tables elsewhere, and avoiding a dead middle. */}
                {!toolsInHeader && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* As tall as the view tabs, also before the saved views load
                            and when the server has none, so the toolbar keeps its height. */}
                        <div className={cn('min-w-0 flex-1', showViewsControls && 'min-h-9')}>
                            {showViewsControls && <DataTableViewsTabs />}
                        </div>
                        {renderTools(table)}
                    </div>
                )}
            </div>
        );
    };

    const emptyState = hasActiveFilters ? (
        <EmptyState
            className="border-0 rounded-none bg-transparent"
            illustration={<NoResultsIllustration />}
            title={<Trans>No results</Trans>}
            description={<Trans>No items match your current filters. Try clearing them to see more.</Trans>}
        >
            <Button variant="outline" size="sm" onClick={clearFiltersAndSearch}>
                <Trans>Clear filters</Trans>
            </Button>
        </EmptyState>
    ) : (
        <EmptyState
            className="border-0 rounded-none bg-transparent"
            illustration={emptyStateIllustration ?? <EmptyCollectionIllustration />}
            title={<Trans>No results</Trans>}
            description={<Trans>There are no items to display yet.</Trans>}
        >
            {emptyStateAction}
        </EmptyState>
    );

    return (
        <DataTableProvider
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            sorting={sorting}
            setSorting={setSorting}
            pageId={pageId}
            onFilterChange={onFilterChange}
            onSearchTermChange={onSearchTermChange}
            onRefresh={onRefresh}
            isLoading={isLoading}
            table={tableInstance}
        >
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis]}
            >
                <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                    <UiDataTable<TData>
                        className="@container/table"
                        rows={localData}
                        columns={bridgeColumns}
                        getRowId={row => (row as { id: string }).id}
                        onTableReady={handleTableReady}
                        isLoading={isLoading}
                        skeletonRowCount={Math.min(pagination.pageSize, MAX_SKELETON_ROWS)}
                        rowCountKey={rowCountKey}
                        skeletonCells={skeletonCells}
                        rowLinks={rowLinks}
                        frame={frame}
                        pagination={
                            onPageChange && totalItems != null
                                ? {
                                      page: pagination.pageIndex + 1,
                                      pageSize: pagination.pageSize,
                                      totalItems,
                                      onPageChange: nextPage =>
                                          setPagination(old => ({ ...old, pageIndex: nextPage - 1 })),
                                      onPageSizeChange: nextSize =>
                                          setPagination(old => ({ ...old, pageSize: nextSize })),
                                      // The dashboard's established options (not the molecule's
                                      // [10, 25, 50, 100] default) — stored page sizes like 20
                                      // must stay selectable.
                                      pageSizeOptions: [10, 20, 30, 40, 50],
                                  }
                                : undefined
                        }
                        selectionStorageKey={hasSelectionColumn ? selectionStorageKey : undefined}
                        rowSelection={
                            hasSelectionColumn
                                ? {
                                      value: rowSelection,
                                      onChange: handleRowSelectionChange,
                                      selectColumnId: 'selection',
                                  }
                                : undefined
                        }
                        header={
                            title != null ? (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <CardTitle>{title}</CardTitle>
                                    {(hasHeaderControls || hasSearchOrFilter) && renderTools(tableInstance)}
                                </div>
                            ) : undefined
                        }
                        toolbar={hasToolbarContent ? renderToolbar : undefined}
                        filters={{
                            value: columnFilters,
                            onChange: setColumnFilters,
                            columns: filterColumns,
                            // The dashboard's own Filter menu adds filters.
                            showAddFilter: false,
                            clearFilters: true,
                        }}
                        bulkActions={
                            hasSelectionColumn && bulkActions !== false
                                ? ctx => (
                                      <DataTableBulkActions
                                          bulkActions={bulkActions ?? []}
                                          table={ctx.table}
                                          selectedItems={
                                              selectedItems
                                                  ? [...ctx.selection, ...selectedItems]
                                                  : ctx.selection
                                          }
                                          selectedRowIds={ctx.selectedRowIds}
                                      />
                                  )
                                : undefined
                        }
                        emptyState={emptyState}
                        renderRow={(
                            row,
                            { table, columnCount, defaultRow, ripple, cellProps, selectProps },
                        ) => {
                            const tableMeta = table.options.meta as any;
                            // Utility rows (e.g. the draft order's "add item" row) span
                            // the full visible width and render custom content.
                            if (tableMeta?.isUtilityRow?.(row) && tableMeta.renderUtilityRow) {
                                return (
                                    <TableRow>
                                        <TableCell colSpan={columnCount}>
                                            {tableMeta.renderUtilityRow(row)}
                                        </TableCell>
                                    </TableRow>
                                );
                            }
                            if (isDraggableEnabled) {
                                return (
                                    <DraggableRow
                                        row={row}
                                        getRowCanDrag={tableMeta?.getRowCanDrag}
                                        ripple={ripple}
                                        cellProps={cellProps}
                                        selectProps={selectProps}
                                    />
                                );
                            }
                            return defaultRow;
                        }}
                        footerRows={footerRows ?? (children != null ? children : undefined)}
                        setTableOptions={bridgeSetTableOptions}
                        labels={{
                            selectAllRows: t`Select all rows`,
                            selectAllOnPage: t`Select all on this page`,
                            clearPageSelection: t`Clear selection on this page`,
                            selectRow: () => t`Select row`,
                            clearFilters: t`Clear filters`,
                            removeFilter: label => t`Remove ${label} filter`,
                            filtersCollapsed: count => t`${count} filters`,
                            pagination: {
                                navLabel: t`Pagination`,
                                previousLabel: t`Go to previous page`,
                                nextLabel: t`Go to next page`,
                                pageSizeLabel: t`Rows per page`,
                            },
                        }}
                    />
                </SortableContext>
            </DndContext>
        </DataTableProvider>
    );
}
