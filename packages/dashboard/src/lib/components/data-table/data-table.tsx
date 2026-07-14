import { DataTablePagination } from '@/vdb/components/data-table/data-table-pagination.js';
import { DataTableViewOptions } from '@/vdb/components/data-table/data-table-view-options.js';
import { GlobalViewsBar } from '@/vdb/components/data-table/global-views-bar.js';
import { MyViewsButton } from '@/vdb/components/data-table/my-views-button.js';
import { RefreshButton } from '@/vdb/components/data-table/refresh-button.js';
import { SaveViewButton } from '@/vdb/components/data-table/save-view-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useSavedViews } from '@/vdb/hooks/use-saved-views.js';
import { Trans, useLingui } from '@lingui/react/macro';
import {
    closestCenter,
    DndContext,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ColumnDef,
    ColumnFilter,
    ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    PaginationState,
    Row,
    SortingState,
    Table as TableType,
    useReactTable,
    VisibilityState,
} from '@tanstack/react-table';
import { RowSelectionState, TableOptions } from '@tanstack/table-core';
import { GripVertical } from 'lucide-react';
import React, { Suspense, useEffect, useId, useMemo, useRef } from 'react';
import { Separator } from '@/vdb/components/ui/separator.js';
import { cn } from '@/vdb/lib/utils.js';
import { ActiveFiltersPopover } from './data-table-active-filters-popover.js';
import { AddFilterMenu } from './add-filter-menu.js';
import { DataTableBulkActions } from './data-table-bulk-actions.js';
import { DataTableProvider } from './data-table-context.js';
import {
    DataTableFacetedFilter,
    DataTableFacetedFilterOption,
    DataTableFacetedFilterProps,
} from './data-table-faceted-filter.js';
import { DataTableFilterBadgeEditable } from './data-table-filter-badge-editable.js';
import { useDragAndDrop } from '@/vdb/hooks/use-drag-and-drop.js';
import { toast } from '@/vdb/components/ui/sonner.js';

// Layout constants used to reserve space and render skeletons during the
// initial fetch. Row height matches the `h-12` class used on every TableCell
// in this file (3rem). Header height matches the default `<TableHead>`
// styling from `@vendure-io/ui` (h-10 = 2.5rem). Skeleton rows are capped
// at `MAX_SKELETON_ROWS` so a large pageSize doesn't bloat the DOM.
const ROW_HEIGHT_REM = 3;
const HEADER_HEIGHT_REM = 2.5;
const MAX_SKELETON_ROWS = 10;

interface DraggableRowProps<TData> {
    row: Row<TData>;
    isDragDisabled: boolean;
    getRowCanDrag?: (row: Row<TData>) => boolean;
}

function DraggableRow<TData>({ row, isDragDisabled, getRowCanDrag }: Readonly<DraggableRowProps<TData>>) {
    // Check if this specific row can be dragged
    const rowCanDrag = getRowCanDrag ? getRowCanDrag(row) : true;
    const isRowDragDisabled = isDragDisabled || !rowCanDrag;

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.id,
        disabled: isRowDragDisabled,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <TableRow
            ref={setNodeRef}
            style={style}
            data-state={row.getIsSelected() && 'selected'}
            className="animate-in fade-in duration-100"
        >
            {!isDragDisabled && (
                <TableCell className="w-[40px] h-12">
                    {rowCanDrag ? (
                        <div
                            {...attributes}
                            {...listeners}
                            className="cursor-move text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <GripVertical className="h-4 w-4" />
                        </div>
                    ) : null}
                </TableCell>
            )}
            {row.getVisibleCells().filter(cell => cell.column.id !== '__drag_handle__').map(cell => (
                <TableCell key={cell.id} className="h-12">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
            ))}
        </TableRow>
    );
}

