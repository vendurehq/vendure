import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VisibilityState } from '@tanstack/table-core';
import { DocumentNode, parse, print } from 'graphql';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaginatedListDataTable } from './paginated-list-data-table.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('virtual:admin-api-schema', () => {
    return import('../../framework/document-introspection/testing-utils.js').then(m => m.getMockSchemaInfo());
});

const queryDocuments: DocumentNode[] = [];
// The visibility changes the DataTable stub reports after mounting
let reportedVisibilityChange: VisibilityState = {};

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        query: vi.fn((document: DocumentNode) => {
            queryDocuments.push(document);
            return Promise.resolve({ products: { items: [], totalItems: 0 } });
        }),
    },
}));

// Stands in for DataTable, which owns the live column visibility state. After mounting it
// reports `reportedVisibilityChange` the same way DataTable reports a column settings
// change through onColumnVisibilityChange.
vi.mock('@/vdb/components/data-table/data-table.js', () => ({
    DataTable: (props: {
        defaultColumnVisibility?: VisibilityState;
        onColumnVisibilityChange?: (table: any, visibility: VisibilityState) => void;
    }) => {
        useEffect(() => {
            props.onColumnVisibilityChange?.(
                {},
                {
                    ...props.defaultColumnVisibility,
                    ...reportedVisibilityChange,
                },
            );
        }, []);
        return null;
    },
}));

vi.mock('@/vdb/hooks/use-extended-list-query.js', () => ({
    useExtendedListQuery: (listQuery: DocumentNode) => listQuery,
}));

vi.mock('@/vdb/framework/document-introspection/add-custom-fields.js', () => ({
    addCustomFields: (listQuery: DocumentNode) => listQuery,
}));

vi.mock('@/vdb/framework/document-introspection/hooks.js', () => ({
    useListQueryFields: () => [],
}));

vi.mock('@/vdb/hooks/use-view-option-defaults.js', () => ({
    useViewOptionDefaults: (defaultColumnVisibility: VisibilityState) => ({
        defaultColumnVisibility: defaultColumnVisibility ?? {},
        defaultColumnOrder: [],
    }),
}));

vi.mock('../data-table/use-generated-columns.js', () => ({
    useGeneratedColumns: () => ({
        columns: [{ id: 'id' }, { id: 'name' }, { id: 'sku' }],
        customFieldColumnNames: [],
    }),
}));

const listQuery = parse(`
    query ProductList($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                name
                sku
            }
            totalItems
        }
    }
`);

describe('PaginatedListDataTable', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        queryDocuments.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    async function renderTable() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <PaginatedListDataTable
                        listQuery={listQuery}
                        defaultVisibility={{ name: true, sku: false }}
                        page={1}
                        itemsPerPage={10}
                        sorting={[]}
                        columnFilters={[]}
                        onPageChange={() => undefined}
                        onSortChange={() => undefined}
                    />
                </QueryClientProvider>,
            );
        });
    }

    function lastQuery() {
        return print(queryDocuments[queryDocuments.length - 1]);
    }

    // #5619 — a column shown via the column settings rendered empty cells when the caller
    // did not persist column visibility, because its field was never selected
    it('selects the field of a column shown in the DataTable without onColumnVisibilityChange', async () => {
        reportedVisibilityChange = { sku: true };
        await renderTable();

        await vi.waitFor(() => {
            expect(queryDocuments.length).toBeGreaterThan(0);
            expect(lastQuery()).toMatch(/\bsku\b/);
        });
    });

    it('does not select the field of a column that stays hidden', async () => {
        reportedVisibilityChange = {};
        await renderTable();

        await vi.waitFor(() => {
            expect(queryDocuments.length).toBeGreaterThan(0);
            expect(lastQuery()).toMatch(/\bname\b/);
            expect(lastQuery()).not.toMatch(/\bsku\b/);
        });
    });
});
