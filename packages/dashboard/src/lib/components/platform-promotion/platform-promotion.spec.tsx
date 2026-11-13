import { getLockedPageCard } from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import {
    getFixtureCapability as capability,
    createPlatformPromotionState,
    platformPromotionFixture,
} from '@/vdb/framework/platform-promotion/platform-promotion.fixture.js';
import type { PlatformPromotionState } from '@/vdb/hooks/use-platform-promotion.js';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LockedCapabilityPage } from './locked-capability-page.js';
import { LockedTierLabel, PlatformPromoPanel } from './platform-promo.js';
import { PlatformPromotionPageCard } from './platform-promotion-page-card.js';

const promotionState = vi.hoisted(() => ({ current: undefined as unknown as PlatformPromotionState }));

vi.mock('@/vdb/hooks/use-platform-promotion.js', () => ({
    usePlatformPromotion: () => promotionState.current,
    getPlatformPromotion: () => promotionState.current,
}));

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<object>()),
    Navigate: ({ to }: { to: string }) => <a data-navigate={to} />,
}));

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function render(node: React.ReactNode) {
    return renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
}

function hrefs(markup: string) {
    return [...markup.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
}

describe('platform promotion UI', () => {
    beforeEach(() => {
        promotionState.current = createPlatformPromotionState();
    });

    it('shows title, tier, summary, three benefits and the trial link', () => {
        const quotes = capability('quote.requests');
        const markup = render(<PlatformPromoPanel promotion={quotes} />);
        expect(markup).toContain(quotes.title);
        expect(markup).toContain('Starter plan');
        expect(markup).toContain(quotes.summary);
        expect(markup.match(/<li /g)).toHaveLength(3);
        expect(markup).toContain('Start free trial');
        expect(hrefs(markup)).toEqual([
            'https://vendure.io/pricing?utm_source=vendure-dashboard&utm_medium=locked-feature' +
                '&utm_campaign=starter&utm_content=quote.requests',
        ]);
    });

    it('shows the vendure add command on localhost for trial capabilities', () => {
        expect(window.location.hostname).toBe('localhost');
        expect(render(<PlatformPromoPanel promotion={capability('quote.requests')} />)).toContain(
            'npx vendure add',
        );
        expect(render(<PlatformPromoPanel promotion={capability('configurator')} />)).not.toContain(
            'npx vendure add',
        );
    });

    it('links Enterprise capabilities to sales', () => {
        const markup = render(<PlatformPromoPanel promotion={capability('configurator')} />);
        expect(markup).toContain('Talk to sales');
        expect(hrefs(markup)[0]).toMatch(/^https:\/\/vendure\.io\/contact\?/);
    });

    it('shows "Upgrade to <tier>" when the project has a partial grant', () => {
        promotionState.current = createPlatformPromotionState(['org.accounts']);
        expect(render(<LockedTierLabel promotion={capability('approval.orders')} />)).toContain(
            'Upgrade to Scale',
        );
        expect(render(<PlatformPromoPanel promotion={capability('approval.orders')} />)).toContain(
            'Upgrade to Scale',
        );
    });

    it('shows the tier label when nothing is granted', () => {
        const markup = render(<LockedTierLabel promotion={capability('approval.orders')} />);
        expect(markup).toContain('Scale');
        expect(markup).not.toContain('Upgrade');
    });

    it('waits on the locked page while License Guard has not reported the granted set', () => {
        const navItem = platformPromotionFixture.navItems.find(i => i.id === 'companies')!;
        promotionState.current = createPlatformPromotionState([], true);
        expect(render(<LockedCapabilityPage navItem={navItem} />)).toBe('');
        promotionState.current = createPlatformPromotionState(['org.accounts']);
        expect(render(<LockedCapabilityPage navItem={navItem} />)).toBe('<a data-navigate="/"></a>');
    });

    it('summarises all locked capabilities of a page in one collapsed card', () => {
        const card = getLockedPageCard(promotionState.current, 'order-detail')!;
        const markup = render(
            <PlatformPromotionPageCard
                pageId="order-detail"
                card={card}
                column={card.column}
                blockId="platform-promotion"
            />,
        );
        expect(card.capabilities.length).toBeGreaterThan(0);
        expect(markup).toContain(
            `${card.capabilities.length} more for orders with Vendure Platform: ${card.capabilities.map(c => c.title).join(', ')}`,
        );
        expect(markup.match(/data-testid="platform-promotion-page-card"/g)).toHaveLength(1);
    });
});
