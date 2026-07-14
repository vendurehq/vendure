import { defineDashboardExtension } from '@vendure/dashboard';

// #4729 — separate plugin registering ONLY alerts.
//
// Reproducing the original bug requires two plugins each calling
// `defineDashboardExtension` independently — when alerts live in their own
// plugin and another plugin (`FormInputsTestPlugin`) also registers
// extensions, the original `AlertsProvider` would snapshot an empty registry
// and never poll. See vendurehq/vendure#4729.
defineDashboardExtension({
    alerts: [
        {
            id: 'oss-535-test-alert',
            title: 'OSS-535 regression alert',
            severity: 'info',
            check: () => 1,
            // `shouldShow` is invoked with `undefined` on the initial render
            // before `check()` resolves, so guard the access — matches the
            // shape used by the built-in `searchIndexBufferAlert`.
            shouldShow: data => (data ?? 0) > 0,
        },
    ],
});
