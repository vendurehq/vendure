/*
 * The `dashboardPromotion` data of the Vendure catalog (`GET https://api.vendure.io/v1/catalog`).
 * The Dashboard uses it to show locked Vendure Platform capabilities. The Core startup banner
 * uses it to list the Vendure Platform capabilities.
 */
/**
 * @description
 * A Vendure Platform plan tier. A capability's `tier` is the lowest tier that grants it.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.8.1
 */
export type PlatformTier = 'starter' | 'growth' | 'scale' | 'enterprise';

/**
 * @description
 * The commercial copy for one Platform capability, as served by the Vendure catalog.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.8.1
 */
export interface DashboardPromotionCapabilityV1 {
    /**
     * @description
     * The capability key, for example `org.accounts`.
     */
    key: string;
    tier: PlatformTier;
    title: string;
    summary: string;
    /**
     * @description
     * Exactly 3 lines.
     */
    benefits: [string, string, string];
    /**
     * @description
     * `trial` for Starter, Growth and Scale. `sales` for Enterprise.
     */
    cta: 'trial' | 'sales';
}

/**
 * @description
 * Version 1 of the `dashboardPromotion` field of `GET https://api.vendure.io/v1/catalog`.
 * It holds the Dashboard placements of the Vendure Platform plugins, and the commercial
 * copy for each capability.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.8.1
 */
export interface DashboardPromotionV1 {
    version: 1;
    navSections: Array<{
        id: string;
        label: string;
        /**
         * @description
         * The PascalCase name of a lucide-react icon, without the `Icon` suffix, for example `ShieldCheck`.
         */
        icon: string;
        placement: 'top' | 'bottom';
        order: number;
    }>;
    navItems: Array<{
        capability: string;
        sectionId: string;
        id: string;
        label: string;
        url: string;
        /**
         * @description
         * Items with no `order` sort after the ordered items, by title.
         */
        order?: number;
        page: { kind: 'list' | 'detail'; title: string; columns?: string[]; fields?: string[] };
        /**
         * @description
         * `true` on one navigation item per promoted capability. Only these
         * show in the Dashboard navigation as locked items.
         */
        promoted: boolean;
    }>;
    pageBlocks: Array<{
        capability: string;
        pageId: string;
        blockId: string;
        column: 'main' | 'side';
        position?: { blockId: string; order: 'before' | 'after' | 'replace' };
        title: string;
    }>;
    actions: Array<{ capability: string; pageId: string; label: string }>;
    /**
     * @description
     * The copy for each capability that a nav item, page block or action names.
     */
    capabilities: DashboardPromotionCapabilityV1[];
}

const TIERS: readonly unknown[] = ['starter', 'growth', 'scale', 'enterprise'];
const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalStringArray = (value: unknown) =>
    value === undefined || (Array.isArray(value) && value.every(isString));
const isArrayOf = (value: unknown, check: (item: any) => boolean): value is unknown[] =>
    Array.isArray(value) && value.every(item => item != null && typeof item === 'object' && check(item));

/**
 * @description
 * Returns `true` when `value` has all required fields of {@link DashboardPromotionV1}.
 * The Dashboard build and the snapshot generator do not use a payload that fails this check.
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.8.1
 */
export function isDashboardPromotionV1(value: unknown): value is DashboardPromotionV1 {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = value as any;
    return (
        v?.version === 1 &&
        isArrayOf(
            v.navSections,
            s =>
                isString(s.id) &&
                isString(s.label) &&
                isString(s.icon) &&
                (s.placement === 'top' || s.placement === 'bottom') &&
                typeof s.order === 'number',
        ) &&
        isArrayOf(
            v.navItems,
            i =>
                isString(i.capability) &&
                isString(i.sectionId) &&
                isString(i.id) &&
                isString(i.label) &&
                isString(i.url) &&
                (i.order === undefined || typeof i.order === 'number') &&
                typeof i.promoted === 'boolean' &&
                (i.page?.kind === 'list' || i.page?.kind === 'detail') &&
                isString(i.page.title) &&
                isOptionalStringArray(i.page.columns) &&
                isOptionalStringArray(i.page.fields),
        ) &&
        isArrayOf(
            v.pageBlocks,
            b =>
                isString(b.capability) &&
                isString(b.pageId) &&
                isString(b.blockId) &&
                (b.column === 'main' || b.column === 'side') &&
                (b.position === undefined ||
                    (isString(b.position?.blockId) &&
                        ['before', 'after', 'replace'].includes(b.position.order))) &&
                isString(b.title),
        ) &&
        isArrayOf(v.actions, a => isString(a.capability) && isString(a.pageId) && isString(a.label)) &&
        isArrayOf(
            v.capabilities,
            c =>
                isString(c.key) &&
                TIERS.includes(c.tier) &&
                isString(c.title) &&
                isString(c.summary) &&
                Array.isArray(c.benefits) &&
                c.benefits.length === 3 &&
                c.benefits.every(isString) &&
                (c.cta === 'trial' || c.cta === 'sales'),
        )
    );
}
