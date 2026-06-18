import { CellContext } from '@tanstack/table-core';

export type ColumnDataType = 'String' | 'Int' | 'Float' | 'DateTime' | 'Boolean' | 'ID' | 'Money';

/**
 * @description
 * This type is used to define re-usable components that can render a table cell in a
 * DataTable.
 *
 * @example
 * ```ts
 * import { DataTableCellComponent } from '\@vendure/dashboard';
 *
 * type CustomerCellData = {
 *     customer: {
 *         id: string;
 *         firstName: string;
 *         lastName: string;
 *     } | null;
 * };
 *
 * export const CustomerCell: DataTableCellComponent<CustomerCellData> = ({ row }) => {
 *     const value = row.original.customer;
 *     if (!value) {
 *         return null;
 *     }
 *     return (
 *         <Button variant="ghost" render={<Link to={`/customers/${value.id}`} />}>
 *             {value.firstName} {value.lastName}
 *         </Button>
 *     );
 * };
 * ```
 *
 * @docsCategory list-views
 * @since 3.4.0
 */
export type DataTableCellComponent<T> = <Data extends T>(context: CellContext<Data, any>) => any;
