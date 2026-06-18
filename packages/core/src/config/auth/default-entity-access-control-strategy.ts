import { Permission } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';

import { EntityAccessControlStrategy } from './entity-access-control-strategy';

/**
 * @description
 * The default EntityAccessControlStrategy which implements the standard
 * Vendure permission evaluation logic. It checks the `@Allow()` decorator
 * permissions against the current user's channel permissions.
 *
 * Custom strategies should extend this class and override `canAccess()`
 * to customize gate-level permissions, implement `prepareAccessControl()`
 * for async pre-loading, and/or implement `applyAccessControl()`
 * to add row-level filtering.
 *
 * @example
 * ```ts
 * class MyStrategy extends DefaultEntityAccessControlStrategy {
 *     async canAccess(ctx: RequestContext, permissions: Permission[]) {
 *         // Custom gate-level logic, falling back to default
 *         return super.canAccess(ctx, permissions);
 *     }
 *
 *     async prepareAccessControl(ctx: RequestContext) {
 *         // Pre-load data for row-level filtering
 *     }
 *
 *     applyAccessControl(qb, entityType, ctx) {
 *         // Row-level filtering
 *     }
 * }
 * ```
 *
 * @docsCategory auth
 * @docsPage EntityAccessControlStrategy
 * @since 3.6.0
 * @experimental
 */
export class DefaultEntityAccessControlStrategy implements EntityAccessControlStrategy {
    /**
     * @description
     * Implements the standard Vendure permission evaluation:
     * - No permissions required (`@Allow()` not set) → allow
     * - `Permission.Public` → allow
     * - Otherwise, check `ctx.userHasPermissions()` or `ctx.authorizedAsOwnerOnly`
     */
    async canAccess(ctx: RequestContext, permissions: Permission[]): Promise<boolean> {
        if (permissions.length === 0) {
            return true;
        }
        if (permissions.includes(Permission.Public)) {
            return true;
        }
        return ctx.userHasPermissions(permissions) || ctx.authorizedAsOwnerOnly;
    }

    // No prepareAccessControl — no pre-loading needed
    // No applyAccessControl — no row-level filtering, no Proxy overhead
}
