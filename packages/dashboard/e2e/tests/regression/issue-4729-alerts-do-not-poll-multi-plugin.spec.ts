import { expect, test } from '@playwright/test';

// #4729 — When two or more plugins each call `defineDashboardExtension`, the
// alert polling never started. Root cause was `AlertsProvider` snapshotting
// `getAlertRegistry()` in its mount effect — but React fires child effects
// before parent effects, and the extension registration callbacks are queued
// during render and only executed inside `App`'s post-mount effect. The
// snapshot was therefore always empty, `alertDefs` stayed `[]` forever, and
// `useQueries` never built any observers.
//
// The fixtures wire two separate plugins through the Vite config:
//   - FormInputsTestPlugin     — contributes routes
//   - AlertTestPlugin          — contributes a single always-on alert
//
// If the bug regresses, the alert bell button never renders (the `Alerts`
// component short-circuits to `null` when `alerts.length === 0`).
test.describe('Issue 4729 — dashboard alerts with multiple extension plugins', () => {
    test('should render the alert bell with an active count when alerts come from a separate plugin', async ({
        page,
    }) => {
        // initialDelayMs in alerts-provider.tsx is 5_000 — give the alert
        // enough time to poll once and become active.
        test.setTimeout(30_000);

        await page.goto('/');

        // The alert bell only renders if `useAlerts` returned a non-empty
        // `alerts` array, i.e. the registry was actually picked up. Locate it
        // by the BellIcon's lucide class name (the button itself has no
        // accessible name).
        const bellIcon = page.locator('button:has(svg.lucide-bell)');
        await expect(bellIcon).toBeVisible({ timeout: 15_000 });

        // The active-count badge appears once the alert's `check()` has
        // resolved and `shouldShow(data)` returned true (`{ active: true }`
        // in the fixture).
        await expect(bellIcon.locator('text=1')).toBeVisible({ timeout: 15_000 });
    });
});
