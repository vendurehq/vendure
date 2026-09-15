import { useAllBulkActions } from '@/vdb/components/data-table/use-all-bulk-actions.js';
import { DisplayComponent } from '@/vdb/framework/component-registry/display-component.js';
import {
    FieldInfo,
    getOperationVariablesFields,
    getTypeFieldInfo,
    isEnumType,
} from '@/vdb/framework/document-introspection/get-document-structure.js';
import {
    generateDisplayComponentKey,
    getDisplayComponent,
} from '@/vdb/framework/extension-api/display-component-extensions.js';
import { BulkActionGroup, BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { api } from '@/vdb/graphql/api.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import {
    AccessorFnColumnDef,
    AccessorKeyColumnDef,
    CellContext,
    ColumnDef,
    createColumnHelper,
    flexRender,
    Row,
} from '@tanstack/react-table';
import { EllipsisIcon, TrashIcon } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';
import { toast } from '@/vdb/components/ui/sonner.js';
import {
    AdditionalColumns,
    AllItemFieldKeys,
    CustomizeColumnConfig,
    FacetedFilterConfig,
    PaginatedListItemFields,
    RowAction,
} from '../shared/paginated-list-data-table.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '../ui/alert-dialog.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { DataTableColumnHeader } from './data-table-column-header.js';

/**
 * @description
 * This hook is used to generate the columns for a data table, combining the fields
 * from the query with the additional columns and the custom fields.
 *
 * It also
 * - adds the row actions and the delete mutation.
 * - adds the row selection column.
 * - adds the custom field columns.
 */
