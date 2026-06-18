import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSettingsContext, type UserSettingsContextType } from '../../providers/user-settings.js';
import type { ActionBarItemPosition } from '../extension-api/types/layout.js';
import { globalRegistry } from '../registry/global-registry.js';
import { ActionBarItem } from './action-bar-item-wrapper.js';
import { registerDashboardActionBarItem, registerDashboardPageBlock } from './layout-extensions.js';
import { PageActionBar, PageBlock, PageLayout } from './page-layout.js';
import { PageContext } from './page-provider.js';

const useIsMobileMock = vi.hoisted(() => vi.fn(() => false));
const useCopyToClipboardMock = vi.hoisted(() => vi.fn(() => [null, vi.fn()]));
const hasPermissionsMock = vi.hoisted(() => vi.fn((_perms: string[]) => true));

vi.mock('@/vdb/hooks/use-mobile.js', () => ({
    useIsMobile: useIsMobileMock,
}));

vi.mock('@uidotdev/usehooks', () => ({
    useCopyToClipboard: useCopyToClipboardMock,
}));

vi.mock('@/vdb/hooks/use-permissions.js', () => ({
    usePermissions: () => ({
        hasPermissions: hasPermissionsMock,
    }),
}));

vi.mock('@/vdb/hooks/use-local-format.js', () => ({
    useLocalFormat: () => ({
        formatDate: (value: string | Date) => String(value),
    }),
}));

function registerBlock(
    id: string,
    order: 'before' | 'after' | 'replace',
    pageId = 'customer-list',
    requiresPermission: string[] = [],
    shouldRender?: () => boolean,
): void {
    registerDashboardPageBlock({
        id,
        title: id,
        location: {
            pageId,
            column: 'main',
            position: { blockId: 'list-table', order },
        },
        component: ({ context }) => <div data-testid={`page-block-${id}`}>{context.pageId}</div>,
        requiresPermission,
        shouldRender,
    });
}

function registerActionBarItem(id: string, position?: ActionBarItemPosition, pageId = 'customer-list'): void {
    registerDashboardActionBarItem({
        pageId,
        id,
        position,
        component: () => (
            <button type="button" data-testid={`action-bar-${id}`}>
                {id}
            </button>
        ),
    });
}

function renderPageLayout(children: React.ReactNode, { isDesktop = true } = {}) {
    useIsMobileMock.mockReturnValue(!isDesktop);
    const noop = () => undefined;
    const contextValue = {
        settings: {
            displayLanguage: 'en',
            contentLanguage: 'en',
            theme: 'system',
            displayUiExtensionPoints: false,
            mainNavExpanded: true,
            activeChannelId: '',
            devMode: false,
            hasSeenOnboarding: false,
            tableSettings: {},
        },
        settingsStoreIsAvailable: true,
        setDisplayLanguage: noop,
        setDisplayLocale: noop,
        setContentLanguage: noop,
        setTheme: noop,
        setDisplayUiExtensionPoints: noop,
        setMainNavExpanded: noop,
        setActiveChannelId: noop,
        setDevMode: noop,
        setHasSeenOnboarding: noop,
        setTableSettings: () => undefined,
        setWidgetLayout: noop,
    } as UserSettingsContextType;

    return renderToStaticMarkup(
        <UserSettingsContext.Provider value={contextValue}>
            <PageContext.Provider value={{ pageId: 'customer-list' }}>
                <PageLayout>{children}</PageLayout>
            </PageContext.Provider>
        </UserSettingsContext.Provider>,
    );
}

function renderActionBar(
    children: React.ReactNode = (
        <ActionBarItem itemId="save-button">
            <button type="button" data-testid="action-bar-save-button">
                Save
            </button>
        </ActionBarItem>
    ),
    { isDesktop = true } = {},
) {
    useIsMobileMock.mockReturnValue(!isDesktop);
    const noop = () => undefined;
    const contextValue = {
        settings: {
            displayLanguage: 'en',
            contentLanguage: 'en',
            theme: 'system',
            displayUiExtensionPoints: false,
            mainNavExpanded: true,
            activeChannelId: '',
            devMode: false,
            hasSeenOnboarding: false,
            tableSettings: {},
        },
        settingsStoreIsAvailable: true,
        setDisplayLanguage: noop,
        setDisplayLocale: noop,
        setContentLanguage: noop,
        setTheme: noop,
        setDisplayUiExtensionPoints: noop,
        setMainNavExpanded: noop,
        setActiveChannelId: noop,
        setDevMode: noop,
        setHasSeenOnboarding: noop,
        setTableSettings: () => undefined,
        setWidgetLayout: noop,
    } as UserSettingsContextType;

    return renderToStaticMarkup(
        <UserSettingsContext.Provider value={contextValue}>
            <PageContext.Provider value={{ pageId: 'customer-list' }}>
                <PageActionBar>{children}</PageActionBar>
            </PageContext.Provider>
        </UserSettingsContext.Provider>,
    );
}

