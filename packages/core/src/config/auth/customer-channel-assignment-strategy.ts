import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';

/**
 * @description
 * Determines if an authenticated Customer should be automatically assigned to the current Channel.
 * Use this to keep customer bases strictly separated in multi-channel or B2B setups.
 *
 * A Customer's permissions are derived from Channel membership, so declining the assignment
 * means the Customer holds no `Authenticated` permission on that Channel and no membership is
 * recorded. On that Channel:
 *
 * - Operations gated on `Permission.Authenticated` (the `me` query and any custom operation
 *   using that permission) fail with a `ForbiddenError`.
 * - Operations gated on `Permission.Owner`, which include `activeCustomer`, `activeOrder`,
 *   `addItemToOrder` and the checkout mutations, need only a session and still run. The
 *   Customer record is resolved per Channel, so `activeCustomer` returns `null` and an Order
 *   started there has no Customer.
 * - The session is still signed in, so it is not a guest session. `setCustomerForOrder` returns
 *   an `AlreadyLoggedInError`, so the Customer cannot check out there. Operations which act on
 *   the session's User, such as `updateCustomerPassword`, still work. Handle a declined Channel
 *   in the storefront, or with a custom {@link GuestCheckoutStrategy}.
 * - Public operations are unaffected.
 *
 * The strategy is never consulted on the default Channel, under `disableAuth`, or during
 * registration, checkout account creation, email verification, or when an administrator creates
 * a Customer with an email address that already exists (which is how an administrator adds an
 * existing Customer to a Channel).
 *
 * The strategy only decides membership within the Customer's identity scope (see
 * {@link IdentityScopeStrategy}). It is never consulted for a Channel outside that scope: the
 * Customer never joins such a Channel, and the session is treated as anonymous there, because
 * the same email address may belong to a different Customer. With the
 * {@link ChannelIdentityScopeStrategy}, every scope is a single Channel which the Customer joined
 * when they were created, so this strategy is in effect never consulted. Use an identity scope to
 * give Channels separate customer bases, and this strategy to limit which Channels of one
 * customer base a Customer may use.
 *
 * @example
 * ```ts
 * // Membership is granted by an admin, never auto-assigned.
 * class InviteOnlyChannelStrategy implements CustomerChannelAssignmentStrategy {
 *     canAssignCustomerToChannel() {
 *         return false;
 *     }
 * }
 * ```
 *
 * :::info
 *
 * This is configured via the `authOptions.customerChannelAssignmentStrategy` property of your
 * VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 * @docsPage CustomerChannelAssignmentStrategy
 * @docsWeight 0
 * @since 3.7.0
 */
export interface CustomerChannelAssignmentStrategy extends InjectableStrategy {
    /**
     * @description
     * Return `true` to assign the Customer to the current Channel, or `false` to leave the
     * Customer without membership and without `Authenticated` on it (see the interface
     * description).
     *
     * Triggered when an authenticated Customer's request targets a different
     * Channel than the one currently active on their session. This doesn't run on the default Channel,
     * if the Customer is already a member of the Channel, or if the Channel is outside the
     * Customer's identity scope.
     */
    canAssignCustomerToChannel(
        ctx: RequestContext,
        customer: Customer,
        channelId: ID,
    ): boolean | Promise<boolean>;
}