export function useGeneratedColumns<T extends TypedDocumentNode<any, any>>({
    fields,
    customizeColumns,
    rowActions,
    bulkActions,
    deleteMutation,
    additionalColumns,
    defaultColumnOrder,
    facetedFilters,
    includeSelectionColumn = true,
    includeActionsColumn = true,
    enableSorting = true,
}: Readonly<{
    fields: FieldInfo[];
    customizeColumns?: CustomizeColumnConfig<T>;
    rowActions?: RowAction<PaginatedListItemFields<T>>[];
    bulkActions?: BulkActionsInput;
    deleteMutation?: TypedDocumentNode<any, any>;
    additionalColumns?: AdditionalColumns<T>;
    defaultColumnOrder?: Array<string | number | symbol>;
    facetedFilters?: FacetedFilterConfig<T>;
    includeSelectionColumn?: boolean;
    includeActionsColumn?: boolean;
    enableSorting?: boolean;
}>): {
    columns: Array<AccessorKeyColumnDef<any> | AccessorFnColumnDef<any>>;
    customFieldColumnNames: string[];
} {
    const { pageId } = usePage();
    const pageBlock = usePageBlock();
    const columnHelper = createColumnHelper<PaginatedListItemFields<T>>();
    const allBulkActions = useAllBulkActions(bulkActions ?? []);

    const { columns, customFieldColumnNames } = useMemo(() => {
        const columnConfigs: Array<{ fieldInfo: FieldInfo; isCustomField: boolean }> = [];
        const customFieldColumnNames: string[] = [];

        columnConfigs.push(
            ...fields // Filter out custom fields
                .filter(field => field.name !== 'customFields' && !field.type.endsWith('CustomFields'))
                .map(field => ({ fieldInfo: field, isCustomField: false })),
        );

        const customFieldColumn = fields.find(field => field.name === 'customFields');
        if (customFieldColumn && customFieldColumn.type !== 'JSON') {
            const customFieldFields = getTypeFieldInfo(customFieldColumn.type);
            columnConfigs.push(
                ...customFieldFields.map(field => ({ fieldInfo: field, isCustomField: true })),
            );
            customFieldColumnNames.push(...customFieldFields.map(field => field.name));
        }

        const getDisplayComponentId = (columnId: string) =>
            pageId && pageBlock?.blockId
                ? generateDisplayComponentKey(pageId, pageBlock.blockId, columnId)
                : undefined;

        const queryBasedColumns = columnConfigs.map(({ fieldInfo, isCustomField }) => {
            const customConfig = customizeColumns?.[fieldInfo.name as unknown as AllItemFieldKeys<T>] ?? {};

            const disabled = customConfig.meta?.disabled ?? false;

            if (disabled) {
                return null;
            }

            const { header, meta, cell: customCell, ...customConfigRest } = customConfig;
            const enableColumnFilter =
                (fieldInfo.isScalar || isEnumType(fieldInfo.type)) && !facetedFilters?.[fieldInfo.name];
            const displayComponentId = getDisplayComponentId(fieldInfo.name);

            // A component registered via addDisplayComponent() takes precedence over a
            // core-supplied `cell` function (e.g. the Money cell on price columns). Both
            // paths look the registry up at cell-render time, so a registration made after
            // the column was generated applies on the table's next render.
            //
            // Only the custom-cell branch gets a cached wrapper. The CellWrapper arrow below
            // is a fresh function on every memo run, and flexRender() makes that function the
            // cell's component type, so those cells remount whenever the memo recomputes.
            // That is long-standing behaviour rather than something introduced here, and
            // changing it is out of scope for this fix.
            const cellFn =
                typeof customCell === 'function'
                    ? withDisplayComponentOverride(customCell, displayComponentId)
                    : (cellContext: CellContext<any, any>) => (
                          <CellWrapper
                              cellContext={cellContext}
                              fieldInfo={fieldInfo}
                              isCustomField={isCustomField}
                              displayComponentId={displayComponentId}
                          />
                      );

            return columnHelper.accessor(fieldInfo.name as any, {
                id: fieldInfo.name,
                meta: { fieldInfo, isCustomField, ...(meta ?? {}) },
                enableColumnFilter,
                enableSorting: fieldInfo.isScalar && fieldInfo.type !== 'Boolean' && enableSorting,
                // Filtering is done on the server side, but we set this to 'equalsString' because
                // otherwise the TanStack Table with apply an "auto" function which somehow
                // prevents certain filters from working.
                filterFn: 'equalsString',
                cell: cellFn,
                header: headerContext => {
                    return (
                        <DataTableColumnHeader headerContext={headerContext} customConfig={customConfig} />
                    );
                },
                ...customConfigRest,
            });
        });

        let finalColumns = queryBasedColumns.filter(column => column !== null);

        for (const [id, column] of Object.entries(additionalColumns ?? {})) {
            if (!id) {
                throw new Error('Column id is required');
            }
            const displayComponentId = getDisplayComponentId(id);

            finalColumns.push(
                columnHelper.accessor(id as any, {
                    enableColumnFilter: false,
                    ...column,
                    // Without an id there is nothing to look up, and the column keeps whatever
                    // `cell` it supplied so that TanStack's own default still applies when it
                    // supplied none.
                    ...(displayComponentId
                        ? {
                              cell: withDisplayComponentOverride(
                                  column.cell ?? renderDefaultCell,
                                  displayComponentId,
                              ),
                          }
                        : {}),
                    id,
                }),
            );
        }

        if (defaultColumnOrder) {
            // ensure the columns with ids matching the items in defaultColumnOrder
            // appear as the first columns in sequence, and leave the remainder in the
            // existing order
            const orderedColumns = finalColumns
                .filter(column => column.id && defaultColumnOrder.includes(column.id as any))
                .sort(
                    (a, b) =>
                        defaultColumnOrder.indexOf(a.id as any) - defaultColumnOrder.indexOf(b.id as any),
                );
            const remainingColumns = finalColumns.filter(
                column => !column.id || !defaultColumnOrder.includes(column.id as any),
            );
            finalColumns = [...orderedColumns, ...remainingColumns];
        }

        if (includeActionsColumn && (rowActions || deleteMutation || bulkActions)) {
            const rowActionColumn = getRowActions(rowActions, deleteMutation, allBulkActions);
            if (rowActionColumn) {
                finalColumns.push(rowActionColumn);
            }
        }

        if (includeSelectionColumn) {
            // Add the row selection column
            finalColumns.unshift({
                id: 'selection',
                accessorKey: 'selection',
                header: ({ table }) => (
                    <Checkbox
                        className="mx-1"
                        checked={table.getIsAllRowsSelected()}
                        onCheckedChange={checked =>
                            table.toggleAllRowsSelected(checked)
                        }
                    />
                ),
                enableColumnFilter: false,
                enableHiding: false,
                cell: ({ row }) => {
                    return (
                        <Checkbox
                            className="mx-1"
                            checked={row.getIsSelected()}
                            onCheckedChange={(checked) => row.toggleSelected(!!checked)}
                        />
                    );
                },
            });
        }

        return { columns: finalColumns, customFieldColumnNames };
        // `pageId` and `pageBlock?.blockId` are dependencies because they form the display
        // component registry key, so a column generated under one page or block must not be
        // reused under another.
    }, [
        fields,
        customizeColumns,
        rowActions,
        deleteMutation,
        additionalColumns,
        defaultColumnOrder,
        pageId,
        pageBlock?.blockId,
    ]);

    return { columns, customFieldColumnNames };
}

