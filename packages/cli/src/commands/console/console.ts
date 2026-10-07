import { confirm, isCancel, log, select } from '@clack/prompts';

import {
    NotLoggedInError,
    ReauthenticationRequiredError,
    SessionRejectedError,
} from '../../auth/auth-errors';
import { AuthOptions } from '../../auth/auth-options';
import { getAccessToken, loginWithDevice, readAuthStatus, refreshAccessToken } from '../../auth/auth-session';
import { StoredOrganization } from '../../auth/auth-store';
import { CliCommandExit } from '../../shared/cli-command-exit';
import { isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';

import { openConsoleBrowser } from './authentication';
import { ConsoleSession } from './cli-auth';
import { ConsoleLinkContext, ConsoleLinkOutcome, RegisteredConsoleLinkHook } from './console-link-hook';
import {
    ConsoleOrigins,
    DEFAULT_CONSOLE_API_URL,
    DEFAULT_CONSOLE_URL,
    officialConsoleEnvironment,
    trustedConsoleOrigins,
} from './console-origins';
import { ConsoleReporter } from './console-reporter';
import { ConsoleCommandResult, ConsoleLinkResultContribution } from './console-result';
import { ensureProjectLinkGitignore } from './project-link-gitignore';
import {
    ManifestReadResult,
    PROJECT_LINK_MANIFEST_RELATIVE_PATH,
    ProjectLinkManifest,
    parseProjectLinkManifest,
    readProjectLinkManifest,
    removeProjectLinkManifest,
    resolveProjectRoot,
    withConsoleOrigins,
    writeProjectLinkManifestAtomic,
} from './project-link-manifest';
import { nonEmptyString, objectValue, uuid } from './project-link-validation';

const PROJECTS_PATH = '/v1/projects';
const REQUEST_TIMEOUT_MS = 10_000;
/** The project list grows with the account, so the cap is wider than one manifest needs. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DOCS_MCP_URL = 'https://docs.vendure.io/mcp';
const CODING_ASSISTANT_GUIDE_URL =
    'https://docs.vendure.io/guides/developer-guide/cli#use-vendure-development-workflows-in-your-coding-assistant';

export interface ConsoleCommandOptions {
    json?: boolean;
    nonInteractive?: boolean;
    project?: string;
    force?: boolean;
    /** Answers every confirmation owned by the CLI. */
    yes?: boolean;
    /** The organization to link a project of: its Account identifier or its name. */
    organization?: string;
}

export interface ConsoleCommandDependencies {
    cwd: string;
    env: NodeJS.ProcessEnv;
    fetch: typeof globalThis.fetch;
    /**
     * Plugin hooks to run once a link has been written. Defaults to the ones
     * the host collected from the loaded plugins.
     */
    hooks: readonly RegisteredConsoleLinkHook[];
    isNonInteractive: () => boolean;
    now: () => number;
    openUrl: (url: string) => Promise<void>;
    prompt: (message: string) => Promise<boolean | undefined>;
    /** Asks the user to choose one value. Resolves `undefined` when the prompt was cancelled. */
    select: (
        message: string,
        choices: Array<{ value: string; label: string }>,
    ) => Promise<string | undefined>;
    reporter: ConsoleReporter;
    signal?: AbortSignal;
}

interface ConsoleEndpoints {
    apiUrl: string;
    consoleUrl: string;
}

/** An active Console Project of the signed-in organization. */
interface ConsoleProject {
    id: string;
    name: string;
}

/** The CLI login a command uses, matched to the Console it calls. */
interface ConsoleLogin {
    auth: AuthOptions;
    accessToken: string;
}

class ConsoleRequestError extends Error {
    constructor(
        message: string,
        readonly httpStatus?: number,
    ) {
        super(message);
        this.name = 'ConsoleRequestError';
    }
}

class CommandInterruptedError extends Error {
    constructor() {
        super('The Console command was interrupted.');
        this.name = 'CommandInterruptedError';
    }
}

const defaultReporter: ConsoleReporter = {
    error: message => log.error(message),
    info: message => log.info(message),
    success: message => log.success(message),
    warn: message => log.warn(message),
    url: value => process.stdout.write(`${value}\n`),
};

function createDefaultDependencies(): ConsoleCommandDependencies {
    return {
        cwd: process.cwd(),
        env: process.env,
        fetch: globalThis.fetch,
        hooks: [],
        isNonInteractive: () => isNonInteractiveEnvironment(),
        now: () => Date.now(),
        openUrl: openConsoleBrowser,
        prompt: async message => {
            const result = await withInteractiveTimeout(() => confirm({ message }), {
                examples: ['vendure console link --force', 'vendure console unlink --force'],
                helpCommands: ['vendure console --help'],
            });
            return isCancel(result) ? undefined : result;
        },
        select: async (message, choices) => {
            const result = await withInteractiveTimeout(() => select({ message, options: choices }), {
                examples: ['vendure console link'],
                helpCommands: ['vendure console --help'],
            });
            return isCancel(result) ? undefined : String(result);
        },
        reporter: defaultReporter,
    };
}

