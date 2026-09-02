import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
import { RoleChannelPair } from '../../service/services/role-assignment.service';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever {@link RoleAssignment} rows of a {@link User} change, i.e. when
 * a Role is granted to or revoked from the User on a specific Channel. The `assignments` property
 * contains only the `(roleId, channelId)` pairs which were added (`'assigned'`) or removed
 * (`'removed'`) by the write; unchanged pairs are not included. A write which changes nothing
 * emits no event.
 *
 * The event is keyed on the User rather than the Administrator, so it also covers API-key Users
 * and Administrators created via external authentication. It is emitted for grants made by an
 * actor or an authentication strategy (the `roleIds` / `roleAssignments` inputs of the
 * administrator and API-key mutations, `setRoleAssignmentsForUser`, SSO administrator creation).
 * System-mandated rows are not reported: the RoleEditor grant on Administrator creation, the
 * SuperAdmin rows materialized on Channel creation and the bootstrap SuperAdmin seed.
 *
 * This event replaces the `RoleChangeEvent` removed in v4.0.0, which was keyed on the
 * Administrator and could not express the Channel a Role was granted on.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export class RoleAssignmentEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public user: User,
        public assignments: RoleChannelPair[],
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
