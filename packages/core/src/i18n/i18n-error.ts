import { GraphQLError } from 'graphql';

import { LogLevel } from '../config/logger/vendure-logger';

import { CORE_CODE_NAMESPACE, toVendureCode } from './vendure-code';

/**
 * @description
 * All errors thrown in the Vendure server must use or extend this error class. This allows the
 * error message to be translated before being served to the client.
 *
 * The error messages should be provided in the form of a string key which corresponds to
 * a key defined in the `i18n/messages/<languageCode>.json` files.
 *
 * Note that this class should not be directly used in code, but should be extended by
 * a more specific Error class.
 *
 * Each error has a {@link toVendureCode namespaced code}, `vendureCode`, built from its message key,
 * for example `core.entity-with-id-not-found`. The GraphQL APIs return it as `extensions.vendureCode`.
 * A plugin which defines its own error keys sets the static `namespace` on its error class, so
 * that its codes cannot clash with the core codes:
 *
 * @example
 * ```ts
 * class ReviewNotFoundError extends I18nError {
 *     static namespace = 'reviews';
 *
 *     constructor(id: ID) {
 *         // vendureCode is 'reviews.review-not-found'
 *         super('error.review-not-found', { id }, 'ENTITY_NOT_FOUND');
 *     }
 * }
 * ```
 *
 * @docsCategory errors
 */
export abstract class I18nError extends GraphQLError {
    /**
     * @description
     * The namespace of the `vendureCode` of this error class. Defaults to `core`.
     *
     * @since 4.0.0
     */
    static namespace?: string;

    /**
     * @description
     * The namespaced code of this error, for example `core.entity-with-id-not-found`. It is built from
     * the message key, and is `core.unexpected` when the message is not an `error.*` key.
     *
     * @since 4.0.0
     */
    readonly vendureCode: string;

    protected constructor(
        public message: string,
        public variables: { [key: string]: string | number } = {},
        public code?: string,
        public logLevel: LogLevel = LogLevel.Warn,
    ) {
        super(message, {
            extensions: { code },
        });
        this.vendureCode = toVendureCode(message, new.target.namespace ?? CORE_CODE_NAMESPACE);
    }
}
