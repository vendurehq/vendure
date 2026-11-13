import { describe, expect, it } from 'vitest';

import { registerDashboardPageBlock } from '../layout-engine/layout-extensions.js';

import {
    getLockedPageActions,
    getLockedPageCard,
    getPromotionUrl,
    isLocalhost,
    isUpgrade,
} from './locked-capabilities.js';
import {
    platformPromotionFixture,
    createPlatformPromotionState as state,
} from './platform-promotion.fixture.js';

describe('getLockedPageCard', () => {
    it('gives one card per page with each capability once', () => {
        const card = getLockedPageCard(state(), 'order-detail');
        expect(card?.capabilities.map(c => c.key)).toEqual([
            'approval.orders',
            'org.hierarchy',
            'configurator',
            'store-credit.balance',
            'quote.requests',
        ]);
    });

    it('puts the card in the column that holds most blocks', () => {
        expect(getLockedPageCard(state(), 'order-detail')?.column).toBe('side');
        expect(getLockedPageCard(state(), 'product-variant-detail')?.column).toBe('main');
    });

    it('leaves out granted capabilities, and gives no card when all are granted', () => {
        expect(getLockedPageCard(state(['org.accounts']), 'customer-detail')?.capabilities).toHaveLength(2);
        expect(
            getLockedPageCard(
                state(['org.accounts', 'quote.requests', 'tax-id.validation']),
                'customer-detail',
            ),
        ).toBeUndefined();
    });

    it('gives no card for pages without blocks, or when all are hidden', () => {
        expect(getLockedPageCard(state(), 'facet-detail')).toBeUndefined();
        expect(getLockedPageCard(state(), undefined)).toBeUndefined();
        expect(getLockedPageCard(state([], true), 'order-detail')).toBeUndefined();
    });
    it('leaves out blocks which an installed Platform plugin registered on the page', () => {
        registerDashboardPageBlock({
            id: 'customer-company-users',
            location: {
                pageId: 'customer-detail',
                column: 'side',
                position: { blockId: 'groups', order: 'after' },
            },
            component: () => null,
        });
        expect(getLockedPageCard(state(), 'customer-detail')?.capabilities.map(c => c.key)).not.toContain(
            'org.accounts',
        );
    });
});

describe('getLockedPageActions', () => {
    it('returns the locked actions of the page', () => {
        expect(getLockedPageActions(state(), 'product-detail').map(a => a.label)).toEqual([
            'Audit Log',
            'Save Draft',
        ]);
        expect(getLockedPageActions(state(['content.history']), 'product-detail')).toHaveLength(1);
        expect(getLockedPageActions(state([], true), 'product-detail')).toEqual([]);
    });
});

describe('getPromotionUrl', () => {
    const find = (key: string) => platformPromotionFixture.capabilities.find(c => c.key === key)!;

    it('links trial capabilities to the pricing page with UTM parameters only', () => {
        expect(getPromotionUrl(find('quote.requests'))).toBe(
            'https://vendure.io/pricing?utm_source=vendure-dashboard&utm_medium=locked-feature' +
                '&utm_campaign=starter&utm_content=quote.requests',
        );
    });

    it('links sales capabilities to the contact page', () => {
        expect(getPromotionUrl(find('configurator'))).toBe(
            'https://vendure.io/contact?utm_source=vendure-dashboard&utm_medium=locked-feature' +
                '&utm_campaign=enterprise&utm_content=configurator',
        );
    });
});

describe('isUpgrade', () => {
    it('is true only when some capabilities are granted', () => {
        expect(isUpgrade(state())).toBe(false);
        expect(isUpgrade(state(['org.accounts']))).toBe(true);
    });
});

describe('isLocalhost', () => {
    it('detects local hosts', () => {
        expect(['localhost', '127.0.0.1', '[::1]', 'shop.localhost'].every(isLocalhost)).toBe(true);
        expect(['shop.example.com', 'localhost.example.com'].some(isLocalhost)).toBe(false);
    });
});
