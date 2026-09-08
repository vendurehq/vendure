import { ConsoleSession } from './cli-auth';
import { ConsoleOriginEnvironment } from './console-origins';
import { ConsoleReporter } from './console-reporter';
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
    /** The Console CLI Session, when this hook requested one and the login succeeded. */
    session?: ConsoleSession;
    /** Aborts on SIGINT or SIGTERM. */
    signal: AbortSignal;
    reporter: ConsoleReporter;
    /** Asks a yes/no question. Use only when {@link isNonInteractive} is `false`. */
    confirm(message: string): Promise<boolean | undefined>;
    /** Whether no terminal is available for {@link confirm}. */
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
 * A hook together with the plugin that registered it, so a failure can name it.
 */
export interface RegisteredConsoleLinkHook {
    pluginId: string;
    hook: ConsoleLinkHook;
}
