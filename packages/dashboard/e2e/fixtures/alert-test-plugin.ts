import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin that registers a dashboard alert through a SEPARATE
 * `defineDashboardExtension` call from {@link FormInputsTestPlugin}. The
 * combination of two plugins each contributing extensions is the trigger for
 * #4729 — see `alert-test-dashboard/index.tsx` for the alert definition and
 * `tests/regression/issue-4729-alerts-do-not-poll-multi-plugin.spec.ts` for
 * the regression test.
 */
@VendurePlugin({
    dashboard: './alert-test-dashboard/index.tsx',
})
export class AlertTestPlugin {}
