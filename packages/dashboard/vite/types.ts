export type Logger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
    error: (message: string) => void;
};

export type PluginInfo = {
    name: string;
    pluginPath: string;
    dashboardEntryPath: string | undefined;
    /** The original source path of the plugin, only set for local plugins that are compiled */
    sourcePluginPath?: string;
};

export type GetCompiledConfigPathFn = (params: {
    inputRootDir: string;
    outputPath: string;
    configFileName: string;
}) => string;

export type TransformTsConfigPathMappingsFn = (params: {
    phase: 'compiling' | 'loading';
    alias: string;
    patterns: string[];
}) => string[];

/**
 * @description
 * The PathAdapter interface allows customization of how paths are handled
 * when compiling the Vendure config and its imports.
 *
 * It enables support for more complex repository structures, such as
 * monorepos, where the Vendure server configuration file may not
 * be located in the root directory of the project.
 *
 * If you get compilation errors like "Error loading Vendure config: Cannot find module",
 * you probably need to provide a custom `pathAdapter` to resolve the paths correctly.
 *
 * This can take some trial-and-error. Try logging values from the functions to figure out
 * the exact settings that you need for your repo setup.
 *
 * @example
 * ```ts
 * vendureDashboardPlugin({
 *     pathAdapter: {
 *         getCompiledConfigPath: ({ inputRootDir, outputPath, configFileName }) => {
 *             const projectName = inputRootDir.split('/libs/')[1].split('/')[0];
 *             const pathAfterProject = inputRootDir.split(`/libs/${projectName}`)[1];
 *             const compiledConfigFilePath = `${outputPath}/${projectName}${pathAfterProject}`;
 *             return path.join(compiledConfigFilePath, configFileName);
 *         },
 *         transformTsConfigPathMappings: ({ phase, patterns }) => {
 *             // "loading" phase is when the compiled Vendure code is being loaded by
 *             // the plugin, in order to introspect the configuration of your app.
 *             if (phase === 'loading') {
 *                 return patterns.map((p) =>
 *                     p.replace('libs/', '').replace(/.ts$/, '.js'),
 *                 );
 *             }
 *             return patterns;
 *         },
 *     },
 *     // ...
 * }),
 * ```
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 */
export interface PathAdapter {
    /**
     * @description
     * A function to determine the path to the compiled Vendure config file.
     */
    getCompiledConfigPath?: GetCompiledConfigPathFn;
    /**
     * If your project makes use of the TypeScript `paths` configuration, the compiler will
     * attempt to use these paths when compiling the Vendure config and its imports.
     */
    transformTsConfigPathMappings?: TransformTsConfigPathMappingsFn;
    /**
     * @description
     * The root directory used to compute relative output paths when compiling
     * TypeScript files. Compiled files preserve their directory structure
     * relative to this root.
     *
     * In monorepos this should typically be set to the workspace root (where
     * the base `tsconfig.json` lives), so that a config file at
     * `apps/server/src/vendure-config.ts` outputs to
     * `{outputPath}/apps/server/src/vendure-config.js`.
     *
     * Defaults to the directory containing the `vendureConfigPath` file,
     * which places the compiled config at the output root.
     *
     * @since 3.6.0
     */
    sourceRoot?: string;
}
