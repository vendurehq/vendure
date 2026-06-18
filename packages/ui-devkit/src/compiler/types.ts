import { LanguageCode } from '@vendure/common/lib/generated-types';

export type Extension =
    | AdminUiExtension
    | TranslationExtension
    | StaticAssetExtension
    | GlobalStylesExtension
    | SassVariableOverridesExtension;

/**
 * @description
 * Defines extensions to the Admin UI translations. Can be used as a stand-alone extension definition which only adds translations
 * without adding new UI functionality, or as part of a full {@link AdminUiExtension}.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface TranslationExtension {
    /**
     * @description
     * Optional object defining any translation files for the Admin UI. The value should be an object with
     * the key as a 2-character [ISO 639-1 language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes),
     * and the value being a [glob](https://github.com/isaacs/node-glob) for any relevant
     * translation files in JSON format.
     *
     * @example
     * ```ts
     * translations: {
     *   en: path.join(__dirname, 'translations/*.en.json'),
     *   de: path.join(__dirname, 'translations/*.de.json'),
     * }
     * ```
     */
    translations: { [languageCode in LanguageCode]?: string };
}

/**
 * @description
 * Defines extensions which copy static assets to the custom Admin UI application source asset directory.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface StaticAssetExtension {
    /**
     * @description
     * Optional array of paths to static assets which will be copied over to the Admin UI app's `/static`
     * directory.
     */
    staticAssets: StaticAssetDefinition[];
}

/**
 * @description
 * Defines extensions which add global styles to the custom Admin UI application.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface GlobalStylesExtension {
    /**
     * @description
     * Specifies a path (or array of paths) to global style files (css or Sass) which will be
     * incorporated into the Admin UI app global stylesheet.
     */
    globalStyles: string[] | string;
}

/**
 * @description
 * Defines an extension which allows overriding Clarity Design System's Sass variables used in styles on the Admin UI.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface SassVariableOverridesExtension {
    /**
     * @description
     * Specifies a path to a Sass style file containing variable declarations, which will take precedence over
     * default values defined in Clarity.
     */
    sassVariableOverrides: string;
}

/**
 * @description
 * Defines a route which will be added to the Admin UI application.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface UiExtensionRouteDefinition {
    /**
     * @description
     * The name of the route. This will be used as the path in the URL.
     */
    route: string;
    /**
     * @description
     * The path to the file which exports an array of Angular route definitions.
     */
    filePath: string;
    /**
     * @description
     * All extensions will be mounted under the `/extensions/` route. This option allows you to specify a
     * custom prefix rather than `/extensions/`. For example, setting this to `custom` would cause the extension
     * to be mounted at `/custom/<route>` instead.
     *
     * A common use case for this is to mount the extension at the root of the Admin UI, by setting this to an empty string.
     * This is useful when the extension is intended to replace the default Admin UI, rather than extend it.
     *
     * @since 2.2.0
     */
    prefix?: string;
}

/**
 * @description
 * Defines extensions to the Admin UI application by specifying additional
 * Angular [NgModules](https://angular.io/guide/ngmodules) which are compiled
 * into the application.
 *
 * See [Extending the Admin UI](/extending-the-admin-ui/getting-started/) for
 * detailed instructions.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 * @docsWeight 0
 */
