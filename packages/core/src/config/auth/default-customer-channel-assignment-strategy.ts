import { CustomerChannelAssignmentStrategy } from './customer-channel-assignment-strategy';

/**
 * @description
 * The default {@link CustomerChannelAssignmentStrategy}: a Customer is auto-assigned to whichever
 * Channel they authenticate against.
 *
 * @docsCategory auth
 * @docsPage CustomerChannelAssignmentStrategy
 * @since 3.7.0
 */
export class DefaultCustomerChannelAssignmentStrategy implements CustomerChannelAssignmentStrategy {
    canAssignCustomerToChannel(): boolean {
        return true;
    }
}
