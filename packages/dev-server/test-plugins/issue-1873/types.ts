/**
 * The plugin can be configured using the following options:
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PluginInitOptions {
  //
}

/**
 * https://www.vendure.io/docs/developer-guide/customizing-models/
 * https://www.typescriptlang.org/docs/handbook/modules.html#ambient-modules
 */
declare module '@vendure/core' {}
