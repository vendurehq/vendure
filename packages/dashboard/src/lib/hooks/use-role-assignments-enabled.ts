import { serverSupportsMutation } from '@/vdb/framework/document-introspection/get-document-structure.js';

/**
 * @description
 * Returns whether the server has the experimental `RoleAssignmentPlugin` registered,
 * detected from the presence of the `setRoleAssignmentsForUser` mutation in the admin
 * API schema. While the plugin is active, roles are granted per channel via the
 * `roleAssignments` inputs, and the legacy role-granting inputs (`roleIds`,
 * `channelIds` on Roles) are rejected by the server.
 *
 * @docsCategory hooks
 * @since 3.8.0
 */
export const useRoleAssignmentsEnabled = (): boolean =>
    serverSupportsMutation('setRoleAssignmentsForUser');
