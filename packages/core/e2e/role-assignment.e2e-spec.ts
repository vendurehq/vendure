import { describe, it } from 'vitest';

/**
 * Coverage for the RoleAssignment (user, role, channel) permission model. The suite is
 * built out in a dedicated stage; see the OSS-300 stage docs for the full recorded scope
 * (resolution semantics, fail-closed guards, the roleAssignments admin API surface).
 */
describe('RoleAssignment', () => {
    // The channel-isolation property at the heart of the model: an assignment grants a
    // Role's permissions on its Channel and nothing else. Probe with any admin mutation
    // (e.g. createRole): denied while active on a channel where the user holds no
    // assignment, allowed while active on the channel of the assignment.
    it.todo('role assignment grants permissions only on its channel');
    it.todo('admin can act on the channel of their assignment');
});
