/**
 * @description
 * The namespace of the codes for errors defined by Vendure core.
 *
 * @docsCategory errors
 * @docsPage Vendure codes
 * @since 4.0.0
 */
export const CORE_CODE_NAMESPACE = 'core';

/**
 * @description
 * The code for an error which has no code of its own: any error which is not an {@link I18nError}, or an
 * `I18nError` whose message is plain text rather than an `error.*` i18n key.
 *
 * @docsCategory errors
 * @docsPage Vendure codes
 * @since 4.0.0
 */
export const UNEXPECTED_VENDURE_CODE = `${CORE_CODE_NAMESPACE}.unexpected`;

const ERROR_KEY_PATTERN = /^error\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const ERROR_RESULT_KEY_PATTERN = /^errorResult\.([A-Z0-9]+(?:_[A-Z0-9]+)*)$/;

/**
 * @description
 * Returns the namespaced code for an i18n error key. A code has the form `<namespace>.<kebab-name>`,
 * and is stable across releases, so a client or an agent can act on it.
 *
 * * An `error.*` key gives `<namespace>.<name>`, for example `error.entity-with-id-not-found` gives
 *   `core.entity-with-id-not-found`.
 * * An `errorResult.*` key gives `<namespace>.` plus the kebab-cased ErrorResult `errorCode`, for example
 *   `errorResult.COUPON_CODE_EXPIRED_ERROR` gives `core.coupon-code-expired-error`.
 * * Anything else, such as a plain-text message, gives {@link UNEXPECTED_VENDURE_CODE}.
 *
 * The namespace defaults to `core`. A plugin passes its own namespace so that its codes cannot clash
 * with the core codes.
 *
 * @example
 * ```ts
 * toVendureCode('error.entity-with-id-not-found'); // 'core.entity-with-id-not-found'
 * toVendureCode('error.review-not-found', 'reviews'); // 'reviews.review-not-found'
 * ```
 *
 * @docsCategory errors
 * @docsPage Vendure codes
 * @since 4.0.0
 */
export function toVendureCode(key: string, namespace: string = CORE_CODE_NAMESPACE): string {
    const errorKeyMatch = ERROR_KEY_PATTERN.exec(key);
    if (errorKeyMatch) {
        return `${namespace}.${errorKeyMatch[1]}`;
    }
    const errorResultKeyMatch = ERROR_RESULT_KEY_PATTERN.exec(key);
    if (errorResultKeyMatch) {
        return `${namespace}.${errorResultKeyMatch[1].toLowerCase().replace(/_/g, '-')}`;
    }
    return UNEXPECTED_VENDURE_CODE;
}

/**
 * @description
 * Returns the namespaced code for an ErrorResult, derived from its `errorCode`. For example an ErrorResult
 * with the `errorCode` `COUPON_CODE_EXPIRED_ERROR` has the code `core.coupon-code-expired-error`.
 *
 * The code is not part of the GraphQL schema. It is used in logs and tooling only.
 *
 * @docsCategory errors
 * @docsPage Vendure codes
 * @since 4.0.0
 */
export function getErrorResultVendureCode(
    errorResult: { errorCode: string },
    namespace: string = CORE_CODE_NAMESPACE,
): string {
    return toVendureCode(`errorResult.${errorResult.errorCode}`, namespace);
}
