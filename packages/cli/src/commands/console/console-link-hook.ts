import { ConsoleOriginEnvironment } from './console-origins.js';
import { ConsoleReporter } from './console-reporter.js';
import { ConsoleLinkResultContribution } from './console-result.js';
import { ProjectLinkManifest } from './project-link-manifest.js';

/**
 * The session `vendure console link` gives an `afterConsoleLink` hook that requested one: the
 * stored login's access token and when it expires. The refresh token stays in the login, because
 * it is single-use. Do not store the token. When a token is needed, call `getAccessToken()` from
 * `@vendure/cli` with `VENDURE_CONSOLE_API_URL` set to `endpoints.apiUrl`, so the CLI renews it.
 *
 * @since 3.8.0
 */
export interface ConsoleSession {
    accessToken: string;
    /** Epoch milliseconds. */
    expiresAt: number;
}

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

/**
 * Why a hook that requested a session has none.
 *
 * - `'not-signed-in'`: no CLI login for the linked account is stored, and this run does not sign in.
 * - `'account-inaccessible'`: the signed-in user is not a member of the Customer Account the manifest
 *   links to. Signing in again as the same user does not help: `vendure console link --project <id|slug>`
 *   links one of the user's own Projects, an administrator of that account adds the user, or the user runs
 *   `vendure auth login` with another Vendure Console login that is a member. The CLI has said so.
 * - `'sign-in-failed'`: the sign-in failed. The CLI has reported why.
 * - `'environment-credential'`: `vendure console link` created the link with `VENDURE_CLOUD_TOKEN`,
 *   such as an agent's delegated key, which is never given to a hook. Do not fall back to
 *   `getAccessToken()`: a stored login, if any, is not the credential this run uses. A repeated
 *   link with only the token gives `'not-signed-in'`. Since 4.0.0.
 *
 * @since 3.8.2
 */
export type ConsoleSessionUnavailableReason =
    | 'not-signed-in'
    | 'account-inaccessible'
    | 'sign-in-failed'
    | 'environment-credential';

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
    /**
     * Set when this hook requested a session and has none. With
     * `'account-inaccessible'` or `'environment-credential'`, do not fall back to
     * `getAccessToken()`: a stored login belongs to another account, or is not
     * the credential this run uses. @since 3.8.2
     */
    sessionUnavailable?: ConsoleSessionUnavailableReason;
    /** Aborts on SIGINT or SIGTERM. */
    signal: AbortSignal;
    reporter: ConsoleReporter;
    /** Requested output format. @since 3.8.0 */
    outputMode: 'human' | 'json';
    /**
     * An isolated, immutable copy of the command's input, as given: `dir` (the project directory),
     * `consoleProject` (the Console Project, which `--project` names) and `organization`. Never
     * report secret values.
     *
     * Since 4.0.0, the project directory is `dir` rather than `project`, which hooks no longer
     * get, and `force`, `yes`, `json`, `nonInteractive` and plugin flags are gone.
     *
     * @since 3.8.0
     */
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
    /** Whether the caller gave the `replaceLink` consent, so this link replaced another. */
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
