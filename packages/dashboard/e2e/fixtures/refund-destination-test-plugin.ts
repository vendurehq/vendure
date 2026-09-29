import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin which contributes the dashboard-side definition of the `store-credit` refund
 * destination. The backend strategy itself is registered via `e2eRefundDestinations` in
 * e2e-shared-config.ts. See `refund-destination-test-dashboard/index.tsx`.
 */
@VendurePlugin({
    dashboard: './refund-destination-test-dashboard/index.tsx',
})
export class RefundDestinationTestPlugin {}
