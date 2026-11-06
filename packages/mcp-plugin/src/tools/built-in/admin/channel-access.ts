import { ID, idsAreEqual, RequestContext } from '@vendure/core';

/**
 * Whether the active user may act on the given Channel. Global permissions (SuperAdmin) apply on
 * every Channel, so their holder is listed in `channelPermissions` only for the default Channel.
 */
export function userCanAccessChannel(ctx: RequestContext, channelId: ID): boolean {
    const user = ctx.session?.user;
    if (!user) {
        return false;
    }
    if (user.globalPermissions?.length) {
        return true;
    }
    return user.channelPermissions.some(entry => idsAreEqual(entry.id, channelId));
}
