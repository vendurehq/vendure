import { Channel } from '@vendure/core';

/** Channel codes for a preview or a refusal, quoted and sorted. */
export function quotedCodes(channels: Array<Pick<Channel, 'code'>>): string {
    return channels
        .map(channel => `"${channel.code}"`)
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
}

/** The channels an entity is removed from, for a preview. */
export function channelList(channels: Array<Pick<Channel, 'code'>>): string {
    return channels.length === 1
        ? `channel ${quotedCodes(channels)}`
        : `every channel it is assigned to: ${quotedCodes(channels)}`;
}
