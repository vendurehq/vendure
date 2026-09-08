import { ID, RequestContext } from '@vendure/core';

// An empty list means the user has no channel access at all, not that we couldn't tell.
export function userChannelIds(ctx: RequestContext): ID[] {
    return ctx.session?.user?.channelPermissions.map(entry => entry.id) ?? [];
}
