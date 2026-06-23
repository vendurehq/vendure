import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';

/**
 * @description
 * Controls whether the AuthGuard silently makes an authenticated {@link Customer} a member of the
 * Channel their request is pointed at.
 *
 * Vendure adds any authenticated Customer to whatever Channel they land on. That is
 * fine for a single storefront, but not for multi-channel setups where membership should stay
 * deliberate: a B2B Channel you only join by invitation, or storefronts that must not share
 * customers. Implement this strategy to decide, per request, whether that auto-join happens.
 *
 * It is consulted only by the AuthGuard, and only for a non-member on a non-default Channel. It
 * never runs for the default Channel, under `disableAuth`, or during account creation (registration,
 * verification, external auth, guest checkout), which always join the Channel they run on.
 *
 * Note this governs *membership*, not access: returning `false` does not reject the request. The
 * Customer can still use the Channel for the current session; they simply aren't recorded as a
 * member.
 *
 * The {@link DefaultCustomerChannelAssignmentStrategy} always returns `true`.
 *
 * @example
 * ```ts
 * // Membership is granted by an admin, never auto-joined.
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
     * Return `true` to make the Customer a member of the active Channel, or `false` to let them use
     * it for this session without persisting membership.
     *
     * Called by the AuthGuard when a non-member's request activates a non-default Channel that isn't
     * already the session's active channel: on login, or whenever the active channel changes.
     */
    canAssignCustomerToChannel(
        ctx: RequestContext,
        customer: Customer,
        channelId: ID,
    ): boolean | Promise<boolean>;
}
