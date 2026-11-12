import type { InjectableStrategy } from '../../common/types/injectable-strategy';
import type { Channel } from '../../entity/channel/channel.entity';

/**
 * @description
 * The identity scope that every Customer belongs to when the {@link GlobalIdentityScopeStrategy}
 * is used, which is the default. Existing installs migrate every Customer to this scope.
 *
 * @since 4.0.0
 */
export const GLOBAL_IDENTITY_SCOPE = 'global';

/**
 * @description
 * Decides which customer identity scope a Channel belongs to.
 *
 * An identity scope is the set of Channels that share one customer base. Within a scope, an
 * email address identifies at most one Customer (and at most one customer User). Two Channels in
 * different scopes have independent customers: the same email address can register, log in,
 * check out as a guest and reset a password on each one without touching the other.
 *
 * The scope is stored on each {@link Customer} when it is created (`Customer.identityScope`).
 * Every lookup by email address, login, password reset and channel assignment is then limited
 * to the scope of the active Channel. A Customer can only become a member of Channels in its own
 * scope, so a session issued on one scope never holds `Authenticated` on another.
 *
 * Administrators are not scoped. An Administrator's User is found by email address across the
 * whole instance, as before.
 *
 * The returned key is persisted, so it must be stable for a given Channel. Use a Channel's `id`
 * rather than its `code`, which can be renamed. Changing the strategy on an install that already
 * has customers needs a data migration (see the v4 migration guide).
 *
 * @example
 * ```ts
 * // Brands share a customer base across their regional channels.
 * class BrandIdentityScopeStrategy implements IdentityScopeStrategy {
 *     getIdentityScope(channel: Channel) {
 *         return `brand:${(channel.customFields as any).brand ?? 'default'}`;
 *     }
 * }
 * ```
 *
 * :::info
 *
 * This is configured via the `authOptions.identityScopeStrategy` property of your
 * VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 * @docsPage IdentityScopeStrategy
 * @since 4.0.0
 */
export interface IdentityScopeStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns the identity scope key of the given Channel. Channels returning the same key share
     * one customer base. Must be stable and at most 255 characters.
     */
    getIdentityScope(channel: Channel): string | Promise<string>;
}

/**
 * @description
 * The default {@link IdentityScopeStrategy}. Every Channel is in one global scope, so an email
 * address identifies one Customer across the whole instance. This is the behaviour of Vendure
 * v3 and earlier.
 *
 * @docsCategory auth
 * @docsPage IdentityScopeStrategy
 * @since 4.0.0
 */
export class GlobalIdentityScopeStrategy implements IdentityScopeStrategy {
    getIdentityScope(): string {
        return GLOBAL_IDENTITY_SCOPE;
    }
}

/**
 * @description
 * An {@link IdentityScopeStrategy} that gives every Channel its own customer base. The same
 * email address is a different Customer on each Channel.
 *
 * The default Channel is a scope of its own too. Customers created on other Channels are still
 * joined to the default Channel so that it can list every Customer in the Admin API, but that
 * membership grants them nothing in the Shop API.
 *
 * @docsCategory auth
 * @docsPage IdentityScopeStrategy
 * @since 4.0.0
 */
export class ChannelIdentityScopeStrategy implements IdentityScopeStrategy {
    getIdentityScope(channel: Channel): string {
        return `channel:${channel.id}`;
    }
}
