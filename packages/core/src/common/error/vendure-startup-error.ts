/**
 * @description
 * One way to fix a {@link VendureStartupError}. `description` says what to change. `path` and `input`
 * name a `vendure` CLI command and its input, when running a command is the fix.
 *
 * @docsCategory errors
 * @docsPage VendureStartupError
 * @since 4.0.0
 */
export interface VendureErrorFix {
    description: string;
    path?: string[];
    input?: Record<string, unknown>;
}

/**
 * @description
 * An error which stops the Vendure server or worker from starting, such as an invalid config. It carries
 * a namespaced code, for example `core.config.invalid-custom-fields`, and a list of fixes.
 *
 * When {@link bootstrap} or {@link bootstrapWorker} fails, Vendure writes one line of JSON to stderr
 * before rethrowing the error, so that a supervising process such as the `vendure` CLI can read the
 * code and the fixes:
 *
 * ```json
 * {"vendure":"event","event":"startup-error","code":"core.config.invalid-custom-fields","message":"...","fix":[...]}
 * ```
 *
 * A plugin can throw its own startup errors with a code in its own namespace:
 *
 * @example
 * ```ts
 * throw new VendureStartupError({
 *     code: 'reviews.config.missing-api-key',
 *     message: 'The ReviewsPlugin needs an apiKey',
 *     fix: [{ description: 'Pass the apiKey option to ReviewsPlugin.init()' }],
 * });
 * ```
 *
 * @docsCategory errors
 * @docsPage VendureStartupError
 * @docsWeight 0
 * @since 4.0.0
 */
export class VendureStartupError extends Error {
    readonly vendureCode: string;
    readonly fix: VendureErrorFix[];

    constructor(options: { code: string; message: string; fix?: VendureErrorFix[] }) {
        super(options.message);
        this.name = 'VendureStartupError';
        this.vendureCode = options.code;
        this.fix = options.fix ?? [];
    }
}
