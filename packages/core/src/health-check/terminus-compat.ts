/**
 * Minimal local replacements for the symbols previously imported from
 * `@nestjs/terminus`. The health check feature these support is deprecated and
 * will be removed in v4.0.0; until then these types preserve the public API
 * surface of {@link HealthCheckStrategy} and {@link HealthCheckRegistryService}
 * without forcing a transitive dependency on `@nestjs/terminus` itself plus
 * its five exclusive sub-dependencies (`boxen`, `check-disk-space`,
 * `ansi-align`, `cli-boxes`, `widest-line`) — six packages in total dropped
 * from the published install.
 *
 * The shapes are structurally compatible with the terminus equivalents
 * (including the generic parameters on {@link HealthIndicatorResult}, the
 * `isHealthCheckError` discriminator on {@link HealthCheckError}, and the
 * `any`-typed `causes` argument), so plugin code that previously imported
 * these names from `@nestjs/terminus` can migrate by changing the import
 * path to `@vendure/core` (one-line change).
 */

/**
 * @description
 * The two valid status values for a {@link HealthIndicatorResult} entry.
 *
 * @docsCategory health-check
 * @deprecated Part of the deprecated health check feature; will be removed in v4.0.0.
 */
export type HealthIndicatorStatus = 'up' | 'down';

/**
 * @description
 * The result returned by a {@link HealthIndicatorFunction}. Keyed by the
 * indicator name, with a `status` of `'up'` or `'down'` and optional
 * additional diagnostic data.
 *
 * @docsCategory health-check
 * @deprecated Part of the deprecated health check feature; will be removed in v4.0.0.
 */
export type HealthIndicatorResult<
    Key extends string = string,
    Status extends HealthIndicatorStatus = HealthIndicatorStatus,
    OptionalData extends Record<string, any> = Record<string, any>,
> = Record<Key, { status: Status } & OptionalData>;

/**
 * @description
 * A function that performs a single health check and resolves to a
 * {@link HealthIndicatorResult}. Used as the return type of
 * {@link HealthCheckStrategy.getHealthIndicator}.
 *
 * @docsCategory health-check
 * @deprecated Part of the deprecated health check feature; will be removed in v4.0.0.
 */
export type HealthIndicatorFunction = () =>
    | PromiseLike<HealthIndicatorResult>
    | HealthIndicatorResult;

/**
 * @description
 * Thrown from a health indicator to signal a failed check. The `causes`
 * payload is forwarded to the `/health` response so callers can inspect
 * which indicator failed and why. `causes` is intentionally typed as
 * `any` (matching terminus) so handlers can pass through arbitrary
 * upstream error payloads (HTTP responses, DB driver errors, etc.)
 * without forcing them to conform to {@link HealthIndicatorResult}.
 *
 * The `isHealthCheckError` flag is a cross-realm discriminator (more
 * reliable than `instanceof` when multiple copies of the class can
 * exist) and is part of the public contract inherited from terminus.
 *
 * @docsCategory health-check
 * @deprecated Part of the deprecated health check feature; will be removed in v4.0.0.
 */
export class HealthCheckError extends Error {
    isHealthCheckError = true;
    causes: any;

    constructor(message: string, causes: any) {
        super(message);
        this.name = 'HealthCheckError';
        this.causes = causes;
    }
}

/**
 * @description
 * Base class for custom health indicators. Subclasses use {@link HealthIndicator.getStatus}
 * to build a {@link HealthIndicatorResult} and throw {@link HealthCheckError}
 * to signal failures.
 *
 * @docsCategory health-check
 * @deprecated Part of the deprecated health check feature; will be removed in v4.0.0.
 */
export abstract class HealthIndicator {
    protected getStatus(
        key: string,
        isHealthy: boolean,
        data?: { [optionalKey: string]: unknown },
    ): HealthIndicatorResult {
        return {
            [key]: { status: isHealthy ? 'up' : 'down', ...(data ?? {}) },
        };
    }
}
