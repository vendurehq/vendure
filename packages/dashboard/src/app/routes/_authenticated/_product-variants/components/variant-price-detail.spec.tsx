import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { getTaxRate, VariantPriceDetail } from './variant-price-detail.js';

vi.mock('@/vdb/hooks/use-channel.js', () => ({
    useChannel: () => ({ activeChannel: { defaultTaxZone: { id: 'zone-1' } } }),
}));

vi.mock('@/vdb/components/data-display/money.js', () => ({
    Money: ({ value }: { value: number }) => <>money:{value}</>,
}));

vi.mock('@lingui/react', () => ({
    Trans: ({ message, id, values }: { message?: string; id: string; values?: Record<string, unknown> }) => (
        <>{(message ?? id).replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key]))}</>
    ),
}));

const rates = [
    { value: 20, zone: { id: 'zone-1' }, category: { id: 'standard' } },
    { value: 5, zone: { id: 'zone-2' }, category: { id: 'standard' } },
];

function render(taxRates?: typeof rates) {
    const queryClient = new QueryClient();
    if (taxRates) {
        queryClient.setQueryData(['taxRates'], { taxRates: { items: taxRates } });
    }
    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <VariantPriceDetail
                priceIncludesTax={false}
                price={1000}
                currencyCode="USD"
                taxCategoryId="standard"
            />
        </QueryClientProvider>,
    );
}

// OSS-1512 — the gross price read "incl. 0% tax" and the net price until the tax rates loaded
describe('VariantPriceDetail', () => {
    it('shows skeletons, not 0% tax and the net price, while the tax rates load', () => {
        const markup = render();

        expect(markup).not.toContain('0% tax');
        expect(markup).not.toContain('money:');
        expect(markup.match(/data-slot="skeleton"/g)).toHaveLength(2);
    });

    it('shows the rate and the gross price once the tax rates have loaded', () => {
        const markup = render(rates);

        expect(markup).toContain('(incl. 20% tax)');
        expect(markup).toContain('money:1200');
        expect(markup).not.toContain('data-slot="skeleton"');
    });
});

describe('getTaxRate', () => {
    it('is unknown until the tax rates and the Channel have loaded', () => {
        expect(getTaxRate(undefined, 'zone-1', 'standard', true)).toBeUndefined();
        expect(getTaxRate(rates, undefined, 'standard', false)).toBeUndefined();
    });

    it('takes the rate of the category in the default tax zone, or 0', () => {
        expect(getTaxRate(rates, 'zone-1', 'standard', true)).toBe(20);
        expect(getTaxRate(rates, 'zone-1', 'reduced', true)).toBe(0);
        expect(getTaxRate(rates, undefined, 'standard', true)).toBe(0);
    });
});
