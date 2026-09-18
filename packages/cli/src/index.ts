/**
 * Public API for extending the Vendure CLI with plugins.
 *
 * @example
 * ```ts
 * import { defineCliPlugin } from '@vendure/cli';
 * import type { CliCommandContext } from '@vendure/cli';
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
 *   // Runs once `vendure console link` has written the Project Link Manifest.
 *   afterConsoleLink: async ({ projectRoot, manifest, reporter }) => {
 *     reporter.info(`Set up ${manifest.project.name} in ${projectRoot}`);
 *   },
 * });
 * ```
 */
export { builtinCommands } from './commands/builtins';
export type { ConsoleSession } from './commands/console/cli-auth';
export type {
    ConsoleLinkContext,
    ConsoleLinkEndpoints,
    ConsoleLinkHook,
    ConsoleLinkHookRegistration,
    ConsoleLinkHookWithSession,
    ConsoleLinkOutcome,
} from './commands/console/console-link-hook';
export type { ConsoleOriginEnvironment } from './commands/console/console-origins';
export type { ConsoleReporter } from './commands/console/console-reporter';
export type { ProjectLinkManifest } from './commands/console/project-link-manifest';
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
export { CLI_PLUGIN_EXTENSION_POINTS, defineCliPlugin } from './shared/cli-plugin';
export type { CliPlugin } from './shared/cli-plugin';
export type { CliPluginExtensionAccessor, RegisteredCliPluginExtension } from './shared/cli-plugin-extension';
