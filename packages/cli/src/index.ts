/**
 * Public API for extending the Vendure CLI with plugins.
 *
 * A plugin package adds commands with `defineCommand` from `@vendure/common/lib/command`, and
 * lists the command manifest it builds from them in its `package.json`. A CLI plugin adds shared
 * options, extends the built-in commands that are not declared with `defineCommand`, and runs a
 * hook after `vendure console link`.
 *
 * @example
 * ```ts
 * import { defineCliPlugin } from '@vendure/cli';
 *
 * export default defineCliPlugin({
 *   id: '@example/vendure-cli-plugin',
 *   rootOptions: [{ long: '--token <token>', description: 'API token' }],
 *   extendCommands: [
 *     {
 *       // Adds to the built-in start command, so other plugins can wrap it too
 *       command: 'start',
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
export {
    MANIFEST_FILE_NAME,
    buildCommandManifest,
    mergeManifests,
    writeCommandManifest,
} from '@vendure/common/lib/command/manifest';
export type {
    CommandManifest,
    ManifestCommand,
    MergedManifestCommand,
} from '@vendure/common/lib/command/manifest';
export {
    CLOUD_TOKEN_ENV,
    DeviceLoginDeniedError,
    DeviceLoginExpiredError,
    DeviceLoginPendingError,
    DeviceLoginReplacedError,
    NotLoggedInError,
    PERSON_REQUIRED_CODE,
    ReauthenticationRequiredError,
    SessionLockUnavailableError,
    SessionRefreshUnavailableError,
    SessionRejectedError,
    SessionUnstorableError,
    checkAuthStatus,
    completeDeviceLogin,
    credentialNeed,
    getAccessToken,
    isRenewalRefused,
    listOrganizations,
    loginWithDevice,
    logout,
    personNeedFromApiError,
    readAuthStatus,
    readCloudTokenEnv,
    refreshAccessToken,
    requireCredential,
    startDeviceLogin,
} from './auth/index.js';
export type {
    AuthOptions,
    AuthOrganization,
    AuthStatus,
    AuthUser,
    CloudCredential,
    CompleteDeviceLoginOptions,
    CredentialSource,
    DeviceAuthorization,
    DeviceLoginOptions,
    LogoutResult,
    PersonNeedContext,
    RenewalError,
    RenewalFailureDetails,
    RequireCredentialOptions,
    StartedDeviceLogin,
    StoredOrganization,
    WorkosClient,
} from './auth/index.js';
export type { AskInputOptions, HostResult, Prompter, SpawnFn, WriteSecretFn } from './command-host/host.js';
export { testCommand } from './command-host/test-command.js';
export type { TestCommandOptions, TestCommandResult } from './command-host/test-command.js';
export { builtinCommands } from './commands/builtins.js';
export type {
    ConsoleLinkContext,
    ConsoleLinkEndpoints,
    ConsoleLinkHook,
    ConsoleLinkHookRegistration,
    ConsoleLinkHookWithSession,
    ConsoleLinkOutcome,
    ConsoleSession,
    ConsoleSessionUnavailableReason,
} from './commands/console/console-link-hook.js';
export type { ConsoleOriginEnvironment, ConsoleOrigins } from './commands/console/console-origins.js';
export type { ConsoleReporter } from './commands/console/console-reporter.js';
export type {
    ConsoleCommandResult,
    ConsoleLinkResultContribution,
    ConsoleMissingInput,
    ConsoleResultData,
} from './commands/console/console-result.js';
export { consolePersonSteps } from './commands/console/console.errors.js';
export type { ProjectLinkManifest } from './commands/console/project-link-manifest.js';
export { readCommandContext, readCommandOptions } from './shared/cli-command-definition.js';
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
} from './shared/cli-command-definition.js';
export type {
    CliPluginExtensionAccessor,
    RegisteredCliPluginExtension,
} from './shared/cli-plugin-extension.js';
export { CLI_PLUGIN_EXTENSION_POINTS, defineCliPlugin } from './shared/cli-plugin.js';
export type { CliPlugin } from './shared/cli-plugin.js';
