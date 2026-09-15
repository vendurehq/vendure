import {
    defineDashboardExtension,
    executeDashboardExtensionCallbacks,
} from '@/vdb/framework/extension-api/define-dashboard-extension.js';
import { addDisplayComponent } from '@/vdb/framework/extension-api/display-component-extensions.js';
import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { CellContext, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdditionalColumns } from '../shared/paginated-list-data-table.js';
import { useGeneratedColumns } from './use-generated-columns.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The display component registry is a module-level Map with no removal API, so an entry
// registered by one test stays visible to every later test. Each test therefore uses its
// own pageId; reusing one would let an earlier registration decide a later result.
const BLOCK_ID = 'test-block';

const PRICE = 1234;

const fields = [
    { name: 'sku', type: 'String', nullable: false, list: false, isPaginatedList: false, isScalar: true },
    { name: 'price', type: 'Int', nullable: false, list: false, isPaginatedList: false, isScalar: true },
];

// Mirrors product-variants-table.tsx, which supplies a `cell` for `price` but not for `sku`.
// That asymmetry is why the documented example works on `sku` and silently fails on `price`.
const customizeColumns = {
    price: { cell: () => <span>core-money-cell</span> },
} as any;

const cellContext = {
    cell: { getValue: () => PRICE },
    row: { original: { sku: 'SKU-1', price: PRICE } },
} as unknown as CellContext<any, any>;

/**
 * Renders one generated column's cell the way TanStack renders it. `flexRender` calls
 * `createElement` for any function cell, so a cell using hooks behaves here as it does in
 * a real table; calling `column.cell(context)` directly would not.
 */
function renderColumnCell(
    pageId: string,
    columnId: string,
    additionalColumns?: AdditionalColumns<any>,
): string {
    return renderCell(generateColumn(pageId, columnId, additionalColumns));
}

function renderCell(column: { cell?: any }): string {
    return renderToStaticMarkup(<>{flexRender(column.cell, cellContext)}</>);
}

function generateColumn(
    pageId: string,
    columnId: string,
    additionalColumns?: AdditionalColumns<any>,
): { id?: string; cell?: any } {
    const captured: { columns?: Array<{ id?: string; cell?: any }> } = {};

    function Harness() {
        const { columns } = useGeneratedColumns({
            fields,
            customizeColumns,
            additionalColumns,
            includeSelectionColumn: false,
            includeActionsColumn: false,
        });
        captured.columns = columns as any;
        return null;
    }

    renderToStaticMarkup(
        <PageContext.Provider value={{ pageId }}>
            <PageBlockContext.Provider value={{ blockId: BLOCK_ID, column: 'main' }}>
                <Harness />
            </PageBlockContext.Provider>
        </PageContext.Provider>,
    );

    const column = captured.columns?.find(c => c.id === columnId);
    if (!column?.cell) {
        throw new Error(`Column "${columnId}" was not generated`);
    }
    return column;
}

describe('useGeneratedColumns display component precedence', () => {
    it('gives precedence to a registered display component over a core-supplied cell function', () => {
        const pageId = 'test-page-registered';

        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'price',
            component: () => <span>registered-display-component</span>,
        });

        expect(renderColumnCell(pageId, 'price')).toBe('<span>registered-display-component</span>');
    });

    it('passes the cell value to a display component that overrides a core-supplied cell', () => {
        const pageId = 'test-page-value';

        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'price',
            component: ({ value }) => <span>{`value:${value as number}`}</span>,
        });

        expect(renderColumnCell(pageId, 'price')).toBe(`<span>value:${PRICE}</span>`);
    });

    it('falls back to the core-supplied cell function when no display component is registered', () => {
        expect(renderColumnCell('test-page-unregistered', 'price')).toBe('<span>core-money-cell</span>');
    });

    it('still renders a registered display component on a column with no core-supplied cell', () => {
        const pageId = 'test-page-no-core-cell';

        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'sku',
            component: () => <span>sku-display-component</span>,
        });

        expect(renderColumnCell(pageId, 'sku')).toBe('<span>sku-display-component</span>');
    });

    it('renders the default display component when a column has neither a core cell nor a registration', () => {
        expect(renderColumnCell('test-page-default', 'sku')).toBe(String(PRICE));
    });

    it('applies a display component registered through defineDashboardExtension', () => {
        // The route real extensions take. registerDataTableExtensions defaults blockId to
        // 'list-table', so the block has to be named explicitly to target this table.
        const pageId = 'test-page-extension-api';

        defineDashboardExtension({
            dataTables: [
                {
                    pageId,
                    blockId: BLOCK_ID,
                    displayComponents: [{ column: 'price', component: () => <span>via-extension-api</span> }],
                },
            ],
        });
        executeDashboardExtensionCallbacks();

        expect(renderColumnCell(pageId, 'price')).toBe('<span>via-extension-api</span>');
    });

    // #5346 — a column generated before a display component registers must not keep the unregistered renderer
    it('applies a display component registered after the column was generated', () => {
        const pageId = 'test-page-late-registration';

        // Generated while nothing is registered, then reused as a memoised column would be.
        const column = generateColumn(pageId, 'price');
        expect(renderCell(column)).toBe('<span>core-money-cell</span>');

        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'price',
            component: () => <span>late-registered</span>,
        });

        expect(renderCell(column)).toBe('<span>late-registered</span>');
    });
});