export interface AdminUiExtension
    extends Partial<TranslationExtension>, Partial<StaticAssetExtension>, Partial<GlobalStylesExtension> {
    /**
     * @description
     * An optional ID for the extension module. Only used internally for generating
     * import paths to your module. If not specified, a unique hash will be used as the id.
     */
    id?: string;

    /**
     * @description
     * The path to the directory containing the extension module(s). The entire contents of this directory
     * will be copied into the Admin UI app, including all TypeScript source files, html templates,
     * scss style sheets etc.
     */
    extensionPath: string;

    /**
     * @description
     * One or more Angular modules which extend the default Admin UI.
     *
     * @deprecated use `routes` instead of lazy modules, and `providers` instead of shared modules in combination
     * with Angular standalone components.
     */
    ngModules?: Array<AdminUiExtensionSharedModule | AdminUiExtensionLazyModule>;

    /**
     * @description
     * Defines the paths to a file that exports an array of shared providers such as nav menu items, custom form inputs,
     * custom detail components, action bar items, custom history entry components.
     */
    providers?: string[];

    /**
     * @description
     * Defines routes that will be lazy-loaded at the `/extensions/` route. The filePath should point to a file
     * relative to the `extensionPath` which exports an array of Angular route definitions.
     */
    routes?: UiExtensionRouteDefinition[];

    /**
     * @description
     * An optional alias for the module so it can be referenced by other UI extension modules.
     *
     * By default, Angular modules declared in an AdminUiExtension do not have access to code outside the directory
     * defined by the `extensionPath`. A scenario in which that can be useful though is in a monorepo codebase where
     * a common NgModule is shared across different plugins, each defined in its own package. An example can be found
     * below - note that the main `tsconfig.json` also maps the target module but using a path relative to the project's
     * root folder. The UI module is not part of the main TypeScript build task as explained in
     * [Extending the Admin UI](https://www.vendure.io/docs/plugins/extending-the-admin-ui/) but having `paths`
     * properly configured helps with usual IDE code editing features such as code completion and quick navigation, as
     * well as linting.
     *
     * @example
     * ```ts title="packages/common-ui-module/src/ui/ui-shared.module.ts"
     * import { NgModule } from '\@angular/core';
     * import { SharedModule } from '\@vendure/admin-ui/core';
     * import { CommonUiComponent } from './components/common-ui/common-ui.component';
     *
     * export { CommonUiComponent };
     *
     * \@NgModule({
     *  imports: [SharedModule],
     *  exports: [CommonUiComponent],
     *  declarations: [CommonUiComponent],
     * })
     * export class CommonSharedUiModule {}
     * ```
     *
     * ```ts title="packages/common-ui-module/src/index.ts"
     * import path from 'path';
     *
     * import { AdminUiExtension } from '\@vendure/ui-devkit/compiler';
     *
     * export const uiExtensions: AdminUiExtension = {
     *   pathAlias: '\@common-ui-module',     // this is the important part // [!code highlight]
     *   extensionPath: path.join(__dirname, 'ui'),
     *   ngModules: [
     *     {
     *       type: 'shared' as const,
     *       ngModuleFileName: 'ui-shared.module.ts',
     *       ngModuleName: 'CommonSharedUiModule',
     *     },
     *   ],
     * };
     * ```
     *
     * ```json title="tsconfig.json"
     * {
     *   "compilerOptions": {
     *     "baseUrl": ".",
     *     "paths": {
     *       "\@common-ui-module/*": ["packages/common-ui-module/src/ui/*"] // [!code highlight]
     *     }
     *   }
     * }
     * ```
     *
     * ```ts title="packages/sample-plugin/src/ui/ui-extension.module.ts"
     * import { NgModule } from '\@angular/core';
     * import { SharedModule } from '\@vendure/admin-ui/core';
     * // the import below works both in the context of the custom Admin UI app as well as the main project // [!code highlight]
     * // '\@common-ui-module' is the value of "pathAlias" and 'ui-shared.module' is the file we want to reference inside "extensionPath" // [!code highlight]
     * import { CommonSharedUiModule, CommonUiComponent } from '\@common-ui-module/ui-shared.module'; // [!code highlight]
     *
     * \@NgModule({
     *   imports: [
     *     SharedModule,
     *     CommonSharedUiModule,
     *     RouterModule.forChild([
     *       {
     *         path: '',
     *         pathMatch: 'full',
     *         component: CommonUiComponent,
     *       },
     *     ]),
     *   ],
     * })
     * export class SampleUiExtensionModule {}
     * ```
     */
    pathAlias?: string;

    /**
     * @description
     * Optional array specifying filenames or [glob](https://github.com/isaacs/node-glob) patterns that should
     * be skipped when copying the directory defined by `extensionPath`.
     *
     * @example
     * ```ts
     * exclude: ['**\/*.spec.ts']
     * ```
     */
    exclude?: string[];
}

/**
 * @description
 * A static asset can be provided as a path to the asset, or as an object containing a path and a new
 * name, which will cause the compiler to copy and then rename the asset.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export type StaticAssetDefinition = string | { path: string; rename: string };

/**
 * @description
 * Configuration defining a single NgModule with which to extend the Admin UI.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface AdminUiExtensionSharedModule {
    /**
     * @description
     * Shared modules are directly imported into the main AppModule of the Admin UI
     * and should be used to declare custom form components and define custom
     * navigation items.
     */
    type: 'shared';
    /**
     * @description
     * The name of the file containing the extension module class.
     */
    ngModuleFileName: string;
    /**
     * @description
     * The name of the extension module class.
     */
    ngModuleName: string;
}

/**
 * @description
 * Configuration defining a single NgModule with which to extend the Admin UI.
 *
 * @docsCategory UiDevkit
 * @docsPage AdminUiExtension
 */
