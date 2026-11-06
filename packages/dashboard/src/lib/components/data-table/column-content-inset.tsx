import { ColumnDef } from '@tanstack/react-table';

/**
 * @description
 * The distance from a table cell's content edge to the first character of the text in a
 * cell component that has its own box. Set one on a column as `meta.contentInset`, and the
 * DataTable indents the column header by the same distance, so the header text starts where
 * the cell text starts. Nothing in the cell moves, so nothing can clip.
 *
 * Each value is the sum of the component's own classes:
 * - `statusBadge`: a `StatusBadge` chip with its leading icon: `pl-2` + `size-3.25` icon +
 *   `gap-1.5`. Also used by `BooleanDisplayBadge` and `BooleanDisplayYesNoBadge`.
 * - `badge`: a `Badge`: `px-2` + its 1px border.
 * - `badgeWithIcon`: a `Badge` with a leading icon: `px-2` + its 1px border + `size-3` icon +
 *   `gap-1`.
 * - `smallButton`: a `Button` of size `sm`: `px-2.5` + its 1px border.
 *
 * In a column where some rows have a styled box and others plain text, pad the plain text by the
 * same inset (`style={{ paddingInlineStart: inset }}`), so every row starts its text in one line.
 *
 * @example
 * ```tsx
 * customizeColumns={{
 *     enabled: {
 *         meta: { contentInset: columnContentInset.statusBadge },
 *         cell: ({ row }) => <BooleanDisplayBadge value={row.original.enabled} />,
 *     },
 * }}
 * ```
 *
 * @docsCategory components
 * @docsPage DataTable
 * @since 3.8.2
 */
export const columnContentInset = {
    statusBadge: 'calc(var(--spacing) * 6.75)',
    badge: 'calc(var(--spacing) * 2 + 1px)',
    badgeWithIcon: 'calc(var(--spacing) * 6 + 1px)',
    smallButton: 'calc(var(--spacing) * 2.5 + 1px)',
} as const;

function getContentInset(meta: unknown): string | undefined {
    const inset = (meta as { contentInset?: unknown } | undefined)?.contentInset;
    return typeof inset === 'string' ? inset : undefined;
}

/**
 * Indents the header of a column that declares `meta.contentInset`. Other columns are returned unchanged.
 */
export function withHeaderContentInset<TData>(column: ColumnDef<TData, any>): ColumnDef<TData, any> {
    const inset = getContentInset(column.meta);
    const header = column.header;
    if (!inset || header == null) {
        return column;
    }
    return {
        ...column,
        header: headerContext => (
            <div style={{ paddingInlineStart: inset }}>
                {typeof header === 'function' ? header(headerContext) : header}
            </div>
        ),
    } as ColumnDef<TData, any>;
}
