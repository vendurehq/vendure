import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListPage } from './list-page.js';

// Capture the props ListPage forwards to PaginatedListDataTable.
const captured: { props?: Record<string, any> } = {};

// Lets each test control the user settings ListPage reads its persisted table state from,
// whether those settings have finished resolving, and observe what it writes back.
const mocks = vi.hoisted(() => ({
    settings: {} as Record<string, any>,
    settingsReady: true,
    setTableSettings: vi.fn(),
}));

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
    useUserSettings: () => ({
        setTableSettings: mocks.setTableSettings,
        settings: mocks.settings,
        settingsReady: mocks.settingsReady,
    }),
}));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}));

describe('ListPage prop forwarding', () => {
    const baseProps = {
        route: { useSearch: () => ({}), fullPath: '/' } as any,
        title: 'Test',
        listQuery: {} as any,
    };

    beforeEach(() => {
        captured.props = undefined;
        mocks.settings = {};
        mocks.settingsReady = true;
        mocks.setTableSettings.mockClear();
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
});

describe('ListPage defaultColumnFilters', () => {
    const defaultColumnFilters = [{ id: 'isArchived', value: { eq: false } }];

    // The table `onFilterChange` is handed; only its state is read, to build the URL search.
    const tableStub = () =>
        ({
            getState: () => ({ pagination: { pageIndex: 0, pageSize: 10 }, sorting: [], columnFilters: [] }),
        }) as any;

    const baseProps = {
        route: { useSearch: () => ({}), fullPath: '/' } as any,
        title: 'Test',
        listQuery: {} as any,
        pageId: 'test-list',
        defaultColumnFilters,
    };

    beforeEach(() => {
        captured.props = undefined;
        mocks.settings = {};
        mocks.settingsReady = true;
        mocks.setTableSettings.mockClear();
    });

    it('applies the defaults when the user has not configured filters for the page', () => {
        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual(defaultColumnFilters);
    });

    it('applies the defaults when the page has table settings but no saved filters', () => {
        mocks.settings = { tableSettings: { 'test-list': { pageSize: 25 } } };

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual(defaultColumnFilters);
    });

    it('prefers the filters the user has saved over the defaults', () => {
        const userFilters = [{ id: 'name', value: { contains: 'shoe' } }];
        mocks.settings = { tableSettings: { 'test-list': { columnFilters: userFilters } } };

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual(userFilters);
    });

    it('does not re-apply the defaults once the user has cleared all filters', () => {
        mocks.settings = {
            tableSettings: { 'test-list': { columnFilters: [], columnFiltersConfigured: true } },
        };

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual([]);
    });

    // Versions before 3.8.0 saved an empty `columnFilters` for a page on every visit.
    it('applies the defaults over an empty saved filter state left by an older version', () => {
        mocks.settings = { tableSettings: { 'test-list': { columnFilters: [] } } };

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual(defaultColumnFilters);
    });

    it('marks the filters as configured when the user clears them', () => {
        renderToStaticMarkup(<ListPage {...baseProps} />);

        captured.props?.onFilterChange(tableStub(), []);

        expect(mocks.setTableSettings).toHaveBeenCalledWith('test-list', 'columnFilters', []);
        expect(mocks.setTableSettings).toHaveBeenCalledWith('test-list', 'columnFiltersConfigured', true);
    });

    it('saves a non-empty filter set as it is', () => {
        const userFilters = [{ id: 'name', value: { contains: 'shoe' } }];

        renderToStaticMarkup(<ListPage {...baseProps} />);

        captured.props?.onFilterChange(tableStub(), userFilters);

        expect(mocks.setTableSettings).toHaveBeenCalledWith('test-list', 'columnFilters', userFilters);
    });

    it('ignores the defaults when no pageId is set, since there is nowhere to persist a change', () => {
        renderToStaticMarkup(<ListPage {...baseProps} pageId={undefined} />);

        expect(captured.props?.columnFilters).toBeUndefined();
    });

    it('leaves pages without defaults unaffected', () => {
        renderToStaticMarkup(<ListPage {...baseProps} defaultColumnFilters={undefined} />);

        expect(captured.props?.columnFilters).toBeUndefined();
    });

    // The data table seeds its filter state from `columnFilters` once, on mount, while the
    // user settings resolve asynchronously. Mounting it before the settings have resolved
    // would show the default filter chips over a list that is still being fetched unfiltered.
    it('does not mount the data table until the user settings have resolved', () => {
        mocks.settingsReady = false;

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props).toBeUndefined();
    });

    it('mounts the data table once the user settings have resolved', () => {
        mocks.settingsReady = true;

        renderToStaticMarkup(<ListPage {...baseProps} />);

        expect(captured.props?.columnFilters).toEqual(defaultColumnFilters);
    });

    // The gate is scoped to the new feature, so pages that do not use it mount exactly as
    // they did before, regardless of where the settings have got to.
    it('still mounts the data table for pages with no defaults while settings are resolving', () => {
        mocks.settingsReady = false;

        renderToStaticMarkup(<ListPage {...baseProps} defaultColumnFilters={undefined} />);

        expect(captured.props).toBeDefined();
    });

    it('still mounts the data table for pages with no pageId while settings are resolving', () => {
        mocks.settingsReady = false;

        renderToStaticMarkup(<ListPage {...baseProps} pageId={undefined} />);

        expect(captured.props).toBeDefined();
    });
});
