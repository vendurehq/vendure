/**
 * Public API for extending the Vendure CLI with plugins.
 *
 * @example
 * ```ts
 * import { builtinCommands, defineCliPlugin } from '@vendure/cli';
 *
 * export default defineCliPlugin({
 *   id: '@example/vendure-cli-plugin',
 *   commands: [
 *     {
 *       name: 'dev',
 *       description: 'Custom development command',
 *       action: async (target, options) => {
 *         // optional setup...
 *         return builtinCommands.dev.action(target, options);
 *       },
 *     },
 *   ],
 * });
 * ```
 */
export { builtinCommands, cliCommands } from './commands/command-declarations';
export type {
    CliCommandArgument,
    CliCommandConfig,
    CliCommandDefinition,
    CliCommandOption,
    ProjectCliPluginConfig,
} from './shared/cli-command-definition';
export { defineCliPlugin, isCliPlugin } from './shared/cli-plugin';
export type { CliPlugin } from './shared/cli-plugin';
export { CommandRegistry } from './shared/command-registry-store';
export { registerCommands } from './shared/command-registry';
export {
    listDirectDependencyNames,
    resolveCliPlugins,
    resolveCliProjectRoot,
} from './shared/resolve-cli-plugins';
export type {
    PackageJsonLike,
    ResolveCliPluginsOptions,
    ResolvedCliPlugin,
} from './shared/resolve-cli-plugins';