function renderWithOriginal({ isDesktop = true } = {}) {
    return renderPageLayout(
        <PageBlock column="main" blockId="list-table">
            <div data-testid="page-block-original">original</div>
        </PageBlock>,
        { isDesktop },
    );
}

function getRenderedBlockIds(markup: string) {
    return Array.from(markup.matchAll(/data-testid="(page-block-[^"]+)"/g)).map(match => match[1]);
}

function getRenderedActionBarIds(markup: string) {
    return Array.from(markup.matchAll(/data-testid="action-bar-([^"]+)"/g)).map(match => match[1]);
}

describe('PageLayout', () => {
    beforeEach(() => {
        useIsMobileMock.mockReset();
        useCopyToClipboardMock.mockReset();
        useCopyToClipboardMock.mockReturnValue([null, vi.fn()]);
        hasPermissionsMock.mockReset();
        const pageBlockRegistry = globalRegistry.get('dashboardPageBlockRegistry');
        pageBlockRegistry.clear();
        const actionBarItemRegistry = globalRegistry.get('dashboardActionBarItemRegistry');
        actionBarItemRegistry.clear();
    });

    it('renders multiple before/after extension blocks in registration order', () => {
        registerBlock('before-1', 'before');
        registerBlock('before-2', 'before');
        registerBlock('after-1', 'after');

        const markup = renderPageLayout(
            <PageBlock column="main" blockId="list-table">
                <div data-testid="page-block-original">original</div>
            </PageBlock>,
            { isDesktop: true },
        );

        expect(getRenderedBlockIds(markup)).toEqual([
            'page-block-before-1',
            'page-block-before-2',
            'page-block-original',
            'page-block-after-1',
        ]);
    });

    it('replaces original block when replacement extensions are registered', () => {
        registerBlock('replacement-1', 'replace');
        registerBlock('replacement-2', 'replace');

        const markup = renderPageLayout(
            <PageBlock column="main" blockId="list-table">
                <div data-testid="page-block-original">original</div>
            </PageBlock>,
            { isDesktop: true },
        );

        expect(getRenderedBlockIds(markup)).toEqual(['page-block-replacement-1', 'page-block-replacement-2']);
    });

    it('renders extension blocks in mobile layout', () => {
        registerBlock('before-mobile', 'before');
        registerBlock('after-mobile', 'after');

        const markup = renderPageLayout(
            <PageBlock column="main" blockId="list-table">
                <div data-testid="page-block-original">original</div>
            </PageBlock>,
            { isDesktop: false },
        );

        expect(getRenderedBlockIds(markup)).toEqual([
            'page-block-before-mobile',
            'page-block-original',
            'page-block-after-mobile',
        ]);
    });

    // A directly-authored full-width block must render inside PageLayout on desktop. Regression:
    // the layout engine only routed the FullWidthPageBlock *type* into the full-width column, so a
    // plain <PageBlock column="full"> matched none of the main/side/full filters and silently vanished.
    it('renders a directly-authored PageBlock with column="full" on desktop', () => {
        const markup = renderPageLayout(
            <PageBlock column="full" blockId="full-block">
                <div data-testid="page-block-full">full</div>
            </PageBlock>,
            { isDesktop: true },
        );

        expect(getRenderedBlockIds(markup)).toEqual(['page-block-full']);
    });

    it("won't render blocks without required permissions", () => {
        hasPermissionsMock.mockReturnValue(false);

        registerBlock('permission-guard', 'before', 'customer-list', ['permission-2']);

        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-original']);
    });

    // #4679 follow-up — when a `replace`-ordered extension block requires a permission the user
    // does not have, the slot is rendered empty instead of falling back to the original child.
    // Root cause: `replacementBlockExists` is computed in page-layout.tsx without consulting
    // `hasPermissions`, so the original block is suppressed even though the replacement is then
    // filtered out by the new permission check at the `ExtensionBlock` resolution site.
    it('falls back to the original block when a replace-ordered extension is denied by permissions', () => {
        hasPermissionsMock.mockReturnValue(false);

        registerBlock('permission-replacement', 'replace', 'customer-list', ['restricted-permission']);

        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-original']);
    });

    // Multi-block variant of the regression test above. With the bug present, `replacementBlockExists`
    // would be `true` (any block with `order === 'replace'` triggered it, regardless of permissions),
    // suppressing the original. The expected result `[]` would have failed this assertion.
    it('falls back to the original block when ALL replace-ordered extensions are permission-denied', () => {
        hasPermissionsMock.mockReturnValue(false);

        registerBlock('replacement-1', 'replace', 'customer-list', ['perm-1']);
        registerBlock('replacement-2', 'replace', 'customer-list', ['perm-2']);

        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-original']);
    });

    // Documents the mixed-permission case: when at least one replacement is allowed,
    // the original child is suppressed (since a real replacement renders) and only
    // permitted replacements appear. Note: this scenario passes both pre- and post-fix
    // — it covers the per-block JSX gate, not `replacementBlockExists`.
    it('renders only allowed replacements when replace permissions are mixed (original suppressed)', () => {
        hasPermissionsMock.mockImplementation((perms: string[]) => perms.includes('allowed-perm'));

        registerBlock('replacement-allowed', 'replace', 'customer-list', ['allowed-perm']);
        registerBlock('replacement-denied', 'replace', 'customer-list', ['denied-perm']);

        // toEqual is exact — proves replacement-denied is absent AND original is absent
        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-replacement-allowed']);
    });

    it('falls back to the original block when a replace-ordered extension shouldRender returns false', () => {
        // Explicit: hasPermissions must return true so that shouldRender is the *only* veto under test.
        // Without this, the post-`mockReset` mock returns undefined (falsy) and the test would pass
        // for the wrong reason if check ordering inside `willBlockRender` were ever changed.
        hasPermissionsMock.mockReturnValue(true);

        registerBlock('replacement-disabled', 'replace', 'customer-list', [], () => false);

        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-original']);
    });

    it('renders only the original when both before- and replace-ordered extensions are permission-denied', () => {
        hasPermissionsMock.mockReturnValue(false);

        registerBlock('before-denied', 'before', 'customer-list', ['restricted']);
        registerBlock('replace-denied', 'replace', 'customer-list', ['restricted']);

        expect(getRenderedBlockIds(renderWithOriginal())).toEqual(['page-block-original']);
    });

    it('positions an extension action bar item before another extension item', () => {
        registerActionBarItem('a');
        registerActionBarItem('b', { itemId: 'a', order: 'before' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['b', 'a', 'save-button']);
    });

    it('positions an extension action bar item after another extension item', () => {
        registerActionBarItem('a');
        registerActionBarItem('b', { itemId: 'a', order: 'after' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['a', 'b', 'save-button']);
    });

    it('replaces an extension action bar item with another extension item', () => {
        registerActionBarItem('a');
        registerActionBarItem('b', { itemId: 'a', order: 'replace' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['b', 'save-button']);
    });

    it('keeps inline action bar item positioning behavior', () => {
        registerActionBarItem('b', { itemId: 'save-button', order: 'before' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['b', 'save-button']);
    });

    it('supports positioning relative to a positioned extension action bar item', () => {
        registerActionBarItem('a', { itemId: 'save-button', order: 'before' });
        registerActionBarItem('b', { itemId: 'a', order: 'before' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['b', 'a', 'save-button']);
    });

    it('renders a positioned extension action bar item when its target is missing', () => {
        registerActionBarItem('orphan', { itemId: 'missing', order: 'before' });

        const markup = renderActionBar();

        expect(getRenderedActionBarIds(markup)).toEqual(['save-button', 'orphan']);
    });

    it('renders cyclic positioned extension action bar items without dropping them', () => {
        registerActionBarItem('a', { itemId: 'b', order: 'before' });
        registerActionBarItem('b', { itemId: 'a', order: 'before' });

        const markup = renderActionBar();
        const renderedIds = getRenderedActionBarIds(markup);

        expect(renderedIds).toHaveLength(3);
        expect(renderedIds).toEqual(expect.arrayContaining(['a', 'b', 'save-button']));
    });
});
