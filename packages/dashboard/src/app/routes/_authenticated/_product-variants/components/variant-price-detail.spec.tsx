import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TAX_RATES_QUERY_KEY, VariantPriceDetail } from './variant-price-detail.js';

const channelState = vi.hoisted(() => ({
    activeChannel: { defaultTaxZone: { id: 'zone-1' } } as { defaultTaxZone: { id: string } } | undefined,
}));

vi.mock('@/vdb/hooks/use-channel.js', () => ({
    useChannel: () => channelState,
}));

vi.mock('@/vdb/components/data-display/money.js', () => ({
    Money: ({ value }: { value: number }) => <>money:{value}</>,
}));

vi.mock('@lingui/react', () => ({
    useLingui: () => ({ _: (d: { message?: string; id: string }) => d.message ?? d.id }),
    Trans: ({ message, id, values }: { message?: string; id: string; values?: Record<string, unknown> }) => (
        <>{(message ?? id).replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key]))}</>
    ),
}));

const rates = [
    { value: 20, zone: { id: 'zone-1' }, category: { id: 'standard' } },
    { value: 5, zone: { id: 'zone-2' }, category: { id: 'standard' } },
];

function render(taxRates?: typeof rates, priceIncludesTax = false) {
    const queryClient = new QueryClient();
    if (taxRates) {
        queryClient.setQueryData(TAX_RATES_QUERY_KEY, { taxRates: { items: taxRates } });
    }
    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <VariantPriceDetail
                priceIncludesTax={priceIncludesTax}
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
        expect(markup).toContain('data-slot="tax-rate-skeleton"');
        expect(markup).toContain('data-slot="gross-price-skeleton"');
    });

    it('shows skeletons while the Channel loads', () => {
        channelState.activeChannel = undefined;
        const markup = render(rates);
        channelState.activeChannel = { defaultTaxZone: { id: 'zone-1' } };

        expect(markup).toContain('data-slot="gross-price-skeleton"');
    });

    it('shows the rate and the gross price once the tax rates have loaded', () => {
        const markup = render(rates);

        expect(markup).toContain('(incl. 20% tax)');
        expect(markup).toContain('money:1200');
        expect(markup).not.toContain('skeleton');
    });

    it('shows the price as the gross price when prices include tax', () => {
        expect(render(rates, true)).toContain('money:1000');
    });
});
