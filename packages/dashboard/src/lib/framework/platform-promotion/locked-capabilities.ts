import type { PlatformPromotionState } from '@/vdb/hooks/use-platform-promotion.js';

import { getDashboardPageBlocks } from '../layout-engine/layout-extensions.js';

import type { DashboardPromotionCapabilityV1 } from './platform-promotion-types.js';

export const PLATFORM_PRICING_URL = 'https://vendure.io/pricing';
export const PLATFORM_CONTACT_URL = 'https://vendure.io/contact';

export interface LockedPageCard {
    column: 'main' | 'side';
    capabilities: DashboardPromotionCapabilityV1[];
}

export interface LockedPageAction {
    label: string;
    promotion: DashboardPromotionCapabilityV1;
}

/**
 * Returns the copy of the capability when the Dashboard shows it as locked, or `undefined`
 * when it is granted, when all locked items are hidden, or when the catalog has no copy for it.
 */
export function getLockedCapability(
    state: PlatformPromotionState,
    key: string,
): DashboardPromotionCapabilityV1 | undefined {
    return state.isLocked(key) ? state.capabilities.get(key) : undefined;
}

/**
 * The project has a plan (some capabilities are granted), so the locked entries
 * belong to a higher tier and show "Upgrade to <tier>".
 */
export function isUpgrade(state: PlatformPromotionState): boolean {
    return state.grantedCapabilities.size > 0;
}

/**
 * One card per page for the locked capabilities which put page blocks on it. The card goes
 * in the column that holds most of those blocks. A block which an installed Platform plugin
 * already registered on the page is not promoted.
 */
export function getLockedPageCard(
    state: PlatformPromotionState,
    pageId: string | undefined,
): LockedPageCard | undefined {
    if (!pageId) {
        return undefined;
    }
    const installed = new Set(getDashboardPageBlocks(pageId).map(block => block.id));
    const blocks = state.promotion.pageBlocks.filter(
        block =>
            block.pageId === pageId &&
            !installed.has(block.blockId) &&
            getLockedCapability(state, block.capability),
    );
    if (!blocks.length) {
        return undefined;
    }
    const keys = [...new Set(blocks.map(block => block.capability))];
    const sideCount = blocks.filter(block => block.column === 'side').length;
    return {
        column: sideCount > blocks.length - sideCount ? 'side' : 'main',
        capabilities: keys.flatMap(key => getLockedCapability(state, key) ?? []),
    };
}

export function getLockedPageActions(
    state: PlatformPromotionState,
    pageId: string | undefined,
): LockedPageAction[] {
    return state.promotion.actions.flatMap(action => {
        const promotion =
            action.pageId === pageId ? getLockedCapability(state, action.capability) : undefined;
        return promotion ? [{ label: action.label, promotion }] : [];
    });
}

/** The outbound link of the overlay. It carries UTM parameters only. */
export function getPromotionUrl(promotion: DashboardPromotionCapabilityV1): string {
    const url = new URL(promotion.cta === 'sales' ? PLATFORM_CONTACT_URL : PLATFORM_PRICING_URL);
    url.searchParams.set('utm_source', 'vendure-dashboard');
    url.searchParams.set('utm_medium', 'locked-feature');
    url.searchParams.set('utm_campaign', promotion.tier);
    url.searchParams.set('utm_content', promotion.key);
    return url.toString();
}

export function isLocalhost(hostname: string): boolean {
    return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||
        hostname.endsWith('.localhost')
    );
}
