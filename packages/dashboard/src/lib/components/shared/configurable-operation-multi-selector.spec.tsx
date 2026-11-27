import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConfigurableOperationMultiSelector } from './configurable-operation-multi-selector.js';

vi.mock('@lingui/react', () => ({
    useLingui: () => ({ _: (d: { message?: string; id: string }) => d.message ?? d.id }),
    Trans: ({ message, id }: { message?: string; id: string }) => <>{message ?? id}</>,
}));

vi.mock('@/vdb/hooks/use-user-settings.js', () => ({
    useUserSettings: () => ({ settings: { displayLanguage: 'en', devMode: false } }),
}));

const savedFilters = [
    { code: 'facet-value-filter', arguments: [{ name: 'facetValueIds', value: '["1"]' }] },
    {
        code: 'variant-name-filter',
        arguments: [
            { name: 'term', value: 'laptop' },
            { name: 'combineWithAnd', value: 'false' },
        ],
    },
];

function render(definitions?: unknown[], variant?: 'sentence' | 'form') {
    const queryClient = new QueryClient();
    if (definitions) {
        queryClient.setQueryData(['collectionFilters'], { collectionFilters: definitions });
    }
    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <ConfigurableOperationMultiSelector
                value={savedFilters}
                onChange={() => {}}
                queryKey="collectionFilters"
                queryDocument={{}}
                dataPath="collectionFilters"
                buttonText="Add collection filter"
                variant={variant}
            />
        </QueryClientProvider>,
    );
}

// OSS-1513 — the Filters card showed no filters until their definitions loaded, then grew
describe('ConfigurableOperationMultiSelector', () => {
    it('shows a skeleton row for each saved operation while the definitions load', () => {
        const markup = render();

        expect(markup).toContain('aria-busy="true"');
        expect(markup.match(/data-slot="operation-skeleton"/g)).toHaveLength(savedFilters.length);
    });

    it('shows the AND/OR pill of a skeleton row, which needs no definition', () => {
        const markup = render();

        expect(markup).toContain('AND');
        expect(markup).toContain('OR');
    });

    it('shows the rows once the definitions have loaded', () => {
        const markup = render([
            {
                code: 'variant-name-filter',
                description: 'Filter by product variant name',
                args: [
                    { name: 'term', type: 'string', list: false, required: true, ui: null },
                    { name: 'combineWithAnd', type: 'boolean', list: false, required: false, ui: null },
                ],
            },
        ]);

        expect(markup).not.toContain('data-slot="operations-skeleton"');
        expect(markup).toContain('laptop');
    });

    it('keeps no placeholder for the form variant, whose rows are cards', () => {
        expect(render(undefined, 'form')).not.toContain('data-slot="operations-skeleton"');
    });
});
