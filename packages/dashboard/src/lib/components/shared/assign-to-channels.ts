export interface AssignToChannelsResult {
    succeeded: string[];
    failed: Array<{ channelId: string; reason: unknown }>;
}

/**
 * Sequentially assigns entities to multiple channels via the provided mutation function.
 *
 * Sequential execution is intentional: each mutation writes channel relations for the same
 * entity rows, so a parallel fan-out only buys lock contention and N overlapping reindex jobs.
 *
 * @param channelIds - Channel IDs to assign to
 * @param buildInput - Builds the mutation input for a given channel ID
 * @param mutationFn - The GraphQL mutation function to call per channel
 */
export async function assignToChannels(
    channelIds: string[],
    buildInput: (channelId: string) => Record<string, any>,
    mutationFn: (variables: any) => Promise<unknown>,
): Promise<AssignToChannelsResult> {
    const result: AssignToChannelsResult = { succeeded: [], failed: [] };
    for (const channelId of channelIds) {
        try {
            await mutationFn({ input: buildInput(channelId) });
            result.succeeded.push(channelId);
        } catch (reason) {
            result.failed.push({ channelId, reason });
        }
    }
    return result;
}
