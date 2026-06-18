import { DataDisplayComponent } from '@/vdb/framework/component-registry/component-registry.js';
import { Table } from '@tanstack/react-table';
import { CellContext } from '@tanstack/table-core';
import { DocumentNode } from 'graphql';
import React from 'react';

export type DataTableDisplayComponent = DataDisplayComponent<CellContext<any, any>>;

/**
 * @description
 * Allows you to define custom display components for specific columns in data tables.
 * The pageId is already defined in the data table extension, so only the column name is needed.
 *
 * @docsCategory extensions-api
 * @docsPage DataTable
 * @since 3.4.0
 */
export interface DashboardDataTableDisplayComponent {
    /**
     * @description
     * The name of the column where this display component should be used.
     */
    column: string;
    /**
     * @description
     * The React component that will be rendered as the display.
     * It should accept `value` and other standard display props.
     */
    component: DataTableDisplayComponent;
}

export type BulkActionContext<Item extends { id: string } & Record<string, any>> = {
    selection: Item[];
    table: Table<Item>;
};

export type BulkActionComponent<Item extends { id: string } & Record<string, any>> = React.FunctionComponent<
    BulkActionContext<Item>
>;

/**
 * @description
 * A bulk action is a component that will be rendered in the bulk actions dropdown.
 *
 * The component receives the following props:
 *
 * - `selection`: The selected row or rows
 * - `table`: A reference to the Tanstack table instance powering the list
 *
 * The `table` object has
 *
 * @example
 * ```tsx
 * import { BulkActionComponent, DataTableBulkActionItem, usePaginatedList } from '\@vendure/dashboard';
 *
 * // This is an example of a bulk action that shows some typical
 * // uses of the provided props
 * export const MyBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
 *   const { refetchPaginatedList } = usePaginatedList();
 *
 *   const doTheAction = async () => {
 *     // Actual logic of the action
 *     // goes here...
 *
 *     // On success, we refresh the list
 *     refetchPaginatedList();
 *     // and un-select any selected rows in the table
 *     table.resetRowSelection();
 *   };
 *
 *  return (
 *    <DataTableBulkActionItem
 *      onClick={doTheAction}
 *      label={<Trans>Delete</Trans>}
 *      confirmationText={<Trans>Are you sure?</Trans>}
 *      icon={Check}
 *      className="text-destructive"
 *    />
 *  );
 * }
 * ```
 *
 * For the common action of deletion, we provide a ready-made helper component:
 *
 * @example
 * ```tsx
 * import { BulkActionComponent, DeleteProductsBulkAction } from '\@vendure/dashboard';
 *
 * // Define the BulkAction component. This one uses
 * // a built-in wrapper for "delete" actions, which includes
 * // a confirmation dialog.
 * export const DeleteProductsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
 *     return (
 *         <DeleteBulkAction
 *             mutationDocument={deleteProductsDocument}
 *             entityName="products"
 *             requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
 *             selection={selection}
 *             table={table}
 *         />
 *     );
 * };
 * ```
 *
 * @docsCategory list-views
 * @docsPage bulk-actions
 * @since 3.4.0
 */
export type BulkAction = {
    /**
     * @description
     * Optional order number to control the position of this bulk action in the dropdown.
     * A larger number will appear lower in the list.
     */
    order?: number;
    /**
     * @description
     * The React component that will be rendered as the bulk action item.
     */
    component: BulkActionComponent<any>;
};

/**
 * @description
 * A group of bulk actions that are visually separated in the dropdown menu.
 * Optionally includes a translatable label rendered as a `DropdownMenuLabel`.
 *
 * @docsCategory list-views
 * @docsPage bulk-actions
 * @since 3.4.0
 */
export type BulkActionGroup = {
    /**
     * @description
     * Optional label rendered as a `DropdownMenuLabel` at the top of the group.
     */
    label?: React.ReactNode;
    /**
     * @description
     * The bulk actions in this group.
     */
    actions: BulkAction[];
};

/**
 * @description
 * Bulk actions input supports three formats:
 *
 * 1. **Flat array** (backwards compatible): `BulkAction[]` — all actions in one group.
 * 2. **Array of arrays**: `BulkAction[][]` — each inner array is a visually separated group.
 * 3. **Array of groups**: `BulkActionGroup[]` — groups with optional labels.
 *
 * Formats 2 and 3 can be mixed in the same array.
 *
 * @example
 * ```tsx
 * // Flat (single group, backwards compatible)
 * bulkActions={[
 *   { component: AssignBulkAction },
 *   { component: DeleteBulkAction },
 * ]}
 *
 * // Grouped with labels
 * bulkActions={[
 *   [
 *     { component: AssignBulkAction },
 *     { component: DuplicateBulkAction },
 *   ],
 *   { label: <Trans>Danger zone</Trans>, actions: [
 *     { component: DeleteBulkAction },
 *   ]},
 * ]}
 * ```
 *
 * @docsCategory list-views
 * @docsPage bulk-actions
 * @since 3.4.0
 */
export type BulkActionsInput = BulkAction[] | Array<BulkAction[] | BulkActionGroup>;

/**
 * @description
 * This allows you to customize aspects of existing data tables in the dashboard.
 *
 * @docsCategory extensions-api
 * @docsPage DataTables
 * @since 3.4.0
 */
export interface DashboardDataTableExtensionDefinition {
    /**
     * @description
     * The ID of the page where the data table is located, e.g. `'product-list'`, `'order-list'`.
     */
    pageId: string;
    /**
     * @description
     * The ID of the data table block. Defaults to `'list-table'`, which is the default blockId
     * for the standard list pages. However, some other pages may use a different blockId,
     * such as `'product-variants-table'` on the `'product-detail'` page.
     */
    blockId?: string;
    /**
     * @description
     * An array of additional bulk actions that will be available on the data table.
     */
    bulkActions?: BulkAction[];
    /**
     * @description
     * Allows you to extend the list document for the data table.
     */
    extendListDocument?: string | DocumentNode | (() => DocumentNode | string);
    /**
     * @description
     * Custom display components for specific columns in the data table.
     */
    displayComponents?: DashboardDataTableDisplayComponent[];
}