describe('useGeneratedColumns additionalColumns', () => {
    const additionalColumns: AdditionalColumns<any> = {
        inventoryStatus: { cell: () => <span>additional-column-cell</span> },
    };

    it('gives precedence to a registered display component over an additional column cell', () => {
        const pageId = 'test-page-additional-column-registered';

        // An additional column id is usually not a field on the row, so a real component
        // reads `row.original` rather than `value`.
        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'inventoryStatus',
            component: ({ row }: CellContext<any, any>) => (
                <span>{`registered-additional-column-display-component:${row.original.sku as string}`}</span>
            ),
        });

        expect(renderColumnCell(pageId, 'inventoryStatus', additionalColumns)).toBe(
            '<span>registered-additional-column-display-component:SKU-1</span>',
        );
    });

    it('falls back to the additional column cell when no display component is registered', () => {
        expect(
            renderColumnCell(
                'test-page-additional-column-unregistered',
                'inventoryStatus',
                additionalColumns,
            ),
        ).toBe('<span>additional-column-cell</span>');
    });

    // #5346 — an additional column without a cell must pick up a display component registered later
    it('applies a display component registered after an additional column without a cell was generated', () => {
        const pageId = 'test-page-additional-column-late-registration';
        const column = generateColumn(pageId, 'skuLabel', {
            skuLabel: { accessorFn: (row: any) => row.sku },
        } as any);
        const skuLabelContext = { ...cellContext, renderValue: () => 'SKU-1' } as unknown as CellContext<
            any,
            any
        >;
        expect(renderToStaticMarkup(<>{flexRender(column.cell, skuLabelContext)}</>)).toBe('SKU-1');

        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'skuLabel',
            component: () => <span>late-registered</span>,
        });

        expect(renderToStaticMarkup(<>{flexRender(column.cell, skuLabelContext)}</>)).toBe(
            '<span>late-registered</span>',
        );
    });
});

describe('useGeneratedColumns mounted table', () => {
    // #5346 — render-time lookup must not remount a stable cell when columns regenerate (see #4064)
    it('does not remount a stable custom cell when the columns are regenerated', () => {
        let mounts = 0;
        function StatefulCell() {
            useEffect(() => {
                mounts++;
            }, []);
            return <span>stateful</span>;
        }

        function Table() {
            // A new customizeColumns object on every render forces the column memo to recompute.
            const { columns } = useGeneratedColumns({
                fields,
                customizeColumns: { price: { cell: StatefulCell } } as any,
                includeSelectionColumn: false,
                includeActionsColumn: false,
            });
            const table = useReactTable({
                data: [{ sku: 'SKU-1', price: PRICE }],
                columns: columns as any,
                getCoreRowModel: getCoreRowModel(),
            });
            return (
                <>
                    {table
                        .getRowModel()
                        .rows.flatMap(row =>
                            row
                                .getVisibleCells()
                                .map(cell => (
                                    <span key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </span>
                                )),
                        )}
                </>
            );
        }

        const container = document.createElement('div');
        const root = createRoot(container);
        const render = () =>
            act(() =>
                root.render(
                    <PageContext.Provider value={{ pageId: 'test-page-stable-cell' }}>
                        <PageBlockContext.Provider value={{ blockId: BLOCK_ID, column: 'main' }}>
                            <Table />
                        </PageBlockContext.Provider>
                    </PageContext.Provider>,
                ),
            );

        render();
        render();
        render();

        expect(container.textContent).toBe('SKU-1stateful');
        expect(mounts).toBe(1);
        act(() => root.unmount());
    });

    // #5346 — the case an extension author actually hits: a stateful display component is
    // registered, so the registered branch of the wrapper renders on every pass. The wrapper
    // is cached per cell and key, so the component must stay mounted across regenerations.
    it('does not remount a registered stateful display component when the columns are regenerated', () => {
        const pageId = 'test-page-stable-registered-display';
        let mounts = 0;
        function StatefulDisplay() {
            useEffect(() => {
                mounts++;
            }, []);
            return <span>registered-stateful</span>;
        }
        addDisplayComponent({
            pageId,
            blockId: BLOCK_ID,
            field: 'price',
            component: StatefulDisplay,
        });

        function StableCell() {
            return <span>core-money-cell</span>;
        }

        function Table() {
            // A new customizeColumns object on every render forces the column memo to recompute,
            // while `cell` itself stays referentially stable.
            const { columns } = useGeneratedColumns({
                fields,
                customizeColumns: { price: { cell: StableCell } } as any,
                includeSelectionColumn: false,
                includeActionsColumn: false,
            });
            const table = useReactTable({
                data: [{ sku: 'SKU-1', price: PRICE }],
                columns: columns as any,
                getCoreRowModel: getCoreRowModel(),
            });
            return (
                <>
                    {table
                        .getRowModel()
                        .rows.flatMap(row =>
                            row
                                .getVisibleCells()
                                .map(cell => (
                                    <span key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </span>
                                )),
                        )}
                </>
            );
        }

        const container = document.createElement('div');
        const root = createRoot(container);
        const render = () =>
            act(() =>
                root.render(
                    <PageContext.Provider value={{ pageId }}>
                        <PageBlockContext.Provider value={{ blockId: BLOCK_ID, column: 'main' }}>
                            <Table />
                        </PageBlockContext.Provider>
                    </PageContext.Provider>,
                ),
            );

        render();
        render();
        render();

        expect(container.textContent).toBe('SKU-1registered-stateful');
        expect(mounts).toBe(1);
        act(() => root.unmount());
    });
});
