import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { HeaderContext } from '@tanstack/table-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DataTableColumnHeader } from './data-table-column-header.js';

vi.mock('./column-header-wrapper.js', () => ({
    ColumnHeaderWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@vendure-io/ui/components/molecules/data-table/data-table-column-header', () => ({
    DataTableColumnHeader: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function renderHeader(columnId: string, header?: string) {
    const headerContext = { column: { id: columnId } } as unknown as HeaderContext<any, any>;
    return renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
            <DataTableColumnHeader headerContext={headerContext} customConfig={{ header }} />
        </I18nProvider>,
    );
}

describe('DataTableColumnHeader', () => {
    it('heads an enabled column "Status", because its cell shows the state', () => {
        expect(renderHeader('enabled')).toBe('<span>Status</span>');
    });

    it('derives other headers from the field name', () => {
        expect(renderHeader('updatedAt')).toBe('<span>Updated At</span>');
    });

    it('uses a custom header on an enabled column', () => {
        expect(renderHeader('enabled', 'Active')).toBe('<span>Active</span>');
    });
});
