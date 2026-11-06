import {
    UserSettingsContext,
    type UserSettingsContextType,
    UserSettingsProvider,
} from '@/vdb/providers/user-settings.js';
import { LS_KEY_USER_SETTINGS } from '@/vdb/storage-keys.js';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePaginatedChildCollections } from './use-paginated-child-collections.js';

const apiMock = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));

vi.mock('@/vdb/graphql/api.js', () => ({ api: apiMock }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('usePaginatedChildCollections', () => {
    let container: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;
    let settings: UserSettingsContextType;
    let hookResult: ReturnType<typeof usePaginatedChildCollections<{ id: string; name: string }>>;
    let fetchedLanguages: string[];
    let nameVersion: number;

    const storedContentLanguage = () =>
        JSON.parse(localStorage.getItem(LS_KEY_USER_SETTINGS) ?? '{}').contentLanguage;

    const fetchChildren = async (parentId: string, take: number, skip: number) => {
        const language = storedContentLanguage();
        fetchedLanguages.push(language);
        return {
            items: [{ id: `${parentId}-child`, name: `${language}-${nameVersion}-skip${skip}` }],
            totalItems: take + 1,
        };
    };

    function Probe({ expandedIds }: Readonly<{ expandedIds: string[] }>) {
        settings = useContext(UserSettingsContext)!;
        hookResult = usePaginatedChildCollections({
            expandedIds,
            pageSize: 1,
            queryKeyPrefix: 'childCollections',
            fetchChildren,
        });
        return null;
    }

    async function flush() {
        for (let i = 0; i < 5; i++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }
    }

    async function render(expandedIds: string[]) {
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <UserSettingsProvider queryClient={queryClient}>
                        <Probe expandedIds={expandedIds} />
                    </UserSettingsProvider>
                </QueryClientProvider>,
            );
        });
        await flush();
    }

    const childNames = (parentId: string) => hookResult.accumulatedChildren[parentId]?.items.map(i => i.name);

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(LS_KEY_USER_SETTINGS, JSON.stringify({ contentLanguage: 'en' }));
        fetchedLanguages = [];
        nameVersion = 1;
        apiMock.query.mockReset();
        apiMock.mutate.mockReset();
        apiMock.query.mockResolvedValue({ getSettingsStoreValue: null });
        apiMock.mutate.mockResolvedValue({ setSettingsStoreValue: { result: true } });
        queryClient = new QueryClient({ defaultOptions: { queries: { placeholderData: keepPreviousData } } });
        container = document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        queryClient.clear();
    });

    it('loads the children of expanded parents in the current content language', async () => {
        await render(['1', '2']);

        expect(childNames('1')).toEqual(['en-1-skip0']);
        expect(childNames('2')).toEqual(['en-1-skip0']);
    });

    it('reloads the children of expanded parents when the content language changes', async () => {
        await render(['1', '2']);
        expect(childNames('1')).toEqual(['en-1-skip0']);

        await act(async () => settings.setContentLanguage('de'));
        await flush();

        expect(childNames('1')).toEqual(['de-1-skip0']);
        expect(childNames('2')).toEqual(['de-1-skip0']);
        expect(fetchedLanguages).toEqual(['en', 'en', 'de', 'de']);
    });

    it('loads further pages in the new content language after a change', async () => {
        await render(['1']);
        await act(async () => settings.setContentLanguage('de'));
        await flush();

        await act(async () => hookResult.handleLoadMoreChildren('1'));
        await flush();

        expect(childNames('1')).toEqual(['de-1-skip0', 'de-1-skip1']);
    });

    it('does not serve cached children of an earlier language when switching back', async () => {
        await render(['1']);
        await act(async () => settings.setContentLanguage('de'));
        await flush();
        expect(childNames('1')).toEqual(['de-1-skip0']);

        nameVersion = 2;
        await act(async () => settings.setContentLanguage('en'));
        await flush();

        expect(childNames('1')).toEqual(['en-2-skip0']);
    });

    it('does not refetch the children when the content language stays the same', async () => {
        await render(['1']);
        await act(async () => settings.setTheme('dark'));
        await flush();

        expect(fetchedLanguages).toEqual(['en']);
        expect(childNames('1')).toEqual(['en-1-skip0']);
    });
});
