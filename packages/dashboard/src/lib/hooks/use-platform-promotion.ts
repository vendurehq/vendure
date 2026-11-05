import {
    getReportedPlatformGrantedCapabilities,
    subscribeToPlatformGrantedCapabilities,
} from '@/vdb/framework/platform-promotion/platform-granted-capabilities.js';
import {
    DashboardPromotionCapabilityV1,
    DashboardPromotionV1,
} from '@/vdb/framework/platform-promotion/platform-promotion-types.js';
import { useSyncExternalStore } from 'react';
import {
    dashboardPromotion,
    licenseGuardConfigured,
    platformPromotionEnabled,
} from 'virtual:vendure-platform-promotion';

/**
 * @description
 * The data that the Dashboard needs to show locked Vendure Platform items. It is
 * returned by {@link usePlatformPromotion}.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.9.0
 */
export interface PlatformPromotionState {
    /**
     * @description
     * The Platform catalog data, read at build time. If the build could not fetch it,
     * this is the snapshot that ships with `@vendure/common`.
     */
    promotion: DashboardPromotionV1;
    /**
     * @description
     * `promotion.capabilities`, keyed by capability key.
     */
    capabilities: ReadonlyMap<string, DashboardPromotionCapabilityV1>;
    /**
     * @description
     * `true` when the Vendure config contains the `LicenseGuardPlugin`.
     */
    licenseGuardConfigured: boolean;
    /**
     * @description
     * The capability keys that the license grants. Empty when License Guard is not configured.
     */
    grantedCapabilities: ReadonlySet<string>;
    /**
     * @description
     * `true` when the Dashboard must show no locked items: Platform promotion is turned off
     * in the build, or License Guard is configured but it did not report a granted set.
     */
    hideAll: boolean;
    /**
     * @description
     * Returns `true` when the Dashboard shows the locked item for the capability:
     * `hideAll` is `false` and the capability is not granted.
     */
    isLocked: (capability: string) => boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const capabilities = new Map<string, DashboardPromotionCapabilityV1>(
    dashboardPromotion.capabilities.map(c => [c.key, c]),
);
let cachedState: PlatformPromotionState | undefined;
let cachedReported: ReadonlySet<string> | undefined;

function createState(reported: ReadonlySet<string> | undefined): PlatformPromotionState {
    const hideAll = !platformPromotionEnabled || (licenseGuardConfigured && !reported);
    // Without License Guard nothing can grant a capability, so a reported set is not used.
    const grantedCapabilities = (licenseGuardConfigured && reported) || EMPTY_SET;
    return {
        promotion: dashboardPromotion,
        capabilities,
        licenseGuardConfigured,
        grantedCapabilities,
        hideAll,
        isLocked: capability => !hideAll && !grantedCapabilities.has(capability),
    };
}

/**
 * @description
 * Returns the current {@link PlatformPromotionState} outside of React.
 * Use {@link usePlatformPromotion} in components.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.9.0
 */
export function getPlatformPromotion(): PlatformPromotionState {
    const reported = getReportedPlatformGrantedCapabilities();
    if (!cachedState || reported !== cachedReported) {
        cachedState = createState(reported);
        cachedReported = reported;
    }
    return cachedState;
}

/**
 * @description
 * Returns the {@link PlatformPromotionState}. The component renders again when
 * {@link setPlatformGrantedCapabilities} reports a new granted set.
 *
 * @example
 * ```tsx
 * const { promotion, isLocked } = usePlatformPromotion();
 * const lockedNavItems = promotion.navItems.filter(item => item.promoted && isLocked(item.capability));
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.9.0
 */
export function usePlatformPromotion(): PlatformPromotionState {
    return useSyncExternalStore(
        subscribeToPlatformGrantedCapabilities,
        getPlatformPromotion,
        getPlatformPromotion,
    );
}