export interface AdminUiExtensionLazyModule {
    /**
     * @description
     * Lazy modules are lazy-loaded at the `/extensions/` route and should be used for
     * modules which define new views for the Admin UI.
     */
    type: 'lazy';
    /**
     * @description
     * The route specifies the route at which the module will be lazy-loaded. E.g. a value
     * of `'foo'` will cause the module to lazy-load when the `/extensions/foo` route
     * is activated.
     */
    route: string;
    /**
     * @description
     * The name of the file containing the extension module class.
     */
    ngModuleFileName: string;
    /**
     * @description
     * The name of the extension module class.
     */
    ngModuleName: string;
}

/**
 * @description
 * Argument to configure process (watch or compile)
 *
 * @docsCategory UiDevkit
 */
export type UiExtensionCompilerProcessArgument = string | [string, any];

/**
 * @description
 * The package manager to use when invoking the Angular CLI to build UI extensions.
 *
 * @docsCategory UiDevkit
 */
export type UiExtensionBuildCommand = 'npm' | 'yarn' | 'pnpm';

/**
 * @description
 * Options to configure how the Admin UI should be compiled.
 *
 * @docsCategory UiDevkit
 */
export interface UiExtensionCompilerOptions {
    /**
     * @description
     * The directory into which the sources for the extended Admin UI will be copied.
     */
    outputPath: string;
    /**
     * @description
     * An array of objects which configure Angular modules and/or
     * translations with which to extend the Admin UI.
     */
    extensions: Extension[];
    /**
     * @description
     * Allows you to manually specify the path to the Angular CLI compiler script. This can be useful in scenarios
     * where for some reason the built-in start/build scripts are unable to locate the `ng` command.
     *
     * This option should not usually be required.
     *
     * @example
     * ```ts
     * compileUiExtensions({
     *     ngCompilerPath: path.join(__dirname, '../../node_modules/@angular/cli/bin/ng.js'),
     *     outputPath: path.join(__dirname, '../admin-ui'),
     *     extensions: [
     *       // ...
     *     ],
     * })
     * ```
     *
     * @since 2.1.0
     */
    ngCompilerPath?: string | undefined;
    /**
     * @description
     * Set to `true` in order to compile the Admin UI in development mode (using the Angular CLI
     * [ng serve](https://angular.io/cli/serve) command). When in dev mode, any changes to
     * UI extension files will be watched and trigger a rebuild of the Admin UI with live
     * reloading.
     *
     * @default false
     */
    devMode?: boolean;
    /**
     * @description
     * Allows the baseHref of the compiled Admin UI app to be set. This determines the prefix
     * of the app, for example with the default value of `'/admin/'`, the Admin UI app
     * will be configured to be served from `http://<host>/admin/`.
     *
     * Note: if you are using this in conjunction with the {@link AdminUiPlugin} then you should
     * also set the `route` option to match this value.
     *
     * @example
     * ```ts
     * AdminUiPlugin.init({
     *   route: 'my-route',
     *   port: 5001,
     *   app: compileUiExtensions({
     *     baseHref: '/my-route/',
     *     outputPath: path.join(__dirname, './custom-admin-ui'),
     *     extensions: [],
     *     devMode: true,
     *   }),
     * }),
     * ```
     *
     * @default '/admin/'
     */
    baseHref?: string;
    /**
     * @description
     * In watch mode, allows the port of the dev server to be specified. Defaults to the Angular CLI default
     * of `4200`.
     *
     * @default 4200 | undefined
     */
    watchPort?: number;

    /**
     * @description
     * Internally, the Angular CLI will be invoked as an npm script. By default, the compiler will use Yarn
     * to run the script if it is detected, otherwise it will use npm. This setting allows you to explicitly
     * set which command to use, including pnpm, rather than relying on the default behavior.
     *
     * @since 1.5.0
     */
    command?: UiExtensionBuildCommand;

    /**
     * @description
     * Additional command-line arguments which will get passed to the [ng build](https://angular.io/cli/build)
     * command (or [ng serve](https://angular.io/cli/serve) if `devMode = true`).
     *
     * @example
     * ['--disable-host-check'] // to disable host check
     *
     * @default undefined
     *
     * @since 1.5.0
     */
    additionalProcessArguments?: UiExtensionCompilerProcessArgument[];
}

export type Translations = {
    [section: string]: {
        [token: string]: string;
    };
};

export interface BrandingOptions {
    smallLogoPath?: string;
    largeLogoPath?: string;
    faviconPath?: string;
}

export interface AdminUiExtensionWithId extends AdminUiExtension {
    id: string;
}
