import { describe, expect, it, vi } from 'vitest';

import { assignToChannels } from './assign-to-channels.js';

const buildInput = (channelId: string) => ({ channelId });

describe('assignToChannels', () => {
    it('reports all successes', async () => {
        const result = await assignToChannels(['a', 'b'], buildInput, vi.fn().mockResolvedValue({}));
        expect(result).toEqual({ succeeded: ['a', 'b'], failed: [] });
    });

    it('reports all failures with their reasons', async () => {
        const error = new Error('nope');
        const result = await assignToChannels(['a'], buildInput, vi.fn().mockRejectedValue(error));
        expect(result.succeeded).toEqual([]);
        expect(result.failed).toEqual([{ channelId: 'a', reason: error }]);
    });

    it('records which channels failed on partial failure', async () => {
        const mutationFn = vi.fn(({ input }) =>
            input.channelId === 'b' ? Promise.reject(new Error('boom')) : Promise.resolve({}),
        );
        const result = await assignToChannels(['a', 'b', 'c'], buildInput, mutationFn);
        expect(result.succeeded).toEqual(['a', 'c']);
        expect(result.failed.map(f => f.channelId)).toEqual(['b']);
    });

    it('continues with remaining channels after a failure', async () => {
        const mutationFn = vi.fn().mockRejectedValue(new Error('x'));
        await assignToChannels(['a', 'b', 'c'], buildInput, mutationFn);
        expect(mutationFn).toHaveBeenCalledTimes(3);
    });

    it('captures synchronous buildInput errors as failures', async () => {
        const throwing = () => {
            throw new Error('bad input');
        };
        const result = await assignToChannels(['a'], throwing, vi.fn());
        expect(result.succeeded).toEqual([]);
        expect(result.failed.length).toBe(1);
        expect(result.failed[0].channelId).toBe('a');
        expect(result.failed[0].reason).toBeInstanceOf(Error);
    });
});
