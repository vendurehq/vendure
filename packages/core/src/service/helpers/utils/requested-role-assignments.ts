import { RoleAssignmentInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { UserInputError } from '../../../common/error/errors';

/**
 * Returns the grants a create input requests: its `roleAssignments`, or for the deprecated
 * `roleIds` input (since 4.0.0) each Role on the active Channel. Throws if both are given.
 * Remove the `roleIds` alternative in v5.0.0.
 */
export function getRequestedRoleAssignments(
    ctx: RequestContext,
    input: { roleIds?: ID[] | null; roleAssignments?: RoleAssignmentInput[] | null },
): RoleAssignmentInput[] {
    if (input.roleIds && input.roleAssignments) {
        throw new UserInputError('error.role-ids-and-role-assignments-are-mutually-exclusive');
    }
    return (
        input.roleAssignments ?? input.roleIds?.map(roleId => ({ roleId, channelId: ctx.channelId })) ?? []
    );
}
