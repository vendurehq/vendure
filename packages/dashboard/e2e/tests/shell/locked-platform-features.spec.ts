import { type Page, expect, test } from '@playwright/test';
import { platformPromotionSnapshot as snapshot } from '@vendure/common/lib/platform-promotion-snapshot';

import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// OSS-891: locked Vendure Platform items in an OSS-only project (no License Guard in the
// e2e Vendure config). The build uses the catalog snapshot that ships with the Dashboard.

// The expected values come from the snapshot, so a catalog refresh does not break the tests.
const lockedItem = snapshot.navItems.find(item => item.promoted && item.sectionId === 'customers')!;
const lockedCapability = snapshot.capabilities.find(c => c.key === lockedItem.capability)!;
const customerCardCount = new Set(
    snapshot.pageBlocks.filter(b => b.pageId === 'customer-detail').map(b => b.capability),
).size;

const BLOCKED_HOSTS =
    /api\.vendure\.io|posthog|google-analytics|googletagmanager|segment\.(io|com)|mixpanel|amplitude|plausible|hotjar/;

/**
 * Records the animation frame in which each selector first matches, so a test can check
 * that locked items paint in the same frame as the content around them.
 */
async function recordFirstFrames(page: Page, selectors: Record<string, string>) {
    await page.addInitScript(watched => {
        const state = { frame: 0, first: {} as Record<string, number> };
        (window as unknown as { __firstFrames: typeof state }).__firstFrames = state;
        const tick = () => {
            state.frame++;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        new MutationObserver(() => {
            for (const [key, selector] of Object.entries(watched)) {
                if (state.first[key] === undefined && document.querySelector(selector)) {
                    state.first[key] = state.frame;
                }
            }
        }).observe(document, { childList: true, subtree: true });
    }, selectors);
}

async function getFirstFrames(page: Page): Promise<Record<string, number>> {
    return page.evaluate(
        () => (window as unknown as { __firstFrames: { first: Record<string, number> } }).__firstFrames.first,
    );
}

async function firstId(page: Page, query: string, field: string): Promise<string> {
    const client = new VendureAdminClient(page);
    await client.login();
    const result = await client.gql(query);
    const id = result[field].items[0]?.id;
    expect(id).toBeTruthy();
    return id;
}

test.describe('Locked Platform features', () => {
    const requests: string[] = [];

    test.beforeEach(async ({ page }) => {
        requests.length = 0;
        page.on('request', request => requests.push(request.url()));
    });

    test.afterEach(() => {
        // No browser request to api.vendure.io or to any analytics service.
        expect(requests.filter(url => BLOCKED_HOSTS.test(new URL(url).hostname))).toEqual([]);
    });

    test('paints the locked nav items in the same frame as the built-in items', async ({ page }) => {
        await recordFirstFrames(page, {
            builtIn: '[data-slot="sidebar"] a[href$="/customers"]',
            locked: '[data-slot="sidebar"] [data-testid="locked-nav-icon"]',
        });
        await page.goto('/customers');
        const sidebar = page.locator('[data-slot="sidebar"]');
        const link = sidebar.getByRole('link', { name: new RegExp(lockedItem.label) });
        await expect(link).toBeVisible();
        const icon = link.getByTestId('locked-nav-icon');
        await expect(icon).toBeVisible();

        const frames = await getFirstFrames(page);
        expect(frames.builtIn).toBeDefined();
        expect(frames.locked).toBe(frames.builtIn);

        // A locked row has the height of a built-in row, and the tier shows in a tooltip only.
        const builtInBox = await sidebar.getByRole('link', { name: 'Customer Groups' }).boundingBox();
        const lockedBox = await link.boundingBox();
        expect(lockedBox?.height).toBe(builtInBox?.height);
        // The tier text in the row is for screen readers only.
        await expect(link.getByText(/starter|growth|scale|enterprise/i)).toHaveClass(/sr-only/);
        await icon.hover();
        await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
            new RegExp(`${lockedCapability.tier} plan`, 'i'),
        );
    });

    test('opens a blurred locked page with the promo at the Platform route', async ({ page }) => {
        await page.goto('/customers');
        await page
            .locator('[data-slot="sidebar"]')
            .getByRole('link', { name: new RegExp(lockedItem.label) })
            .click();
        await expect(page).toHaveURL(new RegExp(`${lockedItem.url}$`));

        const placeholder = page.getByTestId('locked-capability-placeholder');
        await expect(placeholder).toHaveAttribute('aria-hidden', 'true');
        await expect(placeholder).toHaveClass(/blur/);

        const panel = page.getByTestId('platform-promo-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('li')).toHaveCount(3);
        const href = await panel.getByTestId('platform-promo-cta').getAttribute('href');
        const url = new URL(href ?? '');
        expect(`${url.origin}${url.pathname}`).toBe('https://vendure.io/pricing');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            utm_source: 'vendure-dashboard',
            utm_medium: 'locked-feature',
            utm_campaign: lockedCapability.tier,
            utm_content: lockedCapability.key,
        });
        // The Dashboard runs on localhost here, so the developer command shows.
        await expect(panel.getByText('npx vendure add')).toBeVisible();
    });

    test('shows one collapsed card for the locked blocks of a page', async ({ page }) => {
        const customerId = await firstId(
            page,
            'query { customers(options: { take: 1 }) { items { id } } }',
            'customers',
        );
        await recordFirstFrames(page, {
            heading: '[data-testid="page-heading"]',
            card: '[data-testid="platform-promotion-page-card"]',
        });
        await page.goto(`/customers/${customerId}`);

        const card = page.getByTestId('platform-promotion-page-card');
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(`${customerCardCount} more for customers with Vendure Platform`);
        const frames = await getFirstFrames(page);
        expect(frames.card).toBe(frames.heading);

        await card.getByRole('button').first().click();
        await card.getByRole('listitem').first().getByRole('button').click();
        await expect(page.getByRole('dialog').getByTestId('platform-promo-panel')).toBeVisible();
    });

    test('adds "More with Platform" to the action menu of a page', async ({ page }) => {
        const productId = await firstId(
            page,
            'query { products(options: { take: 1 }) { items { id } } }',
            'products',
        );
        await page.goto(`/products/${productId}`);

        await page.getByTestId('action-bar-dropdown-trigger').click();
        await page.getByTestId('platform-promotion-action').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('listitem').first().getByRole('button').click();
        await expect(dialog.getByTestId('platform-promo-panel')).toBeVisible();
    });
});
