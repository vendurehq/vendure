import { EntityNotFoundError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { SetActiveChannelTool } from './set-active-channel.tool';

const serializer = { channel: (channel: unknown) => channel } as any;

function ctxWithChannelAccess(channelId: number) {
    return { session: { user: { channelPermissions: [{ id: channelId }] } } } as any;
}

function build(affected: number | undefined) {
    const update = vi.fn().mockResolvedValue({ affected });
    const connection = { getRepository: () => ({ update }) } as any;
    const channelService = { getChannelFromToken: () => Promise.resolve({ id: 2, token: 'ch-2' }) } as any;
    const tool = new SetActiveChannelTool(channelService, connection, serializer);
    return { tool, update };
}

describe('SetActiveChannelTool', () => {
    it('updates only the channelId column', async () => {
        const { tool, update } = build(1);

        await tool.execute(ctxWithChannelAccess(2), { channelToken: 'ch-2' }, { grant: { id: 9 } } as any);

        expect(update).toHaveBeenCalledWith({ id: 9 }, { channelId: 2 });
    });

    it('throws when the grant row is gone', async () => {
        const { tool } = build(0);

        await expect(
            tool.execute(ctxWithChannelAccess(2), { channelToken: 'ch-2' }, { grant: { id: 9 } } as any),
        ).rejects.toThrowError(EntityNotFoundError);
    });
});
