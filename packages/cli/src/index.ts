/**
 * Public API for extending the Vendure CLI with plugins.
 *
 * @example
 * ```ts
 * import { defineCliPlugin, CliCommandContext } from '@vendure/cli';
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
 *   ],
 *   extendCommands: [
 *     {
 *       // Adds to the built-in dev command, so other plugins can wrap it too
 *       command: 'dev',
 *       options: [{ long: '--rotate-credential', description: 'Replace the credential' }],
 *       decorate: ({ next }) => async (...args) => {
 *         // optional setup...
 *         return next(...args);
 *       },
 *     },
 *   ],
 * });
 * ```
 */
export { builtinCommands } from './commands/builtins';
export { readCommandContext, readCommandOptions } from './shared/cli-command-definition';
export type {
    CliCommandAction,
    CliCommandArgument,
    CliCommandContext,
    CliCommandDecorator,
    CliCommandDecoratorInput,
    CliCommandDefinition,
    CliCommandExtension,
    CliCommandGroupDefinition,
    CliCommandNode,
    CliCommandOption,
    ProjectCliPluginConfig,
} from './shared/cli-command-definition';
export { defineCliPlugin } from './shared/cli-plugin';
export type { CliPlugin } from './shared/cli-plugin';
