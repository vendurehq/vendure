import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConfigurableOperationMultiSelector } from './configurable-operation-multi-selector.js';

vi.mock('@lingui/react', () => ({
    useLingui: () => ({ _: (d: { message?: string; id: string }) => d.message ?? d.id }),
    Trans: ({ message, id }: { message?: string; id: string }) => <>{message ?? id}</>,
}));

const savedFilters = [
    { code: 'facet-value-filter', arguments: [{ name: 'facetValueIds', value: '["1"]' }] },
    { code: 'variant-name-filter', arguments: [{ name: 'term', value: 'laptop' }] },
];

function render(definitions?: unknown[]) {
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
            />
        </QueryClientProvider>,
    );
}

// OSS-1513 — the Filters card showed no filters until their definitions loaded, then grew
describe('ConfigurableOperationMultiSelector', () => {
    it('shows a skeleton row for each saved operation while the definitions load', () => {
        const markup = render();

        expect(markup).toContain('data-slot="operations-skeleton"');
        expect(markup.match(/class="flex h-8 items-center/g)).toHaveLength(savedFilters.length);
    });

    it('shows no skeleton once the definitions have loaded', () => {
        expect(render([])).not.toContain('data-slot="operations-skeleton"');
    });
});
