import { isErrorResult, isFailedResult, isIncompleteResult } from '@vendure/common/lib/command';

// Changes the command's input before it runs, and adds a field to its output.
export async function run(input, _ctx, next) {
    const result = await next({
        requestId: input.shout ? input.requestId.toUpperCase() : input.requestId,
    });
    if (isIncompleteResult(result) || isFailedResult(result) || isErrorResult(result)) {
        return result;
    }
    return { ...result, extendedBy: '@vendure-e2e/extension-cli-plugin' };
}
