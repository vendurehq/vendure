import {
    addListQueryDocument,
    getListQueryDocuments,
} from '@/vdb/framework/data-table/data-table-extensions.js';
import { FullWidthPageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { UserSettingsContext, type UserSettingsContextType } from '@/vdb/providers/user-settings.js';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { parse } from 'graphql';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CollectionContentsSheet } from './collection-contents-sheet.js';

// Render the sheet content inline, so the nested table renders without opening the sheet.
vi.mock('@/vdb/components/ui/sheet.js', () => {
    const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
    return {
        Sheet: Passthrough,
        SheetContent: Passthrough,
        SheetDescription: Passthrough,
        SheetHeader: Passthrough,
        SheetTitle: Passthrough,
        SheetTrigger: Passthrough,
    };
});

// Stands in for the nested table and resolves list query extensions the same way
// `useExtendedListQuery` does: by the surrounding page and block IDs.
vi.mock('./collection-contents-table.js', () => ({
    CollectionContentsTable: () => {
        const { pageId } = usePage();
        const { blockId } = usePageBlock() ?? {};
        const extensions = pageId && blockId ? getListQueryDocuments(pageId, blockId) : [];
        return <div data-testid="nested-table" data-block-id={blockId} data-extensions={extensions.length} />;
    },
}));

function renderInCollectionList(children: React.ReactNode) {
    const noop = () => undefined;
    const userSettings = {
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
        setTableSettings: noop,
        setWidgetLayout: noop,
    } as UserSettingsContextType;

    return renderToStaticMarkup(
        <I18nProvider i18n={setupI18n({ locale: 'en', messages: { en: {} } })}>
            <UserSettingsContext.Provider value={userSettings}>
                <PageContext.Provider value={{ pageId: 'collection-list' }}>
                    <FullWidthPageBlock blockId="list-table">{children}</FullWidthPageBlock>
                </PageContext.Provider>
            </UserSettingsContext.Provider>
        </I18nProvider>,
    );
}

describe('CollectionContentsSheet', () => {
    // #5790: list query extensions for the collection list must not apply to the nested contents table
    it('does not apply collection-list table extensions to the nested contents table', () => {
        addListQueryDocument(
            'collection-list',
            undefined,
            parse(`query { collections { items { translations { languageCode } } } }`),
        );

        const html = renderInCollectionList(
            <CollectionContentsSheet collectionId="2" collectionName="Electronics">
                34 variants
            </CollectionContentsSheet>,
        );

        expect(html).toContain('data-testid="nested-table"');
        expect(html).not.toContain('data-block-id="list-table"');
        expect(html).toContain('data-extensions="0"');
    });
});
