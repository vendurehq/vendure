import { ID, RequestContext } from '@vendure/core';

// The ids of the channels the signed-in user is allowed to work in. Vendure records channel
// access on the session's user as one entry per channel, so an empty list means no channel
// access at all.
export function userChannelIds(ctx: RequestContext): ID[] {
    return ctx.session?.user?.channelPermissions.map(entry => entry.id) ?? [];
}
