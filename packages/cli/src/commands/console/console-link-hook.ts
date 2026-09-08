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
 * The Console origins the link was made against.
 *
 * @since 3.8.0
 */
export interface ConsoleLinkEndpoints {
    consoleUrl: string;
    apiUrl: string;
    /**
     * Whether these are the built-in production origins, rather than the pair
     * given by `VENDURE_CONSOLE_LINK_URL` and `VENDURE_CONSOLE_LINK_API_URL`.
     *
     * This is a fact about where the manifest came from, not a permission. A
     * person answering the custom-endpoint prompt, or passing
     * `--allow-custom-console`, approved those origins for creating a Project
     * Link and writing identity metadata into this repository. They did not
     * approve sending anything secret there, and Console itself does not treat
     * a custom Project Link endpoint as one that may configure an authenticated
     * client.
     *
     * So a hook that holds credentials keeps its own list of the hosts it will
     * talk to, checks these origins against it before it reads a credential
     * file or sends a request, and refuses when they do not match. `false` here
     * means the link was made against a Console that such a hook should decline
     * to use, not one it should follow.
     */
    areDefault: boolean;
}

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
    /** The Project Link Manifest as it was written. */
    manifest: ProjectLinkManifest;
    /** Absolute path of the manifest file. */
    manifestPath: string;
    endpoints: ConsoleLinkEndpoints;
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
 * fails, and the command says so rather than claiming nothing changed. Work
 * that has to be repeatable belongs in a command of its own, because running
 * `vendure console link` again creates a new Project Link rather than repairing
 * the existing one.
 *
 * Hooks run in `vendure.cli.plugins` order, one after another, and the first
 * one to throw stops the rest.
 *
 * Throwing is for work that failed, not for work that cannot be done here. A
 * hook that needs an answer it cannot get — no terminal, so no sign-in, so no
 * credential — should say what is missing through {@link ConsoleLinkContext.reporter}
 * and return. The command still exits 0, because linking is what it was asked
 * to do and it did it. Naming the command that finishes the job is the hook's
 * to do: the CLI does not suggest one, and never suggests linking again.
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
