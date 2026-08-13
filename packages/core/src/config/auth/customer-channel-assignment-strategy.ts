import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';

/**
 * @description
 * Determines if an authenticated Customer should be automatically assigned to the current Channel.
 * Use this to keep customer bases strictly separated in multi-channel or B2B setups.
 *
 * NOTE: This controls channel membership, not API access. Returning `false`
 * won't block the request, it just stops the customer from bein assigned to this channel.
 * (This is skipped on the default channel and during registration/checkout).
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
     * Return `true` to assign the Customer to the current Channel,
     * or `false` to let them use it for this session without assigning.
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