function getRowActions(
    rowActions?: RowAction<any>[],
    deleteMutation?: TypedDocumentNode<any, any>,
    bulkActionGroups?: BulkActionGroup[],
): AccessorKeyColumnDef<any> | undefined {
    const hasRowActions = rowActions && rowActions.length > 0;
    const hasBulkActions = bulkActionGroups?.some(g => g.actions.length > 0);

    return {
        id: 'actions',
        accessorKey: 'actions',
        header: () => <Trans>Actions</Trans>,
        enableColumnFilter: false,
        enableHiding: false,
        cell: ({ row, table }) => {
            return (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" data-testid="dt-row-actions-trigger" />}>
                            <EllipsisIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-56">
                        {hasRowActions && (
                            <DropdownMenuGroup>
                                {rowActions.map((action, index) => (
                                    <DropdownMenuItem
                                        onClick={() => action.onClick?.(row)}
                                        key={`${action.label}-${index}`}
                                    >
                                        {action.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                        )}
                        {hasBulkActions && bulkActionGroups?.map((group, groupIndex) => {
                            if (group.actions.length === 0) return null;
                            const showSeparator = hasRowActions || groupIndex > 0;
                            return (
                                <div key={`group-${groupIndex}`}>
                                    {showSeparator && <DropdownMenuSeparator />}
                                    <DropdownMenuGroup>
                                        {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                                        {group.actions.map((action, index) => (
                                            <action.component
                                                key={`bulk-action-${groupIndex}-${index}`}
                                                selection={[row.original]}
                                                table={table}
                                            />
                                        ))}
                                    </DropdownMenuGroup>
                                </div>
                            );
                        })}
                        {deleteMutation && (hasRowActions || hasBulkActions) && (
                            <DropdownMenuSeparator />
                        )}
                        {deleteMutation && (
                            <DropdownMenuGroup>
                                <DeleteMutationRowAction deleteMutation={deleteMutation} row={row} />
                            </DropdownMenuGroup>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            );
        },
    };
}

type CellRenderer = (cellContext: CellContext<any, any>) => ReactNode;

// Copied from @tanstack/table-core 8.21 `_getDefaultColumnDef`, used when an additional
// column supplies no `cell` of its own.
const renderDefaultCell: CellRenderer = cellContext => cellContext.renderValue()?.toString?.() ?? null;

/**
 * The value handed to a display component. A custom field's value is not on the row itself,
 * so it is read from `row.original.customFields` instead. Both the CellWrapper path and the
 * withDisplayComponentOverride path resolve it through here, because the point of resolving
 * the registry at render time is that the two paths agree.
 */
function resolveCellValue(
    cellContext: CellContext<any, any>,
    isCustomField: boolean | undefined,
    fieldName: string | undefined,
): any {
    const { cell, row } = cellContext;
    return (
        cell.getValue() ??
        (isCustomField ? (row.original as any)?.customFields?.[fieldName as string] : undefined)
    );
}

const overrideCellCache = new WeakMap<CellRenderer, Map<string, CellRenderer>>();

/**
 * Wraps a cell so that a component registered via addDisplayComponent() is looked up when
 * the cell renders, not when the column is generated. A lookup at generation time would
 * keep a stale answer for as long as the column memo is reused.
 *
 * TanStack's flexRender() renders a function cell as a component, so the wrapper's identity
 * is its component type. Wrappers are cached per cell and key so that a stable `cell`
 * yields a stable wrapper, and the cell does not unmount when the column memo recomputes.
 */
function withDisplayComponentOverride(
    cell: ColumnDef<any>['cell'],
    displayComponentId: string | undefined,
): ColumnDef<any>['cell'] {
    if (!displayComponentId) {
        return cell;
    }
    const render = (cellContext: CellContext<any, any>, fallback: ColumnDef<any>['cell']) => {
        const RegisteredDisplayComponent = getDisplayComponent(displayComponentId);
        if (RegisteredDisplayComponent) {
            const { column } = cellContext;
            const value = resolveCellValue(
                cellContext,
                (column?.columnDef?.meta as { isCustomField?: boolean } | undefined)?.isCustomField,
                column?.id,
            );
            return <RegisteredDisplayComponent value={value} {...cellContext} />;
        }
        return flexRender(fallback, cellContext);
    };
    // A non-function cell holds no state, so a fresh wrapper each time costs nothing beyond
    // re-rendering a static node. Caching it would need a sentinel key, as a WeakMap cannot
    // key on a string.
    if (typeof cell !== 'function') {
        return (cellContext: CellContext<any, any>) => render(cellContext, cell);
    }
    let byKey = overrideCellCache.get(cell);
    if (!byKey) {
        byKey = new Map();
        overrideCellCache.set(cell, byKey);
    }
    let wrapped = byKey.get(displayComponentId);
    if (!wrapped) {
        wrapped = (cellContext: CellContext<any, any>) => render(cellContext, cell);
        byKey.set(displayComponentId, wrapped);
    }
    return wrapped;
}

function DefaultDisplayComponent({ value, fieldInfo }: { value: any; fieldInfo: FieldInfo }) {
    if (fieldInfo.list && Array.isArray(value) && fieldInfo.isScalar) {
        return value.join(', ');
    }
    if ((fieldInfo.type === 'DateTime' && typeof value === 'string') || value instanceof Date) {
        return <DisplayComponent id="vendure:dateTime" value={value} />;
    }
    if (fieldInfo.type === 'Boolean') {
        if (fieldInfo.name === 'enabled') {
            return <DisplayComponent id="vendure:booleanBadge" value={value} />;
        } else {
            return <DisplayComponent id="vendure:booleanCheckbox" value={value} />;
        }
    }
    if (fieldInfo.type === 'Asset') {
        return <DisplayComponent id="vendure:asset" value={value} />;
    }
    if (value !== null && typeof value === 'object') {
        return <DisplayComponent id="vendure:json" value={value} />;
    }
    return value;
}

/**
 * A cell wrapper component for columns without custom cell functions.
 * Handles default display logic including custom display components and field-type-based rendering.
 */
const CellWrapper = memo(function CellWrapper({
    cellContext,
    fieldInfo,
    isCustomField,
    displayComponentId,
}: {
    cellContext: CellContext<any, any>;
    fieldInfo: FieldInfo;
    isCustomField: boolean;
    displayComponentId?: string;
}) {
    const value = resolveCellValue(cellContext, isCustomField, fieldInfo.name);

    const CustomDisplayComponent = displayComponentId && getDisplayComponent(displayComponentId);

    if (CustomDisplayComponent) {
        return <CustomDisplayComponent value={value} {...cellContext} />;
    }
    return <DefaultDisplayComponent value={value} fieldInfo={fieldInfo} />;
});

function DeleteMutationRowAction({
    deleteMutation,
    row,
}: Readonly<{
    deleteMutation: TypedDocumentNode<any, any>;
    row: Row<{ id: string }>;
}>) {
    const { refetchPaginatedList } = usePaginatedList();
    const { t } = useLingui();

    // Inspect the mutation variables to determine if it expects 'id' or 'ids'
    const mutationVariables = getOperationVariablesFields(deleteMutation);
    const hasIdsParameter = mutationVariables.some(field => field.name === 'ids');

    const { mutate: deleteMutationFn } = useMutation({
        mutationFn: api.mutate(deleteMutation),
        onSuccess: (result: {
            [key: string]:
                | { result: 'DELETED' | 'NOT_DELETED'; message: string }
                | {
                      result: 'DELETED' | 'NOT_DELETED';
                      message: string;
                  }[];
        }) => {
            const unwrappedResult = Object.values(result)[0];
            // Handle both single result and array of results
            const resultToCheck = Array.isArray(unwrappedResult) ? unwrappedResult[0] : unwrappedResult;
            if (resultToCheck.result === 'DELETED') {
                refetchPaginatedList();
                toast.success(t`Deleted successfully`);
            } else {
                toast.error(t`Failed to delete`, {
                    description: resultToCheck.message,
                });
            }
        },
        onError: (err: Error) => {
            toast.error(t`Failed to delete`, {
                description: err.message,
            });
        },
    });
    return (
        <AlertDialog>
            <AlertDialogTrigger nativeButton={false} render={<DropdownMenuItem closeOnClick={false} />}>
                    <div className="flex items-center gap-2">
                        <TrashIcon className="w-4 h-4" />
                        <Trans>Delete</Trans>
                    </div>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <Trans>Confirm deletion</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <Trans>
                            Are you sure you want to delete this item? This action cannot be undone.
                        </Trans>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        <Trans>Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            // Pass variables based on what the mutation expects
                            if (hasIdsParameter) {
                                deleteMutationFn({ ids: [row.original.id] });
                            } else {
                                // Fallback to single id if we can't determine the format
                                deleteMutationFn({ id: row.original.id });
                            }
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        <Trans>Delete</Trans>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
