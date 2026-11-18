import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListPage } from './list-page.js';

// Capture the props ListPage forwards to PaginatedListDataTable.
const captured: { props?: Record<string, any> } = {};

vi.mock('@/vdb/components/shared/paginated-list-data-table.js', () => ({
    PaginatedListDataTable: (props: Record<string, any>) => {
        captured.props = props;
        return null;
    },
}));

vi.mock('../layout-engine/page-layout.js', () => ({
    Page: ({ children }: any) => <>{children}</>,
    PageTitle: ({ children }: any) => <>{children}</>,
    PageActionBar: ({ children }: any) => <>{children}</>,
    PageLayout: ({ children }: any) => <>{children}</>,
    FullWidthPageBlock: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/vdb/hooks/use-user-settings.js', () => ({
    useUserSettings: () => ({ setTableSettings: vi.fn(), settings: {} }),
}));

vi.mock('@/vdb/hooks/use-channel.js', () => ({
    useChannel: () => ({ activeChannel: { id: '2' } }),
}));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}));

describe('ListPage prop forwarding', () => {
    const baseProps = {
        route: { useSearch: () => ({}), fullPath: '/', id: '/_authenticated/_products/products' } as any,
        title: 'Test',
        listQuery: {} as any,
    };

    beforeEach(() => {
        captured.props = undefined;
    });

    it('forwards transformQueryKey, disableViewOptions and includeSelectionColumn to PaginatedListDataTable', () => {
        const transformQueryKey = (queryKey: any[]) => [...queryKey, 'extra'];

        renderToStaticMarkup(
            <ListPage
                {...baseProps}
                transformQueryKey={transformQueryKey}
                disableViewOptions={true}
                // false is the non-default value, so this asserts the value is really forwarded
                // rather than coinciding with PaginatedListDataTable's own default of true.
                includeSelectionColumn={false}
            />,
        );

        expect(captured.props).toBeDefined();
        expect(captured.props?.transformQueryKey).toBe(transformQueryKey);
        expect(captured.props?.disableViewOptions).toBe(true);
        expect(captured.props?.includeSelectionColumn).toBe(false);
    });

    // OSS-1157 — the selection is kept per list and per channel
    it('keys the stored selection by route and active channel', () => {
        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.selectionStorageKey).toBe('/_authenticated/_products/products:2');
    });
});
