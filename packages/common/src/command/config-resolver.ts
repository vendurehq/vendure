/**
 * @description
 * What a config resolver is told about the project whose config the CLI needs.
 *
 * @since 4.0.0
 */
export interface ConfigResolverContext {
    /** The absolute path of the project's root directory, the one with its `package.json`. */
    projectDir: string;
    /** The config file the user named with `--config`, as they wrote it, when they named one. */
    configFile?: string;
    /** Aborts when the command that needs the config is cancelled. */
    signal: AbortSignal;
}

/**
 * @description
 * The module a {@link ConfigResolverDefinition} loads. Its `resolve` returns the project's
 * `VendureConfig`, or `undefined` when the project is not one the resolver handles, so the CLI asks
 * the next resolver.
 *
 * The return type is `object` because `@vendure/common` does not depend on `@vendure/core`. A
 * resolver returns a `VendureConfig`.
 *
 * @since 4.0.0
 */
export interface ConfigResolverModule {
    resolve(ctx: ConfigResolverContext): Promise<object | undefined>;
}

/**
 * @description
 * How a package gives the CLI the config of a project whose config is not a `VendureConfig`
 * declared in its source, such as one built at run time. The package's declarations module exports
 * it as `configResolver`, and `writeCommandManifest` records `hasConfigResolver: true` in its
 * manifest. The CLI imports the module only when a command needs the project's config, such as
 * `vendure migrate generate`, and never at startup or in `vendure mcp`.
 *
 * @since 4.0.0
 */
export interface ConfigResolverDefinition {
    /** Loads the resolver, usually as `() => import('./config-resolver.js')`. */
    resolve: () => Promise<ConfigResolverModule>;
}

/**
 * @description
 * Declares a config resolver. It returns its argument. See {@link ConfigResolverDefinition}.
 *
 * @example
 * ```ts
 * export const configResolver = defineConfigResolver({
 *     resolve: () => import('./config-resolver.js'),
 * });
 * ```
 *
 * @since 4.0.0
 */
export function defineConfigResolver<T extends ConfigResolverDefinition>(resolver: T): T {
    return resolver;
}

/**
 * Reads the `configResolver` a declarations module exports, or `undefined` when it exports none.
 * It throws when the export is not a config resolver.
 */
export function configResolverDeclaration(declarationsModule: unknown): ConfigResolverDefinition | undefined {
    const mod = (declarationsModule ?? {}) as { configResolver?: unknown; default?: unknown };
    const fallback = (mod.default ?? {}) as { configResolver?: unknown };
    const resolver = mod.configResolver ?? fallback.configResolver;
    if (resolver === undefined) {
        return undefined;
    }
    if (typeof (resolver as { resolve?: unknown }).resolve !== 'function') {
        throw new TypeError('The module exports "configResolver" that has no resolve() function');
    }
    return resolver as ConfigResolverDefinition;
}
