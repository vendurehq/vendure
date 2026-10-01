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
 * recorded. Operations gated on `Permission.Authenticated` (the `me` query and any custom
 * operation using that permission) fail with a `ForbiddenError`. Operations gated on
 * `Permission.Owner`, which includes `activeCustomer`, `activeOrder`, `addItemToOrder` and the
 * checkout mutations, need only a session and still run, but they treat the session as a guest
 * on that Channel: the Customer record is resolved per Channel, so `activeCustomer` returns
 * `null` and an Order started there has no Customer until one is set at checkout. Public
 * operations are unaffected. The strategy is never consulted on the default Channel, under
 * `disableAuth`, or during registration and checkout account creation.
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
     * Channel than the one currently active on their session. This doesn't run on the default Channel
     * or if the Customer is already a member of the Channel.
     */
    canAssignCustomerToChannel(
        ctx: RequestContext,
        customer: Customer,
        channelId: ID,
    ): boolean | Promise<boolean>;
}
