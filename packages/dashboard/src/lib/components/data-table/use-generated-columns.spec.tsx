import { addDisplayComponent } from '@/vdb/framework/extension-api/display-component-extensions.js';
import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { CellContext } from '@tanstack/react-table';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useGeneratedColumns } from './use-generated-columns.js';

const fakeCellContext = {
    cell: { getValue: () => undefined },
    row: { original: {} },
} as unknown as CellContext<any, any>;

function renderColumnCell(pageId: string, blockId: string, columnId: string, coreCellLabel: string) {
    const captured: { columns?: Array<{ id?: string; cell?: any }> } = {};

    function Harness() {
        const { columns } = useGeneratedColumns({
            fields: [
                {
                    name: columnId,
                    type: 'Int',
                    nullable: false,
                    list: false,
                    isPaginatedList: false,
                    isScalar: true,
                },
            ],
            customizeColumns: {
                [columnId]: {
                    // Simulates a core-supplied `cell` function, e.g. the Money cell on price columns.
                    cell: () => <span>{coreCellLabel}</span>,
                },
            } as any,
            includeSelectionColumn: false,
            includeActionsColumn: false,
        });
        captured.columns = columns as any;
        return null;
    }

    renderToStaticMarkup(
        <PageContext.Provider value={{ pageId }}>
            <PageBlockContext.Provider value={{ blockId, column: 'main' }}>
                <Harness />
            </PageBlockContext.Provider>
        </PageContext.Provider>,
    );

    const column = captured.columns?.find(c => c.id === columnId);
    if (!column?.cell) {
        throw new Error(`Column "${columnId}" was not generated`);
    }
    return renderToStaticMarkup(column.cell(fakeCellContext));
}

describe('useGeneratedColumns', () => {
    it('gives precedence to a registered display component over a core-supplied cell function', () => {
        const pageId = 'test-page-registered';
        const blockId = 'test-block';
        const columnId = 'price';

        addDisplayComponent({
            pageId,
            blockId,
            field: columnId,
            component: () => <span>registered-display-component</span>,
        });

        const html = renderColumnCell(pageId, blockId, columnId, 'core-cell');

        expect(html).toContain('registered-display-component');
        expect(html).not.toContain('core-cell');
    });

    it('falls back to the core-supplied cell function when no display component is registered', () => {
        const pageId = 'test-page-unregistered';
        const blockId = 'test-block';
        const columnId = 'price';

        const html = renderColumnCell(pageId, blockId, columnId, 'core-cell');

        expect(html).toContain('core-cell');
    });
});
