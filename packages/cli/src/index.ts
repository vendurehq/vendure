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
export { builtinCommands } from './commands/builtins';
export type {
    CliCommandArgument,
    CliCommandDefinition,
    CliCommandOption,
    ProjectCliPluginConfig,
} from './shared/cli-command-definition';
export { defineCliPlugin } from './shared/cli-plugin';
export type { CliPlugin } from './shared/cli-plugin';
