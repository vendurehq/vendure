import { useAllBulkActions } from '@/vdb/components/data-table/use-all-bulk-actions.js';
import { DisplayComponent } from '@/vdb/framework/component-registry/display-component.js';
import {
    FieldInfo,
    getOperationVariablesFields,
    getTypeFieldInfo,
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
    createColumnHelper,
    Row,
} from '@tanstack/react-table';
import { EllipsisIcon, TrashIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
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

        const queryBasedColumns = columnConfigs.map(({ fieldInfo, isCustomField }) => {
            const customConfig = customizeColumns?.[fieldInfo.name as unknown as AllItemFieldKeys<T>] ?? {};

            const disabled = customConfig.meta?.disabled ?? false;

            if (disabled) {
                return null;
            }

            const { header, meta, cell: customCell, ...customConfigRest } = customConfig;
            const enableColumnFilter = fieldInfo.isScalar && !facetedFilters?.[fieldInfo.name];
            const displayComponentId =
                pageId && pageBlock?.blockId
                    ? generateDisplayComponentKey(pageId, pageBlock.blockId, fieldInfo.name)
                    : undefined;

            // If a custom cell function is provided, use it directly (like additionalColumns does).
            // This preserves the same behavior and prevents cell unmounting issues.
            // Only use CellWrapper for columns without custom cells.
            const cellFn =
                typeof customCell === 'function'
                    ? customCell
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
            finalColumns.push(columnHelper.accessor(id as any, { enableColumnFilter: false, ...column, id }));
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
    }, [fields, customizeColumns, rowActions, deleteMutation, additionalColumns, defaultColumnOrder]);

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
    const { cell, row } = cellContext;
    const cellValue = cell.getValue();
    const value =
        cellValue ?? (isCustomField ? (row.original as any)?.customFields?.[fieldInfo.name] : undefined);

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