export async function consoleCommand(
    action?: string,
    options: ConsoleCommandOptions = {},
    dependencies: Partial<ConsoleCommandDependencies> = {},
): Promise<number> {
    const normalizedAction = action?.trim().toLowerCase();
    const resolvedDependencies = { ...createDefaultDependencies(), ...dependencies };
    // Prompts also stay disabled in JSON mode so stdout contains only the result.
    if (options.nonInteractive || options.json) {
        resolvedDependencies.isNonInteractive = () => true;
    }
    if (options.json) {
        const report = (message: string) => {
            process.stderr.write(`${message}\n`);
        };
        resolvedDependencies.reporter = {
            error: report,
            info: report,
            success: report,
            warn: report,
            url: report,
        };
    }
    const abortController = new AbortController();
    let interruptedExitCode: number | undefined;
    const onSigint = () => {
        interruptedExitCode = 130;
        abortController.abort();
    };
    const onSigterm = () => {
        interruptedExitCode = 143;
        abortController.abort();
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    const externalSignal = dependencies.signal;
    const onExternalAbort = () => abortController.abort();
    if (externalSignal?.aborted) {
        abortController.abort();
    } else {
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }

    const state: ConsoleCommandState = {
        result: {
            schemaVersion: 1,
            operation:
                normalizedAction && ['link', 'status', 'unlink'].includes(normalizedAction)
                    ? `console.${normalizedAction}`
                    : 'console',
            outcome: 'failed',
            data: { plugins: Object.create(null) },
            missingInputs: [],
            nextSteps: [],
        },
    };
    try {
        const code = await runConsoleCommand(
            action,
            options,
            resolvedDependencies,
            abortController.signal,
            state,
        );
        if (state.setupIncomplete) {
            return 1;
        }
        if (code === 0) {
            state.result.outcome = state.outcome ?? (normalizedAction === 'unlink' ? 'unlinked' : 'read');
        }
        return code;
    } catch (error) {
        return reportConsoleCommandError(
            error,
            options,
            resolvedDependencies.reporter,
            state,
            interruptedExitCode,
        );
    } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        if (options.json) {
            process.stdout.write(`${JSON.stringify(state.result)}\n`);
        }
    }
}

