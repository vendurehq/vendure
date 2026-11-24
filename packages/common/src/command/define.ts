import type {
    CommandDefinition,
    CommandErrorDefinition,
    CommandNeed,
    ErrorResult,
    FailedResult,
    IncompleteResult,
} from './types';

/**
 * @description
 * The shape of an error code: a lower-case namespace, then one or more dot-separated parts of
 * lower-case letters, digits and hyphens, for example `devserver.not-running` or
 * `core.config.invalid-custom-fields`.
 */
export const ERROR_CODE_PATTERN = /^[a-z]+(\.[a-z0-9-]+)+$/;

/**
 * @description
 * Whether a code has the shape of {@link ERROR_CODE_PATTERN}.
 */
export function isValidErrorCode(code: string): boolean {
    return ERROR_CODE_PATTERN.test(code);
}

/**
 * @description
 * Declares a command. It returns its argument, so a command is plain data that does not depend on
 * which copy of this package is loaded.
 */
export function defineCommand<T extends CommandDefinition>(definition: T): T {
    return definition;
}

/**
 * @description
 * Declares a coded error. It returns its argument.
 */
export function defineError<Details = any>(
    error: CommandErrorDefinition<Details>,
): CommandErrorDefinition<Details> {
    return error;
}

/**
 * @description
 * Returned from `run` when the caller must supply something, such as a consent for a risk that
 * `run` found. The caller does what the
 * needs say, then runs the same command again. Running again must be safe, so a command that
 * changed something before it stopped reports that in `output`.
 */
export function incomplete(needs: CommandNeed[], output?: unknown): IncompleteResult {
    return output === undefined
        ? { vendureResult: 'incomplete', needs }
        : { vendureResult: 'incomplete', needs, output };
}

/**
 * @description
 * Returned from `run` when the command ran and its own checks did not pass, for example a
 * diagnostic that found a problem. The output is still reported, and the exit code is not zero.
 */
export function failed<Output>(output: Output): FailedResult<Output> {
    return { vendureResult: 'failed', output };
}

/**
 * @description
 * Returned from `run` for a coded error that was declared with `defineError`.
 */
export function fail<Details>(error: CommandErrorDefinition<Details>, details: Details): ErrorResult {
    return { vendureResult: 'error', code: error.code, details };
}

/** Whether `run` returned {@link incomplete}. */
export function isIncompleteResult(value: unknown): value is IncompleteResult {
    return isMarked(value, 'incomplete');
}

/** Whether `run` returned {@link failed}. */
export function isFailedResult(value: unknown): value is FailedResult {
    return isMarked(value, 'failed');
}

/** Whether `run` returned {@link fail}. */
export function isErrorResult(value: unknown): value is ErrorResult {
    return isMarked(value, 'error');
}

function isMarked(value: unknown, kind: string): boolean {
    return typeof value === 'object' && value !== null && (value as any).vendureResult === kind;
}
