import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { Channel, UserInputError } from '@vendure/core';

/**
 * Core reports some refusals, such as a zone that a channel still uses, as a `NOT_DELETED` result
 * rather than an error. A delete tool reports them as a failed call, so the caller cannot mistake
 * the result for a deletion, and the tool's transaction rolls back.
 *
 * When a database constraint stops the delete, core returns the database error's own text, which
 * says nothing useful to the caller and can expose table names. It is replaced with a plain message.
 */
export function deletionResult(response: DeletionResponse, target: string) {
    if (response.result !== DeletionResult.DELETED) {
        const message = response.message && !isRawError(response.message) ? response.message : undefined;
        throw new UserInputError(
            message ?? `${target} was not deleted. Other data, such as products or orders, may still use it.`,
        );
    }
    return { result: response.result, message: response.message || null };
}

function isRawError(message: string): boolean {
    return /^\w*Error\b/.test(message) || /constraint|SQLITE_|ER_ROW_IS_REFERENCED/i.test(message);
}

/** The channels an entity is removed from, by code, for a preview. */
export function channelList(channels: Channel[]): string {
    const codes = channels.map(channel => `"${channel.code}"`).sort((a, b) => a.localeCompare(b));
    return codes.length === 1
        ? `channel ${codes[0]}`
        : `every channel it is assigned to: ${codes.join(', ')}`;
}
