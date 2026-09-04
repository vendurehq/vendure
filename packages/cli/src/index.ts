/**
 * Public API for extending the Vendure CLI with plugins.
 *
 * @example
 * ```ts
 * import { builtinCommands, defineCliPlugin, CliCommandContext } from '@vendure/cli';
 *
 * export default defineCliPlugin({
 *   id: '@example/vendure-cli-plugin',
 *   rootOptions: [{ long: '--token <token>', description: 'API token' }],
 *   commands: [
 *     {
 *       name: 'project',
 *       description: 'Manage projects',
 *       subcommands: [
 *         {
 *           name: 'list',
 *           description: 'List projects',
 *           action: async (options, command, context: CliCommandContext<{ token?: string }>) => {
 *             // context.inheritedOptions.token holds the shared --token value
 *             return 0;
 *           },
 *         },
 *       ],
 *     },
 *     {
 *       name: 'dev',
 *       description: 'Custom development command',
 *       replaces: true,
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
    CliCommandContext,
    CliCommandDefinition,
    CliCommandGroupDefinition,
    CliCommandNode,
    CliCommandOption,
    ProjectCliPluginConfig,
} from './shared/cli-command-definition';
export { defineCliPlugin } from './shared/cli-plugin';
export type { CliPlugin } from './shared/cli-plugin';
