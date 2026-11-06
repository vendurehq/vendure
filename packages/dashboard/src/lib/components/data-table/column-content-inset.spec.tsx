import { flexRender, HeaderContext } from '@tanstack/react-table';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { columnContentInset, withHeaderContentInset } from './column-content-inset.js';

const headerContext = {} as HeaderContext<any, any>;

function renderHeader(column: Parameters<typeof withHeaderContentInset>[0]) {
    return renderToStaticMarkup(<>{flexRender(withHeaderContentInset(column).header, headerContext)}</>);
}

describe('withHeaderContentInset', () => {
    it('indents a string header by the column content inset', () => {
        expect(
            renderHeader({ id: 'state', header: 'State', meta: { contentInset: columnContentInset.badge } }),
        ).toBe('<div style="padding-inline-start:calc(var(--spacing) * 2 + 1px)">State</div>');
    });

    it('indents a function header by the column content inset', () => {
        expect(
            renderHeader({
                id: 'state',
                header: () => <span>State</span>,
                meta: { contentInset: columnContentInset.statusBadge },
            }),
        ).toBe('<div style="padding-inline-start:calc(var(--spacing) * 6.75)"><span>State</span></div>');
    });

    it('returns a column without an inset unchanged', () => {
        const column = { id: 'name', header: 'Name' };
        expect(withHeaderContentInset(column)).toBe(column);
    });
});
