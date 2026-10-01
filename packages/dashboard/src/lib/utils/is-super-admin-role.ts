/**
 * Whether a Role carries the `SuperAdmin` permission. Only the system SuperAdmin role can.
 * The Role has no channel scope: it is held on every Channel or not at all, and the server
 * stores it as a single assignment on the default Channel, so the dashboard shows it as
 * "All channels" instead of a Channel.
 */
export function isSuperAdminRole(role: { permissions: readonly string[] } | undefined): boolean {
    return role?.permissions.includes('SuperAdmin') ?? false;
}
