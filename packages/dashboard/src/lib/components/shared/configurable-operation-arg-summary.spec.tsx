import type { ConfigurableFieldDef } from '@/vdb/framework/form-engine/form-engine-types.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
    ArgSummary,
    compactText,
    getJsonSummary,
    shouldUseListCountSummary,
} from './configurable-operation-arg-summary.js';

vi.mock('@lingui/react', () => ({
    useLingui: () => ({
        _: (d: { message?: string; id: string; values?: Record<string, unknown> }) =>
            (d.message ?? d.id).replace(/\{(\w+)\}/g, (_, key: string) => String(d.values?.[key])),
    }),
}));

// The facet value input lists its own values, so its summary names them
vi.mock('@/vdb/framework/extension-api/input-component-extensions.js', () => ({
    getInputComponent: () => ({ metadata: { isListInput: true } }),
}));

describe('shouldUseListCountSummary', () => {
    it('uses a count when a scalar component is wrapped for a list field', () => {
        expect(shouldUseListCountSummary(true, [100, 200], undefined)).toBe(true);
    });

    it('keeps semantic summaries for list-aware components', () => {
        expect(shouldUseListCountSummary(true, ['1', '2'], true)).toBe(false);
        expect(shouldUseListCountSummary(true, ['1', '2'], 'dynamic')).toBe(false);
    });
});

describe('compactText', () => {
    it('strips HTML and normalizes whitespace', () => {
        expect(
            compactText(
                '<style>.hidden { display: none }</style><p>Hello <strong>world</strong></p><p>Next</p>',
            ).full,
        ).toBe('Hello world Next');
    });

    it('truncates long content for sentence chips', () => {
        const result = compactText('a'.repeat(100));
        expect(result.compact).toHaveLength(80);
        expect(result.compact.endsWith('\u2026')).toBe(true);
    });
});

describe('getJsonSummary', () => {
    it('summarizes arrays and objects', () => {
        expect(getJsonSummary('[1, 2, 3]')).toEqual({ type: 'items', count: 3 });
        expect(getJsonSummary('{"one": 1, "two": 2}')).toEqual({ type: 'properties', count: 2 });
    });

    it('uses compact text for invalid JSON', () => {
        expect(getJsonSummary('not json')).toEqual({ type: 'text', value: 'not json' });
    });
});

// OSS-1513 — a facet value filter read "1 selected" until the facet value names loaded
describe('ArgSummary of entity ids', () => {
    const fieldDef = {
        name: 'facetValueIds',
        type: 'ID',
        list: true,
        required: false,
        ui: { component: 'facet-value-form-input' },
    } as ConfigurableFieldDef;

    function render(
        facetValues?: Array<{ id: string; name: string; facet: { name: string } }>,
        failed = false,
    ) {
        // A failed query that has used its retries is not fetched again on mount
        const queryClient = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
        if (failed) {
            queryClient
                .getQueryCache()
                .build(queryClient, { queryKey: ['FacetValueSummary', ['1']] })
                .setState({ status: 'error', error: new Error('failed'), fetchStatus: 'idle' });
        }
        if (facetValues) {
            queryClient.setQueryData(['FacetValueSummary', ['1']], {
                facetValues: { items: facetValues },
            });
        }
        return renderToStaticMarkup(
            <QueryClientProvider client={queryClient}>
                <ArgSummary fieldDef={fieldDef} value='["1"]' />
            </QueryClientProvider>,
        );
    }

    it('shows a skeleton, not a count, while the names load', () => {
        const markup = render();

        expect(markup).toContain('data-slot="arg-summary-skeleton"');
        expect(markup).not.toContain('selected');
    });

    it('shows the names once they have loaded', () => {
        const markup = render([{ id: '1', name: 'Electronics', facet: { name: 'category' } }]);

        expect(markup).toContain('Electronics (category)');
        expect(markup).not.toContain('data-slot="arg-summary-skeleton"');
    });

    it('shows the count when the names cannot load', () => {
        const markup = render(undefined, true);

        expect(markup).toContain('1 selected');
        expect(markup).not.toContain('data-slot="arg-summary-skeleton"');
    });
});
