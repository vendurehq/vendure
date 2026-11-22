import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';

/** Whether the registered operation with this code declares a `secret` arg of this name. */
export type IsSecretConfigArg = (code: string, argName: string) => boolean;

/** Reads which config args are secret from core's registry of configurable operations. */
export function secretConfigArgsOf(configArgService: {
    hasSecretArg(code: string, argName: string): boolean;
}): IsSecretConfigArg {
    return (code, argName) => configArgService.hasSecretArg(code, argName);
}

/** A stored or entered secret is redacted. An empty one is left as is, so an unset secret shows as unset. */
function hasValue(value: unknown): boolean {
    return value != null && value !== '';
}

/**
 * The value to show for one config arg: the redaction placeholder for a set secret arg, and the value
 * itself otherwise. Tool results and log rows both use it, so they agree on which secrets are hidden.
 */
export function redactArgValue<T>(
    code: string,
    argName: string,
    value: T,
    isSecret: IsSecretConfigArg,
): T | typeof REDACTED_SECRET_PLACEHOLDER {
    return hasValue(value) && isSecret(code, argName) ? REDACTED_SECRET_PLACEHOLDER : value;
}

/**
 * Only plain objects are walked. Anything else, such as a `Date`, is kept as it is, so the log column
 * still serializes it the way it did.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Returns a copy of a tool call body with the value of every secret config arg replaced by the
 * redaction placeholder. It finds config operations in both shapes a tool may use: `{ code, args }`
 * with the args by name, as the built-in tools take them, and the Admin API's
 * `{ code, arguments: [{ name, value }] }`.
 */
export function redactSecretConfigArgs(value: unknown, isSecret: IsSecretConfigArg): unknown {
    if (Array.isArray(value)) {
        return value.map(item => redactSecretConfigArgs(item, isSecret));
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        copy[key] = redactSecretConfigArgs(child, isSecret);
    }
    const code = value.code;
    if (typeof code !== 'string') {
        return copy;
    }
    if (isPlainObject(copy.args)) {
        copy.args = Object.fromEntries(
            Object.entries(copy.args).map(([name, argValue]) => [
                name,
                redactArgValue(code, name, argValue, isSecret),
            ]),
        );
    }
    if (Array.isArray(copy.arguments)) {
        copy.arguments = copy.arguments.map(arg =>
            isPlainObject(arg) && typeof arg.name === 'string'
                ? { ...arg, value: redactArgValue(code, arg.name, arg.value, isSecret) }
                : arg,
        );
    }
    return copy;
}

/**
 * Core replaces all of an operation's args on update, so a secret arg the caller left out would be
 * cleared. When the operation's code is unchanged, each stored secret arg the caller left out is sent
 * as the redaction placeholder, which tells core to keep the stored value.
 */
export function keepOmittedSecretArgs<T extends { code: string; args?: Record<string, unknown> }>(
    operation: T,
    stored: ConfigurableOperation | null | undefined,
    isSecret: IsSecretConfigArg,
): T {
    if (!stored || stored.code !== operation.code) {
        return operation;
    }
    const args = { ...(operation.args ?? {}) };
    for (const arg of stored.args) {
        if (!(arg.name in args) && isSecret(stored.code, arg.name) && hasValue(arg.value)) {
            args[arg.name] = REDACTED_SECRET_PLACEHOLDER;
        }
    }
    return { ...operation, args };
}
