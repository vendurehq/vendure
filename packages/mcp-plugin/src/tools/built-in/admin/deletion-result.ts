import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { UserInputError } from '@vendure/core';

/**
 * Core reports some refusals, such as a zone that a channel still uses, as a `NOT_DELETED` result
 * rather than an error. A delete tool reports them as a failed call, so the caller cannot mistake
 * the result for a deletion, and the tool's transaction rolls back.
 */
export function deletionResult(response: DeletionResponse, target: string) {
    if (response.result !== DeletionResult.DELETED) {
        throw new UserInputError(response.message || `${target} was not deleted.`);
    }
    return { result: response.result, message: response.message || null };
}
