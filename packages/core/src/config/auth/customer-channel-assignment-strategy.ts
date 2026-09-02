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
 * denies customer-scoped operations on that Channel: the request fails with a `ForbiddenError`
 * and no membership is recorded. Public operations (e.g. browsing products) are unaffected.
 * The strategy is never consulted on the default Channel, under `disableAuth`, or during
 * registration and checkout account creation.
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
     * Return `true` to assign the Customer to the current Channel, or `false` to deny the
     * Customer access to it (see the interface description).
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