const INLINE_FILTER_BADGE_LIMIT = 2;

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
    defaultColumnVisibility?: VisibilityState;
    facetedFilters?: { [key: string]: FacetedFilter | undefined };
    disableViewOptions?: boolean;
    bulkActions?: BulkActionsInput;
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
    onColumnVisibilityChange,
    defaultColumnVisibility,
    facetedFilters,
    disableViewOptions,
    bulkActions,
    setTableOptions,
    onRefresh,
    onReorder,
    disableDragAndDrop = false,
}: Readonly<DataTableProps<TData>>) {
    const [sorting, setSorting] = React.useState<SortingState>(sortingInitialState || []);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(filtersInitialState || []);
    const [searchTerm, setSearchTerm] = React.useState<string>('');
    const { activeChannel } = useChannel();
    const { pageId } = usePage();
    const savedViewsResult = useSavedViews();
    const globalViews = pageId && onFilterChange ? savedViewsResult.globalViews : [];
    const { t } = useLingui();
    const [pagination, setPagination] = React.useState<PaginationState>({
        pageIndex: (page ?? 1) - 1,
        pageSize: itemsPerPage ?? 10,
    });
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
        defaultColumnVisibility ?? {},
    );
    const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
    const prevSearchTermRef = useRef(searchTerm);
    const prevColumnFiltersRef = useRef(columnFilters);

    const componentId = useId();
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

    // Add drag handle column if drag and drop is enabled
    const columnsWithOptionalDragHandle = useMemo(() => {
        if (!disableDragAndDrop && onReorder) {
            const dragHandleColumn: ColumnDef<TData, any> = {
                id: '__drag_handle__',
                header: '',
                cell: () => null, // Rendered by DraggableRow
                size: 40,
                enableSorting: false,
                enableHiding: false,
            };
            return [dragHandleColumn, ...columns];
        }
        return columns;
    }, [columns, disableDragAndDrop, onReorder]);

    let tableOptions: TableOptions<TData> = {
        data: localData,
        columns: columnsWithOptionalDragHandle,
        getRowId: row => (row as { id: string }).id,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
        rowCount: totalItems,
        onPaginationChange: setPagination,
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnFiltersChange: setColumnFilters,
        onRowSelectionChange: setRowSelection,
        state: {
            pagination,
            sorting,
            columnVisibility,
            columnFilters,
            rowSelection,
        },
    };

    if (typeof setTableOptions === 'function') {
        tableOptions = setTableOptions(tableOptions);
    }

    const table = useReactTable(tableOptions);

    useEffect(() => {
        onPageChange?.(table, pagination.pageIndex + 1, pagination.pageSize);
    }, [pagination]);

    useEffect(() => {
        onSortChange?.(table, sorting);
    }, [sorting]);

    useEffect(() => {
        onColumnVisibilityChange?.(table, columnVisibility);
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
        onFilterChange?.(table, columnFilters);
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

    const visibleColumnCount = Object.values(columnVisibility).filter(Boolean).length;

    const isDragDisabled = disableDragAndDrop || !onReorder;
    const hasSelection = Object.keys(rowSelection).length > 0;
    const nonFacetedFilters = columnFilters.filter(f => !facetedFilters?.[f.id]);
    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';
    const clearNonFacetedFilters = () => setColumnFilters(old => old.filter(f => !!facetedFilters?.[f.id]));

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
            table={table}
        >
            <div className="space-y-2 @container/table">
                <div className="relative">
                    <div className={cn(
                        "flex flex-wrap items-start justify-between gap-2 transition-opacity duration-150",
                        hasSelection && "opacity-0 pointer-events-none"
                    )}>
                        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                            {onSearchTermChange && (
                                <Input
                                    placeholder={t`Filter...`}
                                    value={searchTerm}
                                    onChange={event => handleSearchChange(event.target.value)}
                                    className="h-8 w-full @sm/table:w-64"
                                />
                            )}
                            <Suspense>
                                {Object.entries(facetedFilters ?? {}).map(([key, filter]) => {
                                    const FilterComponent = filter?.component ?? DataTableFacetedFilter;
                                    return (
                                        <FilterComponent
                                            key={key}
                                            column={table.getColumn(key) as any}
                                            title={filter?.title}
                                            options={filter?.options}
                                            optionsFn={filter?.optionsFn}
                                            icon={filter?.icon}
                                        />
                                    );
                                })}
                            </Suspense>
                            {onFilterChange && <AddFilterMenu columns={table.getAllColumns()} />}
                            {pageId && onFilterChange && <MyViewsButton />}
                            {pageId && onFilterChange && globalViews.length > 0 && (
                                <div className="hidden @md/table:contents">
                                    <GlobalViewsBar />
                                </div>
                            )}
                            {nonFacetedFilters.length > 0 && (
                                <>
                                    <Separator orientation="vertical" className="self-stretch" />
                                    {nonFacetedFilters.length <= INLINE_FILTER_BADGE_LIMIT ? (
                                        <>
                                            {nonFacetedFilters.map(f => {
                                                const column = table.getColumn(f.id);
                                                return (
                                                    <DataTableFilterBadgeEditable
                                                        key={f.id}
                                                        filter={f}
                                                        column={column}
                                                        currencyCode={currencyCode}
                                                        dataType={
                                                            (column?.columnDef.meta as any)?.fieldInfo?.type ?? 'String'
                                                        }
                                                        onRemove={() =>
                                                            setColumnFilters(old => old.filter(x => x.id !== f.id))
                                                        }
                                                    />
                                                );
                                            })}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={clearNonFacetedFilters}
                                                className="text-xs opacity-60 hover:opacity-100"
                                            >
                                                <Trans>Clear all</Trans>
                                            </Button>
                                        </>
                                    ) : (
                                        <ActiveFiltersPopover
                                            filters={nonFacetedFilters}
                                            table={table}
                                            currencyCode={currencyCode}
                                            onRemoveFilter={id => setColumnFilters(old => old.filter(x => x.id !== id))}
                                            onClearAll={clearNonFacetedFilters}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {pageId && onFilterChange && <SaveViewButton />}
                            {!disableViewOptions && <DataTableViewOptions table={table} />}
                            {onRefresh && <RefreshButton onRefresh={onRefresh} isLoading={isLoading ?? false} />}
                        </div>
                    </div>
                    <DataTableBulkActions bulkActions={bulkActions ?? []} table={table} />
                </div>

                <div
                    className="rounded-md border my-2 relative bg-card"
                    // While the initial fetch is in flight (no data yet) reserve
                    // vertical space for the skeleton rows so the table footer /
                    // pagination controls don't jump up. Once we have any data —
                    // even one row — let the table size to its content so small
                    // result sets don't render with a huge empty container.
                    style={
                        isLoading && !localData?.length
                            ? {
                                  minHeight: `calc(${Math.min(
                                      pagination.pageSize,
                                      MAX_SKELETON_ROWS,
                                  )} * ${ROW_HEIGHT_REM}rem + ${HEADER_HEIGHT_REM}rem)`,
                              }
                            : undefined
                    }
                >
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis]}
                    >
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map(headerGroup => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map(header => {
                                            return (
                                                <TableHead key={header.id}>
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                              header.column.columnDef.header,
                                                              header.getContext(),
                                                          )}
                                                </TableHead>
                                            );
                                        })}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                                <TableBody>
                                    {isLoading && !localData?.length ? (
                                        Array.from({
                                            length: Math.min(pagination.pageSize, MAX_SKELETON_ROWS),
                                        }).map((_, index) => (
                                            <TableRow
                                                key={`skeleton-${index}`}
                                                className="animate-in fade-in duration-100"
                                            >
                                                {!isDragDisabled && (
                                                    <TableCell className="w-[40px] h-12">
                                                        <Skeleton className="h-4 w-4" />
                                                    </TableCell>
                                                )}
                                                {Array.from({ length: visibleColumnCount }).map((_, cellIndex) => (
                                                    <TableCell
                                                        key={`skeleton-cell-${index}-${cellIndex}`}
                                                        className="h-12"
                                                    >
                                                        <Skeleton className="h-4 my-2 w-full" />
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))
                                    ) : table.getRowModel().rows?.length ? (
                                        (() => {
                                            const isDraggableEnabled = onReorder && !isDragDisabled;
                                            const rows = table.getRowModel().rows;
                                            const tableMeta = table.options.meta as any;
                                            const getRowCanDrag = tableMeta?.getRowCanDrag;
                                            const renderUtilityRow = tableMeta?.renderUtilityRow;
                                            const isUtilityRow = tableMeta?.isUtilityRow;
                                            const totalColumns = columnsWithOptionalDragHandle.length;

                                            const renderRow = (row: Row<TData>) => {
                                                // Check if this is a utility row that needs custom rendering
                                                if (isUtilityRow?.(row) && renderUtilityRow) {
                                                    return (
                                                        <TableRow
                                                            key={row.id}
                                                            className="animate-in fade-in duration-100"
                                                        >
                                                            <TableCell
                                                                colSpan={totalColumns}
                                                                className="h-12"
                                                            >
                                                                {renderUtilityRow(row)}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                }

                                                if (isDraggableEnabled) {
                                                    return (
                                                        <DraggableRow
                                                            key={`${row.id}-${componentId}`}
                                                            row={row}
                                                            isDragDisabled={isDragDisabled}
                                                            getRowCanDrag={getRowCanDrag}
                                                        />
                                                    );
                                                }

                                                return (
                                                    <TableRow
                                                        key={row.id}
                                                        data-state={row.getIsSelected() && 'selected'}
                                                        className="animate-in fade-in duration-100"
                                                    >
                                                        {row.getVisibleCells().map(cell => (
                                                            <TableCell key={cell.id} className="h-12">
                                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                );
                                            };

                                            return rows.map(renderRow);
                                        })()
                                    ) : (
                                        <TableRow className="animate-in fade-in duration-100">
                                            <TableCell
                                                colSpan={columnsWithOptionalDragHandle.length}
                                                className="h-24 text-center"
                                            >
                                                <Trans>No results</Trans>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {children}
                                </TableBody>
                            </SortableContext>
                        </Table>
                    </DndContext>
                </div>
                {onPageChange && totalItems != null && <DataTablePagination table={table} />}
            </div>
        </DataTableProvider>
    );
}
