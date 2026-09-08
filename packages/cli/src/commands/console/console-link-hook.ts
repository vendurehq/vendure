import { ConsoleOriginEnvironment } from './console-origins';
import { ProjectLinkManifest } from './project-link-manifest';

/**
 * How the `console` command reports progress. Handed to a
 * {@link ConsoleLinkHook} so a plugin's output goes to the same streams, in the
 * same style, as the rest of the command.
 *
 * @since 3.8.0
 */
export interface ConsoleReporter {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    url(value: string): void;
}

/**
 * The Console origins this run resolved, and will use.
 *
 * Not necessarily the origins the link was made against. The Project Link
 * Manifest records no origin, so on a repair these come from the environment
 * of the repairing run, not from whoever minted the manifest. See
 * {@link ConsoleLinkEndpoints.official}.
 *
 * @since 3.8.0
 */
export interface ConsoleLinkEndpoints {
    consoleUrl: string;
    apiUrl: string;
    /**
     * Which official Vendure Console this pair is, or `undefined` when it is
     * not an official one.
     *
     * Both official deployments are named, production and staging, because
     * refusing staging is as wrong as accepting an unknown host. The pair is
     * matched as a pair: a production app origin with a staging API is not
     * official, it points at two deployments at once. `undefined` also covers
     * a loopback pair, which is a development and test convenience and never
     * an official origin.
     *
     * This is a fact about where the manifest came from, not a permission. A
     * person answering the custom-endpoint prompt, or passing
     * `--allow-custom-console`, approved those origins for creating a Project
     * Link and writing identity metadata into this repository. They did not
     * approve sending anything secret there, and Console itself does not treat
     * a custom Project Link endpoint as one that may configure an
     * authenticated client.
     *
     * So a hook that holds credentials checks this before it reads a
     * credential file or sends a request, and refuses when the answer is
     * `undefined`. Do not derive the same conclusion from the absence of a
     * custom-endpoint prompt: that permits loopback, and it is not this.
     *
     * This describes where this run will talk, not where the manifest came
     * from. The manifest records no origin, so when
     * {@link ConsoleLinkContext.outcome} is `'repaired'` the Console that
     * issued these project and account identifiers is unknown, and a
     * `'production'` answer here does not vouch for them. A hook that acts on
     * the identifiers rather than only on the origin should treat a repair as
     * unverified provenance.
     */
    official: ConsoleOriginEnvironment | undefined;
}

/** @since 3.8.0 */
export type ConsoleLinkOutcome = 'linked' | 'repaired';

/**
 * What `vendure console link` hands a {@link ConsoleLinkHook}.
 *
 * Everything the command already resolved is passed in so that a hook never
 * repeats the work and reaches a different answer. `projectRoot` in particular:
 * re-deriving it from the working directory is how a plugin ends up writing
 * beside the manifest it thinks it wrote.
 *
 * @since 3.8.0
 */
export interface ConsoleLinkContext {
    /**
     * The absolute project directory the command resolved, after `--project`
     * and the search for the nearest `@vendure/core` dependency.
     */
    projectRoot: string;
    /**
     * The Project Link Manifest, as this run wrote it or as it already stood on
     * disk. Each hook gets its own copy, so one hook cannot change what the
     * next one reads.
     */
    manifest: ProjectLinkManifest;
    /** Absolute path of the manifest file. */
    manifestPath: string;
    endpoints: ConsoleLinkEndpoints;
    /**
     * Which of the two things `vendure console link` does brought the hook here.
     *
     * `'linked'` means this run created the Project Link and wrote the manifest
     * above. `'repaired'` means the project was already linked and the manifest
     * on disk was reused unchanged, so the hook is being asked to redo its own
     * setup for a link that has not moved.
     *
     * A hook that only writes files can ignore this. A hook that rotates a
     * remote credential cannot: repairing is the case where a credential the
     * developer no longer holds locally may still be live, and replacing it
     * takes the old one away. Confirm that before doing it.
     *
     * A repair also runs against a manifest this command did not write, which
     * may have arrived with a clone. Its identifiers are unverified.
     */
    outcome: ConsoleLinkOutcome;
    /**
     * Aborts on SIGINT and SIGTERM, the same signal the link itself ran under.
     * Anything a hook does remotely should be passed this, so that Ctrl-C does
     * not leave half-finished work behind.
     */
    signal: AbortSignal;
    reporter: ConsoleReporter;
    /**
     * Asks a yes/no question. Resolves `undefined` when the person cancelled,
     * which a hook should treat as "stop", not as "no".
     *
     * Only callable when {@link isNonInteractive} is `false`.
     *
     * Yes/no is all there is, deliberately. It covers confirming something
     * destructive, which is the decision that has to be taken here because it
     * is about what this link just did. A question with several answers, such
     * as which of a set of things to set up, is a conversation of its own and
     * belongs in the plugin's own command, where it owns the whole screen.
     */
    confirm(message: string): Promise<boolean | undefined>;
    /**
     * No terminal is attached, so {@link confirm} can never be answered. A hook
     * that needs a decision here should fail with a message naming the flag
     * that supplies it, rather than printing a question into a pipe.
     */
    isNonInteractive: boolean;
    /** Whether `--force` was given. */
    force: boolean;
}

/**
 * Runs after `vendure console link` has written the Project Link Manifest.
 *
 * The CLI owns linking: resolving the endpoints, approving custom ones, opening
 * the browser, polling for approval, validating the manifest and writing it
 * with the `.gitignore` rules. A hook adds what happens next for one plugin,
 * such as obtaining the credentials that project then needs.
 *
 * A hook never runs before the manifest is on disk, so it can rely on the link
 * being recorded. It equally cannot undo it: the manifest survives a hook that
 * fails, and the command says so rather than claiming nothing changed.
 *
 * A hook has to be repeatable, because `vendure console link` is the command
 * that repairs a link as well as the one that makes it. Run in a project that
 * is already linked, it reuses the manifest on disk and calls the hooks again
 * with an {@link ConsoleLinkContext.outcome} of `'repaired'`, rather than
 * minting a second Project Link in Console and leaving the first behind.
 * `--force` is the way to link a checkout to a different Project.
 *
 * Hooks run in `vendure.cli.plugins` order, one after another, and the first
 * one to throw stops the rest. Each is given its own context, so a hook cannot
 * change what a later one reads.
 *
 * Throwing is for work that failed, not for work that cannot be done here. A
 * hook that needs something it cannot get in this run should say what is
 * missing through {@link ConsoleLinkContext.reporter} and return. The command
 * still exits 0, because linking is what it was asked to do and it did it, and
 * `vendure console link` is what the developer runs again to finish the job.
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

/**
 * Hooks contributed by the plugins the host loaded.
 *
 * The `console` command is a static definition, so the host hands the hooks
 * over here once plugins have been applied, rather than the command reaching
 * into the registry. Tests pass them straight to `consoleCommand` instead.
 */
let registeredHooks: readonly RegisteredConsoleLinkHook[] = [];

export function setConsoleLinkHooks(hooks: readonly RegisteredConsoleLinkHook[]): void {
    registeredHooks = hooks;
}

export function getConsoleLinkHooks(): readonly RegisteredConsoleLinkHook[] {
    return registeredHooks;
}
