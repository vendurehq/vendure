import { RoleAssignmentInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
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
 * actor or an authentication strategy (`assignRolesToUser` / `removeRolesFromUser`, the
 * `roleAssignments` and deprecated `roleIds` inputs of the administrator and API-key mutations,
 * SSO administrator creation, the bootstrap SuperAdmin seed). Deleting an Administrator, an API
 * key or a Channel emits `'removed'` for the rows it removes. Rows written by
 * {@link migrateRoleAssignmentData} are not reported.
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
        public assignments: RoleAssignmentInput[],
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
