import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import { isObject } from '@vendure/common/lib/shared-utils';

/**
 * The value which replaces redacted job data in Admin API responses.
 */
export const REDACTED_JOB_DATA_VALUE = '[redacted]';

/**
 * Keys whose values are redacted at any depth of job data, result and error. Matched exactly
 * and case-insensitively, so keys such as `tokenCount` or `channelToken` are not affected.
 */
const SENSITIVE_KEYS = new Set(
    [
        'passwordResetToken',
        'verificationToken',
        'identifierChangeToken',
        'passwordHash',
        'password',
        'newPassword',
        'currentPassword',
        'accessToken',
        'refreshToken',
        'apiKey',
        'secret',
        'clientSecret',
        'authorization',
        'cookie',
    ].map(key => key.toLowerCase()),
);

/**
 * Matches the depth limit which `Job` applies when it makes job data serializable.
 */
const MAX_DEPTH = 10;

/**
 * @description
 * Returns a JSON-compatible copy of a job's `data`, `result` or `error` for the Admin API
 * `Job` type. The input is never mutated.
 *
 * - The value of every sensitive key is replaced with `'[redacted]'`.
 * - An object with a `templateVars` object, as written by the EmailPlugin and by custom
 *   plugins which follow the same pattern, keeps the `templateVars` keys but every value is
 *   replaced, because the default email handlers put password reset, verification and
 *   identifier change tokens there. Each entry of its `attachments` array keeps only
 *   `filename` and `contentType`, because `content` holds the file body and `path` can be a
 *   presigned URL.
 * - Values with a `toJSON()` method (Date, Buffer, entities) are converted first, as
 *   `JSON.stringify` would do.
 * - Objects nested deeper than 10 levels, and circular references, are replaced as a whole.
 */
export function redactJobData(value: unknown): any {
    return redact(value, 0, new WeakSet());
}

function redact(input: unknown, depth: number, ancestors: WeakSet<object>): any {
    const value = withoutRequestCredentials(hasToJSON(input) ? input.toJSON() : input);
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (MAX_DEPTH < depth || ancestors.has(value)) {
        return REDACTED_JOB_DATA_VALUE;
    }
    // Only the objects on the current path are tracked, so a value referenced from two
    // places is still output twice, as JSON.stringify would.
    ancestors.add(value);
    let output: unknown;
    if (Array.isArray(value)) {
        output = value.map(item => redact(item, depth + 1, ancestors));
    } else {
        const isEmailData = isObject((value as Record<string, unknown>).templateVars);
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                result[key] = REDACTED_JOB_DATA_VALUE;
            } else if (isEmailData && key === 'templateVars') {
                result[key] = Object.fromEntries(
                    Object.keys(child as object).map(k => [k, REDACTED_JOB_DATA_VALUE]),
                );
            } else if (isEmailData && key === 'attachments' && Array.isArray(child)) {
                result[key] = child.map((attachment: Record<string, unknown>) =>
                    isObject(attachment)
                        ? redact(pick(attachment, ['filename', 'contentType']), depth + 2, ancestors)
                        : REDACTED_JOB_DATA_VALUE,
                );
            } else {
                result[key] = redact(child, depth + 1, ancestors);
            }
        }
        output = result;
    }
    ancestors.delete(value);
    return output;
}

function hasToJSON(value: unknown): value is { toJSON: () => unknown } {
    return value !== null && typeof value === 'object' && typeof (value as any).toJSON === 'function';
}

/**
 * A serialized RequestContext written by versions before the session token was excluded
 * from `serialize()` still holds the token and the raw request. The resolver prunes the
 * top-level `ctx`, and this covers a context stored under any other key.
 */
function withoutRequestCredentials(value: unknown): unknown {
    if (!isObject(value) || !('_apiType' in value) || !('_channel' in value) || !('_languageCode' in value)) {
        return value;
    }
    const { _req, ...rest } = value as Record<string, any>;
    const session = rest._session;
    return isObject(session)
        ? { ...rest, _session: omit(session as Record<string, unknown>, ['token']) }
        : rest;
}
