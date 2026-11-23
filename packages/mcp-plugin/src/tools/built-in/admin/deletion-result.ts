import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { Logger, UserInputError } from '@vendure/core';

import { loggerCtx } from '../../../constants';

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
        const raw = response.message && isRawError(response.message);
        if (raw) {
            // Kept for the operator, since the caller only gets the plain message.
            Logger.warn(`${target} was not deleted: ${response.message}`, loggerCtx);
        }
        const message = response.message && !raw ? response.message : undefined;
        throw new UserInputError(
            message ?? `${target} was not deleted. Other data, such as products or orders, may still use it.`,
        );
    }
    return { result: response.result, message: response.message || null };
}

function isRawError(message: string): boolean {
    return /^\w*Error\b/.test(message) || /constraint|SQLITE_|ER_ROW_IS_REFERENCED/i.test(message);
}
