import { ConsoleSession } from './cli-auth';
import { ConsoleOriginEnvironment } from './console-origins';
import { ConsoleReporter } from './console-reporter';
import { ConsoleLinkResultContribution } from './console-result';
import { ProjectLinkManifest } from './project-link-manifest';

/** The Console origins resolved for this run. @since 3.8.0 */
export interface ConsoleLinkEndpoints {
    consoleUrl: string;
    apiUrl: string;
    /** The matching official environment, or `undefined` for custom and loopback origins. */
    official: ConsoleOriginEnvironment | undefined;
}

/**
 * `'linked'` when the run created the Project Link, `'repaired'` when it reused
 * one already on disk.
 *
 * @since 3.8.0
 */
export type ConsoleLinkOutcome = 'linked' | 'repaired';

/** Values supplied to an {@link ConsoleLinkHook}. @since 3.8.0 */
export interface ConsoleLinkContext {
    /** The absolute Vendure project directory. */
    projectRoot: string;
    /** A copy of the Project Link Manifest for this hook. */
    manifest: ProjectLinkManifest;
    /** Absolute path of the manifest file. */
    manifestPath: string;
    endpoints: ConsoleLinkEndpoints;
    /** Whether this run created the link or reused the manifest on disk. */
    outcome: ConsoleLinkOutcome;
    /**
     * The `vendure auth` login's access token, when this hook requested a
     * session and a login exists. It has no `refreshToken`: the login's refresh
     * token is single-use and stays in the login.
     *
     * `getAccessToken()` from `@vendure/cli`, with `VENDURE_CONSOLE_API_URL`
     * set to `endpoints.apiUrl`, returns the same token and renews it.
     */
    session?: ConsoleSession;
    /** Aborts on SIGINT or SIGTERM. */
    signal: AbortSignal;
    reporter: ConsoleReporter;
    /** Requested output format. @since 3.8.0 */
    outputMode: 'human' | 'json';
    /** Isolated, immutable parsed options, including plugin flags. Never report secret values. @since 3.8.0 */
    options: Readonly<Record<string, unknown>>;
    /**
     * Adds safe setup data under this plugin's ID in Core's result. Incomplete
     * or failed setup returns non-zero and keeps the manifest.
     * Never include credentials, tokens or raw errors.
     * @since 3.8.0
     */
    contributeResult(contribution: ConsoleLinkResultContribution): void;
    /** Asks a yes/no question. Use only when {@link isNonInteractive} is `false`. */
    confirm(message: string): Promise<boolean | undefined>;
    /** Whether non-interactive mode was requested or no terminal is available for {@link confirm}. */
    isNonInteractive: boolean;
    /** Whether `--force` was given. */
    force: boolean;
}

/**
 * Runs after `vendure console link` writes or reuses the Project Link Manifest.
 * See the CLI guide for hook behavior and endpoint checks.
 *
 * @since 3.8.0
 */
export type ConsoleLinkHook = (context: ConsoleLinkContext) => Promise<void>;

/**
 * A hook that explicitly requests a Console session. `vendure console link`
 * then makes sure a `vendure auth` login exists before the hook runs, and
 * passes its access token as `session`.
 *
 * @since 3.8.0
 */
export interface ConsoleLinkHookWithSession {
    hook: ConsoleLinkHook;
    requiresSession: true;
}

/** A hook registration, optionally with an explicit session request. @since 3.8.0 */
export type ConsoleLinkHookRegistration = ConsoleLinkHook | ConsoleLinkHookWithSession;

/**
 * A hook together with the plugin that registered it, so a failure can name it.
 */
export interface RegisteredConsoleLinkHook {
    pluginId: string;
    hook: ConsoleLinkHook;
    requiresSession?: boolean;
}