/** Reports a failure without exposing raw errors in JSON mode. */
function reportConsoleCommandError(
    error: unknown,
    options: ConsoleCommandOptions,
    reporter: ConsoleReporter,
    state: ConsoleCommandState,
    interruptedExitCode: number | undefined,
): number {
    state.result.outcome = 'failed';
    state.result.nextSteps.push('Check the Console configuration and rerun vendure console link.');
    if (interruptedExitCode !== undefined || error instanceof CommandInterruptedError) {
        // A process signal wins so SIGTERM retains exit code 143. Prompt cancellation and external aborts use 130.
        reporter.warn(
            // An interrupt after the manifest was written stopped setup, not the link.
            state.manifestPath && state.outcome
                ? `Console command interrupted. ${linkUnfinished(state.outcome, state.manifestPath)}`
                : 'Console command interrupted. No Project Link Manifest was changed.',
        );
        return interruptedExitCode ?? 130;
    }
    if (error instanceof CliCommandExit) {
        if (options.json) {
            return error.exitCode || 1;
        }
        throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    reporter.error(options.json ? 'The Console command failed.' : detail);
    return 1;
}

/**
 * What the run has already done, for messages that would otherwise overstate
 * how much an interrupt took back.
 */
interface ConsoleCommandState {
    result: ConsoleCommandResult;
    setupIncomplete?: boolean;
    /** Set once the Project Link Manifest is on disk, written or reused. */
    manifestPath?: string;
    outcome?: ConsoleLinkOutcome;
}

async function runConsoleCommand(
    action: string | undefined,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    state: ConsoleCommandState,
): Promise<number> {
    const normalizedAction = action?.trim().toLowerCase();
    if (!normalizedAction || !['link', 'status', 'unlink'].includes(normalizedAction)) {
        dependencies.reporter.error(
            normalizedAction ? `Unknown console action "${String(action)}".` : 'Missing console action.',
        );
        dependencies.reporter.info(
            'Examples:\n   vendure console link\n   vendure console status\n   vendure console unlink',
        );
        return 1;
    }

    assertNoRemovedConsoleEnvironment(dependencies.env);

    const projectRoot = resolveProjectRoot(dependencies.cwd, options.project);
    if (normalizedAction === 'status') {
        return status(projectRoot, dependencies.env, dependencies.reporter);
    }
    if (normalizedAction === 'unlink') {
        return unlink(projectRoot, options, dependencies);
    }
    return link(projectRoot, options, dependencies, signal, state);
}

function assertNoRemovedConsoleEnvironment(env: NodeJS.ProcessEnv): void {
    const replacements = [
        ['VENDURE_CONSOLE_LINK_URL', 'VENDURE_CONSOLE_APP_URL'],
        ['VENDURE_CONSOLE_LINK_API_URL', 'VENDURE_CONSOLE_API_URL'],
    ] as const;
    const messages = replacements
        .filter(([removed]) => env[removed] !== undefined)
        .map(([removed, replacement]) => `${removed} is no longer supported. Use ${replacement} instead.`);
    if (messages.length > 0) {
        throw new Error(messages.join('\n'));
    }
}

export function resolveConsoleEndpoints(
    env: NodeJS.ProcessEnv,
    manifestConsole?: ConsoleOrigins,
): ConsoleEndpoints {
    const consoleOverride = env.VENDURE_CONSOLE_APP_URL?.trim() || undefined;
    const apiOverride = env.VENDURE_CONSOLE_API_URL?.trim() || undefined;
    if (Boolean(consoleOverride) !== Boolean(apiOverride)) {
        throw new Error(
            'Set both VENDURE_CONSOLE_APP_URL and VENDURE_CONSOLE_API_URL, or unset both to use the linked Console or production default.',
        );
    }
    const configured =
        consoleOverride && apiOverride
            ? trustedConsoleOrigins(
                  { appOrigin: consoleOverride, apiOrigin: apiOverride },
                  { app: 'VENDURE_CONSOLE_APP_URL', api: 'VENDURE_CONSOLE_API_URL' },
              )
            : undefined;
    if (
        configured &&
        manifestConsole &&
        (configured.appOrigin !== manifestConsole.appOrigin ||
            configured.apiOrigin !== manifestConsole.apiOrigin)
    ) {
        throw new Error(
            [
                'The configured Console conflicts with the Project Link Manifest.',
                `Manifest Console: ${manifestConsole.appOrigin} (API: ${manifestConsole.apiOrigin})`,
                `Environment Console: ${configured.appOrigin} (API: ${configured.apiOrigin})`,
                'Unset VENDURE_CONSOLE_APP_URL and VENDURE_CONSOLE_API_URL to use the linked Console.',
            ].join('\n'),
        );
    }
    const resolved = configured ??
        manifestConsole ?? {
            appOrigin: DEFAULT_CONSOLE_URL,
            apiOrigin: DEFAULT_CONSOLE_API_URL,
        };
    return { consoleUrl: resolved.appOrigin, apiUrl: resolved.apiOrigin };
}

async function link(
    projectRoot: string,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    state: ConsoleCommandState,
): Promise<number> {
    const existing = readProjectLinkManifest(projectRoot);
    const endpoints = resolveConsoleEndpoints(
        dependencies.env,
        existing.kind === 'valid' ? existing.manifest.console : undefined,
    );
    if (existing.kind === 'valid' && !options.force) {
        // A repeated link reuses the manifest and reruns plugin setup.
        return repair(
            projectRoot,
            existing.manifest,
            existing.path,
            endpoints,
            options,
            dependencies,
            signal,
            state,
        );
    }
    const replacementFlag = options.force ? ' --force' : '';
    if (options.nonInteractive) {
        state.result.outcome = 'incomplete';
        state.result.missingInputs.push({ input: 'projectLinkApproval', command: 'vendure console link' });
        const nextStep =
            `Run vendure console link --project ${JSON.stringify(projectRoot)}${replacementFlag} ` +
            'interactively, sign in and choose the Console Project. Then rerun this command.';
        state.result.nextSteps.push(nextStep);
        dependencies.reporter.error('Choosing the Console Project to link requires an interactive run.');
        dependencies.reporter.info(nextStep);
        return 1;
    }
    if (existing.kind !== 'missing') {
        const confirmed = await confirmManifestChange('replace', existing, options, dependencies);
        if (confirmed !== 'confirmed') {
            return confirmed === 'cancelled' ? 0 : 1;
        }
    }

    const login = await signIn(endpoints, options.organization, dependencies, signal);
    const organization = readAuthStatus(login.auth).organization;
    if (!organization) {
        throw new Error(
            'Your CLI login is not scoped to an organization. Run vendure console link --organization ' +
                '<account> with the Account identifier from Vendure Console → Settings.',
        );
    }
    const accountName = describeOrganization(organization);
    const project = await chooseProject(
        await listProjects(endpoints, login, accountName, dependencies, signal),
        accountName,
        endpoints,
        dependencies,
    );
    const linkedManifest = await linkProject(endpoints, login, project, accountName, dependencies, signal);
    throwIfAborted(signal);
    const manifest = withConsoleOrigins(linkedManifest, {
        appOrigin: endpoints.consoleUrl,
        apiOrigin: endpoints.apiUrl,
    });
    const manifestPath = await writeProjectLinkManifestAtomic(projectRoot, manifest);
    state.outcome = 'linked';
    state.manifestPath = manifestPath;
    state.result.data.link = { outcome: 'linked', manifestPath };
    dependencies.reporter.success(`Linked ${manifest.project.name} to ${manifest.account.name}.`);
    dependencies.reporter.info(`Wrote ${manifestPath}`);
    reportProjectLinkGitignore(projectRoot, dependencies.reporter);

    const code = await runConsoleLinkHooks(
        {
            projectRoot,
            manifest,
            manifestPath,
            endpoints,
            outcome: 'linked',
            session: dependencies.hooks.some(hook => hook.requiresSession) ? hookSession(login) : undefined,
        },
        options,
        dependencies,
        signal,
        state,
    );
    reportCodingAssistantSetup(code, manifest, options, dependencies.reporter);
    return code;
}

/**
 * The options that make the auth functions use the Console this command
 * calls. `VENDURE_CONSOLE_API_URL` is set to that Console, because a link can
 * take its Console from the manifest while the variable is unset.
 */
function consoleAuthOptions(
    endpoints: ConsoleEndpoints,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): AuthOptions {
    return {
        env: { ...dependencies.env, VENDURE_CONSOLE_API_URL: endpoints.apiUrl },
        fetch: dependencies.fetch,
        now: dependencies.now,
        signal,
    };
}

/**
 * Returns the CLI login for this Console, the same one `vendure auth login`
 * stores. Signs in with the device flow first when this machine has no usable
 * login, or when `organization` names a different organization than the
 * stored login.
 */
async function signIn(
    endpoints: ConsoleEndpoints,
    organization: string | undefined,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ConsoleLogin> {
    const auth = consoleAuthOptions(endpoints, dependencies, signal);
    const wanted = organization?.trim() || undefined;
    try {
        // Inside the try: renewing a stored login can be interrupted too.
        const stored = await storedLogin(auth, wanted);
        if (stored) {
            return stored;
        }
        await loginWithDevice({
            ...auth,
            organization: wanted,
            onDeviceAuthorization: async device => {
                dependencies.reporter.info(
                    `Sign in to Vendure Console. Confirm this code in your browser: ${device.userCode}\n` +
                        `If the browser does not open, visit ${device.verificationUriComplete}`,
                );
                try {
                    await dependencies.openUrl(device.verificationUriComplete);
                } catch {
                    // The URL is already on screen.
                }
                dependencies.reporter.info('Waiting for approval...');
            },
        });
        const accessToken = await getAccessToken(auth);
        if (!accessToken) {
            throw new NotLoggedInError();
        }
        return { auth, accessToken };
    } catch (error) {
        if (signal.aborted) {
            throw new CommandInterruptedError();
        }
        throw error;
    }
}

/**
 * The stored login, or `undefined` when there is none for `organization` or
 * when it must be renewed in the browser.
 */
async function storedLogin(
    auth: AuthOptions,
    organization: string | undefined,
): Promise<ConsoleLogin | undefined> {
    const stored = readAuthStatus(auth);
    if (!stored.loggedIn || (organization && !matchesOrganization(stored.organization, organization))) {
        return undefined;
    }
    try {
        const accessToken = await getAccessToken(auth);
        return accessToken ? { auth, accessToken } : undefined;
    } catch (error) {
        if (
            error instanceof NotLoggedInError ||
            error instanceof SessionRejectedError ||
            error instanceof ReauthenticationRequiredError
        ) {
            return undefined;
        }
        throw error;
    }
}

/** Matches `--organization` the way `vendure auth login` resolves it: an Account identifier or a name. */
function matchesOrganization(organization: StoredOrganization | null | undefined, wanted: string): boolean {
    const value = wanted.toLowerCase();
    return (
        organization?.customerAccountId?.toLowerCase() === value ||
        organization?.name?.trim().toLowerCase() === value
    );
}

function describeOrganization(organization: StoredOrganization): string {
    return organization.name ?? organization.customerAccountId ?? organization.workosOrganizationId;
}

/**
 * What a hook that requested a session receives: the CLI login's access token.
 * The refresh token stays in the login, because it is single-use and a copy
 * that a plugin spends ends the login for every other command.
 */
function hookSession(login: ConsoleLogin): ConsoleSession {
    const expiresAt = readAuthStatus(login.auth).accessTokenExpiresAt;
    return { accessToken: login.accessToken, expiresAt: expiresAt ?? (login.auth.now ?? Date.now)() };
}

async function listProjects(
    endpoints: ConsoleEndpoints,
    login: ConsoleLogin,
    accountName: string,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ConsoleProject[]> {
    let value: unknown;
    try {
        value = await requestWithLogin(
            `${endpoints.apiUrl}${PROJECTS_PATH}`,
            { method: 'GET' },
            login,
            dependencies,
            signal,
        );
    } catch (error) {
        if (error instanceof ConsoleRequestError && error.httpStatus === 403) {
            throw new Error(`Your role in ${accountName} does not allow you to see its projects.`);
        }
        throw error;
    }
    if (!Array.isArray(value)) {
        throw new Error('Console returned a malformed project list.');
    }
    return value
        .map(entry => objectValue(entry, 'Console returned a malformed project list.'))
        .filter(project => project.state === 'active')
        .map(project => ({
            id: uuid(project.id, 'Console returned an invalid project id.'),
            name: nonEmptyString(project.name, 'Console returned an invalid project name.'),
        }));
}

/**
 * The project to link. An organization with one active project links that
 * project. With more, the user chooses, which needs a terminal.
 */
async function chooseProject(
    projects: ConsoleProject[],
    accountName: string,
    endpoints: ConsoleEndpoints,
    dependencies: ConsoleCommandDependencies,
): Promise<ConsoleProject> {
    if (projects.length === 0) {
        throw new Error(
            `${accountName} has no active project. Create one in Vendure Console at ${endpoints.consoleUrl}. ` +
                'You can create it without a plan or trial. Then run vendure console link again.',
        );
    }
    if (projects.length === 1) {
        return projects[0];
    }
    if (dependencies.isNonInteractive()) {
        throw new Error(
            `${accountName} has ${projects.length} projects. Run vendure console link in a terminal to choose one:\n` +
                projects.map(project => `  ${project.name} (${project.id})`).join('\n'),
        );
    }
    const projectId = await dependencies.select(
        `Which project in ${accountName} do you want to link?`,
        projects.map(project => ({ value: project.id, label: project.name })),
    );
    const chosen = projects.find(project => project.id === projectId);
    if (!chosen) {
        throw new CommandInterruptedError();
    }
    return chosen;
}

/** Links the project through Console's `POST /v1/projects/:projectId/link` and returns the manifest. */
async function linkProject(
    endpoints: ConsoleEndpoints,
    login: ConsoleLogin,
    project: ConsoleProject,
    accountName: string,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ProjectLinkManifest> {
    let value: unknown;
    try {
        value = await requestWithLogin(
            `${endpoints.apiUrl}${PROJECTS_PATH}/${encodeURIComponent(project.id)}/link`,
            { method: 'POST' },
            login,
            dependencies,
            signal,
        );
    } catch (error) {
        if (error instanceof ConsoleRequestError && error.httpStatus === 403) {
            throw new Error(`Your role in ${accountName} does not allow you to link ${project.name}.`);
        }
        if (error instanceof ConsoleRequestError && error.httpStatus === 404) {
            throw new Error(`${project.name} is no longer an active project in ${accountName}.`);
        }
        throw error;
    }
    const manifest = parseProjectLinkManifest(value);
    if (manifest.project.id !== project.id) {
        throw new Error('Console returned a Project Link Manifest for a different project.');
    }
    return manifest;
}

/**
 * Sends a request with the CLI login's access token. When Console refuses the
 * token, the login is renewed once and the request is sent again.
 */
async function requestWithLogin(
    url: string,
    init: RequestInit,
    login: ConsoleLogin,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<unknown> {
    const send = () =>
        requestJson(
            url,
            { ...init, headers: { Authorization: `Bearer ${login.accessToken}` } },
            dependencies,
            signal,
        );
    try {
        return await send();
    } catch (error) {
        if (!(error instanceof ConsoleRequestError) || error.httpStatus !== 401) {
            throw error;
        }
    }
    login.accessToken = await refreshAccessToken(login.accessToken, login.auth);
    try {
        return await send();
    } catch (error) {
        if (error instanceof ConsoleRequestError && error.httpStatus === 401) {
            throw new Error(
                'Vendure Console did not accept the CLI login. Run vendure auth login, then try again.',
            );
        }
        throw error;
    }
}

/** Reuses the manifest, reapplies its `.gitignore` rules, and reruns plugin setup. */
async function repair(
    projectRoot: string,
    manifest: ProjectLinkManifest,
    manifestPath: string,
    endpoints: ConsoleEndpoints,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    state: ConsoleCommandState,
): Promise<number> {
    const currentManifest = withConsoleOrigins(manifest, {
        appOrigin: endpoints.consoleUrl,
        apiOrigin: endpoints.apiUrl,
    });
    const upgraded = manifest.console == null;
    if (upgraded) {
        await writeProjectLinkManifestAtomic(projectRoot, currentManifest);
    }
    state.outcome = 'repaired';
    state.manifestPath = manifestPath;
    state.result.data.link = { outcome: 'repaired', manifestPath };
    dependencies.reporter.success(
        `Already linked to ${currentManifest.project.name} in ${currentManifest.account.name}.`,
    );
    dependencies.reporter.info(
        `${upgraded ? 'Updated' : 'Kept'} ${manifestPath}. Run vendure console link --force to link this project to a different Console Project.`,
    );
    reportProjectLinkGitignore(projectRoot, dependencies.reporter);
    if (!(await confirmRepair(currentManifest, options, dependencies))) {
        return 0;
    }
    const session = dependencies.hooks.some(hook => hook.requiresSession)
        ? await repairSession(currentManifest, endpoints, options, dependencies, signal)
        : undefined;

    const code = await runConsoleLinkHooks(
        { projectRoot, manifest: currentManifest, manifestPath, endpoints, outcome: 'repaired', session },
        options,
        dependencies,
        signal,
        state,
    );
    reportCodingAssistantSetup(code, currentManifest, options, dependencies.reporter);
    return code;
}

/**
 * The next step after a link: the docs MCP. Console decides at access time who
 * gets the development workflows, so the CLI only points to the setup. Human
 * output only: the JSON result and `--non-interactive` output keep their shape.
 */
function reportCodingAssistantSetup(
    code: number,
    manifest: ProjectLinkManifest,
    options: ConsoleCommandOptions,
    reporter: ConsoleReporter,
): void {
    if (code !== 0 || options.json || options.nonInteractive) {
        return;
    }
    reporter.info(
        [
            'Next: use Vendure development workflows and patterns through your coding assistant.',
            `  1. Add ${DOCS_MCP_URL} as an MCP server in your coding assistant.`,
            '  2. The first time you use a development tool, the assistant asks you to sign in with Vendure ' +
                `Console. Sign in and select the ${manifest.account.name} Account.`,
            'Linking did not configure or sign in to any coding assistant.',
            `Setup guide: ${CODING_ASSISTANT_GUIDE_URL}`,
        ].join('\n'),
    );
}

/**
 * The session for a repair, which asks Console nothing itself. It is the CLI
 * login for the manifest's account, or the one `--organization` names. When no
 * such login is stored, an interactive run signs in with the device flow. A
 * failed sign-in does not stop the repair: the hooks run without a session and
 * report what they could not do.
 */
async function repairSession(
    manifest: ProjectLinkManifest,
    endpoints: ConsoleEndpoints,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ConsoleSession | undefined> {
    const organization = options.organization?.trim() || manifest.account.id;
    try {
        const login = dependencies.isNonInteractive()
            ? await storedLogin(consoleAuthOptions(endpoints, dependencies, signal), organization)
            : await signIn(endpoints, organization, dependencies, signal);
        if (login) {
            return hookSession(login);
        }
        dependencies.reporter.warn(
            `No CLI login for ${manifest.account.name} is stored on this machine, so plugin setup runs ` +
                'without a Console session. Run vendure console link interactively to sign in.',
        );
    } catch (error) {
        if (signal.aborted || error instanceof CommandInterruptedError) {
            throw new CommandInterruptedError();
        }
        dependencies.reporter.warn(
            `Could not sign in to Vendure Console: ${
                error instanceof Error ? error.message : String(error)
            } Plugin setup runs without a Console session.`,
        );
    }
    return undefined;
}

/**
 * Whether to run plugin setup against a manifest this run did not write.
 *
 * Only asked when a plugin would actually do something, because with no hooks
 * registered a repair reports the link and changes nothing. Non-interactive
 * runs proceed: the backfill this command exists to provide has to work in CI,
 * where the manifest is part of the checked-out source the operator chose to
 * run and there is nobody to ask. `--yes` is the answer given in advance, for
 * repeating a repair in a project whose manifest the developer already trusts.
 *
 * `--force` is not that answer. It links to a different Project, so it never
 * reaches here.
 */
async function confirmRepair(
    manifest: ProjectLinkManifest,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
): Promise<boolean> {
    if (options.yes || dependencies.hooks.length === 0 || dependencies.isNonInteractive()) {
        return true;
    }
    const result = await dependencies.prompt(
        `Run plugin setup for ${manifest.project.name} in ${manifest.account.name}?`,
    );
    if (result === undefined) {
        throw new CommandInterruptedError();
    }
    if (result !== true) {
        dependencies.reporter.info('No plugin setup was run.');
        return false;
    }
    return true;
}

/** What the command resolved, before it is shaped into a per-hook context. */
interface ConsoleLinkHookInputs {
    projectRoot: string;
    manifest: ProjectLinkManifest;
    manifestPath: string;
    endpoints: ConsoleEndpoints;
    outcome: ConsoleLinkOutcome;
    session?: ConsoleSession;
}

/** Runs plugin hooks in registration order and stops after the first failure. */
async function runConsoleLinkHooks(
    inputs: ConsoleLinkHookInputs,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    state: ConsoleCommandState,
): Promise<number> {
    for (const { pluginId, hook, requiresSession } of dependencies.hooks) {
        try {
            await hook(
                createConsoleLinkContext(
                    { ...inputs, session: requiresSession ? inputs.session : undefined },
                    options,
                    dependencies,
                    signal,
                    contribution => {
                        const snapshot = structuredClone(contribution);
                        state.result.data.plugins[pluginId] = snapshot.data;
                        state.result.missingInputs.push(...(snapshot.missingInputs ?? []));
                        state.result.nextSteps.push(...(snapshot.nextSteps ?? []));
                        if (snapshot.outcome !== 'configured') {
                            if (!state.setupIncomplete || state.result.outcome !== 'failed') {
                                state.result.outcome = snapshot.outcome;
                            }
                            state.setupIncomplete = true;
                            dependencies.reporter.error(
                                `The ${pluginId} plugin setup is ${snapshot.outcome}.`,
                            );
                            for (const step of snapshot.nextSteps ?? []) dependencies.reporter.info(step);
                        }
                    },
                ),
            );
            if (state.setupIncomplete) {
                return 1;
            }
        } catch (error) {
            // Ctrl-C during a hook is an interrupt whatever the hook threw, so
            // it is reported by the one handler that knows the exit code.
            if (signal.aborted || error instanceof CommandInterruptedError) {
                throw new CommandInterruptedError();
            }
            // The host owns this one, and it carries the exit code with it.
            // Reported whatever the code, because a hook that stops the run at
            // zero still stops every hook after it, and the exit code alone
            // does not tell the reader that some setup never ran.
            if (error instanceof CliCommandExit) {
                const stopped = `The ${pluginId} plugin stopped the run after linking.`;
                // The level follows the code the process will actually exit
                // with, so a log that reads as a failure matches one.
                if (error.exitCode === 0) {
                    dependencies.reporter.warn(stopped);
                } else {
                    dependencies.reporter.error(stopped);
                }
                dependencies.reporter.warn(linkUnfinished(inputs.outcome, inputs.manifestPath));
                throw error;
            }
            const rawDetail = error instanceof Error ? error.message : String(error);
            const detail = options.json ? 'Setup did not finish.' : rawDetail;
            state.result.outcome = 'failed';
            state.result.nextSteps.push(`Rerun vendure console link to finish setup for ${pluginId}.`);
            dependencies.reporter.error(`The ${pluginId} plugin failed after linking: ${detail}`);
            dependencies.reporter.warn(linkUnfinished(inputs.outcome, inputs.manifestPath));
            return 1;
        }
    }
    return 0;
}

/** Builds an isolated context for one hook. */
function createConsoleLinkContext(
    inputs: ConsoleLinkHookInputs,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    contributeResult: (contribution: ConsoleLinkResultContribution) => void,
): ConsoleLinkContext {
    const isNonInteractive = dependencies.isNonInteractive();
    return {
        projectRoot: inputs.projectRoot,
        manifest: structuredClone(inputs.manifest),
        manifestPath: inputs.manifestPath,
        endpoints: {
            consoleUrl: inputs.endpoints.consoleUrl,
            apiUrl: inputs.endpoints.apiUrl,
            official: officialConsoleEnvironment(inputs.endpoints),
        },
        outcome: inputs.outcome,
        session: inputs.session ? structuredClone(inputs.session) : undefined,
        signal,
        reporter: dependencies.reporter,
        outputMode: options.json ? 'json' : 'human',
        options: freezeOptions(structuredClone({ ...options })),
        contributeResult,
        confirm: message => confirmForHook(message, isNonInteractive, dependencies.prompt),
        isNonInteractive,
        force: options.force === true,
    };
}

function freezeOptions<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeOptions(child);
        Object.freeze(value);
    }
    return value;
}

/**
 * Asks the hook's yes/no question, or refuses when there is nobody to answer.
 *
 * Without this the question goes into a pipe and the command waits for a reply
 * that cannot come. `isNonInteractive` is on the context so that a hook takes
 * the other path before it reaches here; this is what happens when one does not.
 */
function confirmForHook(
    message: string,
    isNonInteractive: boolean,
    prompt: ConsoleCommandDependencies['prompt'],
): Promise<boolean | undefined> {
    if (isNonInteractive) {
        return Promise.reject(
            new Error(
                'Cannot ask for confirmation in a non-interactive environment. ' +
                    'Check context.isNonInteractive before calling context.confirm.',
            ),
        );
    }
    return prompt(message);
}

function linkUnfinished(outcome: ConsoleLinkOutcome, manifestPath: string): string {
    const survived =
        outcome === 'linked'
            ? `The link succeeded and ${manifestPath} is in place.`
            : `The existing link at ${manifestPath} was not changed.`;
    return `${survived} The setup that runs after linking did not finish.`;
}

/** Reports the Project Link only. `vendure auth status` reports the login. */
function status(projectRoot: string, env: NodeJS.ProcessEnv, reporter: ConsoleReporter): number {
    const result = readProjectLinkManifest(projectRoot);
    if (result.kind === 'missing') {
        reporter.info(`Project: Not linked\nManifest: ${result.path}\n${LOGIN_STATUS_HINT}`);
        return 0;
    }
    if (result.kind === 'invalid') {
        reporter.error(`Invalid Project Link Manifest at ${result.path}: ${result.reason}`);
        return 1;
    }

    const { manifest } = result;
    const endpoints = resolveConsoleEndpoints(env, manifest.console);
    reporter.info(
        [
            `Account: ${manifest.account.name} (${manifest.account.id})`,
            `Project: ${manifest.project.name} (${manifest.project.id})`,
            `Schema version: ${manifest.schemaVersion}`,
            `Protocol version: ${manifest.link.protocolVersion}`,
            `Link: ${manifest.link.id}`,
            `Console: ${endpoints.consoleUrl}`,
            `Console API: ${endpoints.apiUrl}`,
            `Manifest: ${result.path}`,
            LOGIN_STATUS_HINT,
        ].join('\n'),
    );
    return 0;
}

const LOGIN_STATUS_HINT = 'Login: run vendure auth status';

function reportProjectLinkGitignore(projectRoot: string, reporter: ConsoleReporter): void {
    const gitignore = ensureProjectLinkGitignore(projectRoot);
    if (gitignore.kind === 'created' || gitignore.kind === 'updated') {
        reporter.info(
            `Updated ${gitignore.path} so ${PROJECT_LINK_MANIFEST_RELATIVE_PATH} can be committed and other .vendure files stay ignored.`,
        );
        return;
    }
    if (gitignore.kind === 'failed') {
        reporter.warn(
            `Could not update ${gitignore.path}: ${gitignore.reason}. Commit ${PROJECT_LINK_MANIFEST_RELATIVE_PATH} and ignore other .vendure files.`,
        );
        return;
    }
    reporter.info(
        'This file contains identity metadata only and is safe to commit. Other .vendure files stay ignored because they may contain machine-local secrets.',
    );
}

async function unlink(
    projectRoot: string,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
): Promise<number> {
    const existing = readProjectLinkManifest(projectRoot);
    if (existing.kind === 'missing') {
        dependencies.reporter.info(`Project is not linked. No manifest exists at ${existing.path}.`);
        return 0;
    }

    const confirmed = await confirmManifestChange('remove', existing, options, dependencies);
    if (confirmed !== 'confirmed') {
        return confirmed === 'cancelled' ? 0 : 1;
    }
    removeProjectLinkManifest(projectRoot);
    dependencies.reporter.success(`Removed local Project Link Manifest at ${existing.path}.`);
    dependencies.reporter.info(
        'The Console Project, its Project Link and your CLI login were not changed. Run vendure auth logout to sign out.',
    );
    return 0;
}

async function confirmManifestChange(
    action: 'replace' | 'remove',
    existing: Exclude<ManifestReadResult, { kind: 'missing' }>,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
): Promise<'confirmed' | 'cancelled' | 'required'> {
    if (options.force || options.yes) {
        return 'confirmed';
    }
    if (dependencies.isNonInteractive()) {
        dependencies.reporter.error(
            `Refusing to ${action} ${existing.path} without confirmation in a non-interactive environment.`,
        );
        dependencies.reporter.info(
            `Run vendure console ${action === 'replace' ? 'link' : 'unlink'} --force to confirm this action.`,
        );
        return 'required';
    }

    const detail =
        existing.kind === 'valid'
            ? `${existing.manifest.project.name} in ${existing.manifest.account.name}`
            : `the invalid manifest at ${existing.path}`;
    const result = await dependencies.prompt(
        `${action === 'replace' ? 'Replace' : 'Remove'} the local link for ${detail}?`,
    );
    if (result === undefined) {
        throw new CommandInterruptedError();
    }
    if (result !== true) {
        dependencies.reporter.info('No Project Link Manifest changes were made.');
        return 'cancelled';
    }
    return 'confirmed';
}

async function requestJson(
    url: string,
    init: RequestInit,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<unknown> {
    throwIfAborted(signal);
    const requestController = new AbortController();
    let timedOut = false;
    const onAbort = () => requestController.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        requestController.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        const response = await dependencies.fetch(url, {
            ...init,
            redirect: 'error',
            signal: requestController.signal,
        });
        if (!response.ok) {
            throw new ConsoleRequestError(
                `Vendure Console API request failed with HTTP ${response.status}.`,
                response.status,
            );
        }
        return await readJsonBody(response, requestController.signal);
    } catch (error) {
        if (error instanceof ConsoleRequestError) {
            throw error;
        }
        if (signal.aborted) {
            throw new CommandInterruptedError();
        }
        throw new ConsoleRequestError(
            timedOut
                ? 'The Vendure Console API request timed out. Check the configured endpoint and try again.'
                : 'Could not reach the Vendure Console API. Check your connection and configured endpoint.',
        );
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
    }
}

async function readJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
    const text = await readCappedText(response, signal);
    try {
        return JSON.parse(text);
    } catch {
        throw new ConsoleRequestError('Vendure Console API returned malformed JSON.');
    }
}

async function readCappedText(response: Response, signal: AbortSignal): Promise<string> {
    if (!response.body) {
        const text = await abortable(response.text(), signal);
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
            throw new ConsoleRequestError('Vendure Console API response exceeded the maximum size.');
        }
        return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let received = 0;
    try {
        while (true) {
            if (signal.aborted) {
                throw abortError();
            }
            const { done, value } = await abortable(reader.read(), signal);
            if (done) {
                break;
            }
            received += value.byteLength;
            if (received > MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new ConsoleRequestError('Vendure Console API response exceeded the maximum size.');
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return chunks.join('');
    } finally {
        reader.releaseLock();
    }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

function abortError(): DOMException {
    return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new CommandInterruptedError();
    }
}
