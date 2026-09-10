import {
    defineDashboardExtension,
    executeDashboardExtensionCallbacks,
} from '@/vdb/framework/extension-api/define-dashboard-extension.js';
import { addDisplayComponent } from '@/vdb/framework/extension-api/display-component-extensions.js';
import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { CellContext, flexRender } from '@tanstack/react-table';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useGeneratedColumns } from './use-generated-columns.js';

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
function renderColumnCell(pageId: string, columnId: string): string {
    const captured: { columns?: Array<{ id?: string; cell?: any }> } = {};

    function Harness() {
        const { columns } = useGeneratedColumns({
            fields,
            customizeColumns,
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
    return renderToStaticMarkup(<>{flexRender(column.cell, cellContext)}</>);
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
});
