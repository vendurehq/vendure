import { confirm, isCancel, log } from '@clack/prompts';
import { ChildProcess, spawn } from 'node:child_process';

import { CliCommandExit } from '../../shared/cli-command-exit';
import { isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';

import {
    ConsoleLinkContext,
    ConsoleLinkOutcome,
    ConsoleReporter,
    RegisteredConsoleLinkHook,
    getConsoleLinkHooks,
} from './console-link-hook';
import { DEFAULT_CONSOLE_API_URL, DEFAULT_CONSOLE_URL, officialConsoleEnvironment } from './console-origins';
import { ensureProjectLinkGitignore } from './project-link-gitignore';
import {
    ManifestReadResult,
    PROJECT_LINK_MANIFEST_RELATIVE_PATH,
    ProjectLinkManifest,
    parseProjectLinkManifest,
    readProjectLinkManifest,
    removeProjectLinkManifest,
    resolveProjectRoot,
    writeProjectLinkManifestAtomic,
} from './project-link-manifest';
import { nonEmptyString, objectValue, uuid } from './project-link-validation';

const PROJECT_LINKS_PATH = '/v1/project-links';
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RETRY_DELAY_MS = 2_000;

export interface ConsoleCommandOptions {
    allowCustomConsole?: boolean;
    project?: string;
    force?: boolean;
    /** Answers the repair confirmation in advance. See {@link confirmRepair}. */
    yes?: boolean;
}

export type { ConsoleReporter };

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
    reporter: ConsoleReporter;
    signal?: AbortSignal;
    sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface ConsoleEndpoints {
    apiUrl: string;
    consoleUrl: string;
}

interface ProjectLinkRequest {
    id: string;
    expiresAt: number;
    pollingSecret: string;
    verificationUrl: string;
}

interface ProjectLinkPollResult {
    state: 'pending' | 'approved' | 'denied' | 'expired';
    expiresAt: number;
    manifest?: ProjectLinkManifest;
}

class ConsoleRequestError extends Error {
    constructor(
        message: string,
        readonly transient: boolean,
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
        hooks: getConsoleLinkHooks(),
        isNonInteractive: () => isNonInteractiveEnvironment(),
        now: () => Date.now(),
        openUrl: openUrlInBrowser,
        prompt: async message => {
            const result = await withInteractiveTimeout(() => confirm({ message }), {
                examples: [
                    'vendure console link --allow-custom-console',
                    'vendure console link --force',
                    'vendure console unlink --force',
                ],
                helpCommands: ['vendure console --help'],
            });
            return isCancel(result) ? undefined : result;
        },
        reporter: defaultReporter,
        sleep: abortableSleep,
    };
}

export async function consoleCommand(
    action?: string,
    options: ConsoleCommandOptions = {},
    dependencies: Partial<ConsoleCommandDependencies> = {},
): Promise<number> {
    const resolvedDependencies = { ...createDefaultDependencies(), ...dependencies };
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

    const state: ConsoleCommandState = {};
    try {
        return await runConsoleCommand(action, options, resolvedDependencies, abortController.signal, state);
    } catch (error) {
        if (interruptedExitCode !== undefined || error instanceof CommandInterruptedError) {
            // A process signal wins so SIGTERM retains exit code 143. Prompt cancellation and external aborts use 130.
            const exitCode = interruptedExitCode ?? 130;
            resolvedDependencies.reporter.warn(
                // Once the manifest is written the link is done and cannot be
                // taken back, so saying nothing changed would be untrue. An
                // interrupt after that point stopped a hook, not the link.
                state.manifestPath && state.outcome
                    ? `Console command interrupted. ${linkUnfinished(state.outcome, state.manifestPath)}`
                    : 'Console command interrupted. No Project Link Manifest was changed.',
            );
            return exitCode;
        }
        if (error instanceof CliCommandExit) {
            throw error;
        }
        resolvedDependencies.reporter.error(error instanceof Error ? error.message : String(error));
        return 1;
    } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        externalSignal?.removeEventListener('abort', onExternalAbort);
    }
}

/**
 * What the run has already done, for messages that would otherwise overstate
 * how much an interrupt took back.
 */
interface ConsoleCommandState {
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

    const projectRoot = resolveProjectRoot(dependencies.cwd, options.project);
    if (normalizedAction === 'status') {
        return status(projectRoot, dependencies.reporter);
    }
    if (normalizedAction === 'unlink') {
        return unlink(projectRoot, options, dependencies);
    }
    return link(projectRoot, options, dependencies, signal, state);
}

export function resolveConsoleEndpoints(env: NodeJS.ProcessEnv): ConsoleEndpoints {
    const consoleOverride = env.VENDURE_CONSOLE_LINK_URL?.trim() || undefined;
    const apiOverride = env.VENDURE_CONSOLE_LINK_API_URL?.trim() || undefined;
    if (Boolean(consoleOverride) !== Boolean(apiOverride)) {
        throw new Error(
            'Set both VENDURE_CONSOLE_LINK_URL and VENDURE_CONSOLE_LINK_API_URL, or unset both to use production.',
        );
    }
    const consoleUrl = baseUrl(consoleOverride ?? DEFAULT_CONSOLE_URL, 'VENDURE_CONSOLE_LINK_URL');
    const apiUrl = baseUrl(apiOverride ?? DEFAULT_CONSOLE_API_URL, 'VENDURE_CONSOLE_LINK_API_URL');
    if ((consoleUrl === DEFAULT_CONSOLE_URL) !== (apiUrl === DEFAULT_CONSOLE_API_URL)) {
        throw new Error('The production Console and API origins must be used together.');
    }
    return { consoleUrl, apiUrl };
}

async function link(
    projectRoot: string,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
    state: ConsoleCommandState,
): Promise<number> {
    const endpoints = resolveConsoleEndpoints(dependencies.env);
    const existing = readProjectLinkManifest(projectRoot);
    if (existing.kind === 'valid' && !options.force) {
        // `vendure console link` establishes a link and repairs one, rather
        // than establishing one and leaving repair to somewhere else. A repeat
        // in a project that is already linked runs the setup again against the
        // manifest on disk. Minting a second Project Link would abandon the
        // first in Console for a problem that is local, and it would put the
        // choice of Project back in front of someone who only wanted their
        // credentials back.
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
    if (existing.kind !== 'missing') {
        const confirmed = await confirmManifestChange('replace', existing, options, dependencies);
        if (confirmed !== 'confirmed') {
            return confirmed === 'cancelled' ? 0 : 1;
        }
    }

    const endpointApproval = await confirmCustomConsoleEndpoints(endpoints, options, dependencies);
    if (endpointApproval !== 'confirmed') {
        return endpointApproval === 'cancelled' ? 0 : 1;
    }
    const request = await createProjectLink(endpoints, dependencies, signal);
    dependencies.reporter.info('Approve the Project link in your browser.');
    try {
        await dependencies.openUrl(request.verificationUrl);
    } catch {
        dependencies.reporter.warn('Could not open the browser automatically. Open this URL to continue:');
        dependencies.reporter.url(request.verificationUrl);
    }

    const manifest = await waitForApproval(request, endpoints, dependencies, signal);
    throwIfAborted(signal);
    const manifestPath = await writeProjectLinkManifestAtomic(projectRoot, manifest);
    state.outcome = 'linked';
    state.manifestPath = manifestPath;
    dependencies.reporter.success(`Linked ${manifest.project.name} to ${manifest.account.name}.`);
    dependencies.reporter.info(`Wrote ${manifestPath}`);
    reportProjectLinkGitignore(projectRoot, dependencies.reporter);

    return runConsoleLinkHooks(
        { projectRoot, manifest, manifestPath, endpoints, outcome: 'linked' },
        options,
        dependencies,
        signal,
    );
}

/**
 * Runs the setup that follows a link for a project that is already linked,
 * against the manifest already on disk.
 *
 * Nothing is asked of Console and the manifest is not rewritten: the Project
 * Link it names is still the one in force. The `.gitignore` rules are applied
 * as they are after a link, so a checkout that never had them gets them. That
 * is the one write this path makes, and it happens whether or not the plugin
 * setup below is approved.
 *
 * The custom-endpoint gate runs all the same, because a hook is given these
 * origins and may talk to them.
 *
 * A manifest is meant to be committed, so an already-linked project may be one
 * the developer has just cloned, naming an account and a project they have
 * never seen. Running hooks against it without asking would hand a plugin
 * somebody else's identifiers. So when there are hooks to run and a terminal
 * to ask, the project and account are named and confirmed first.
 */
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
    const endpointApproval = await confirmCustomConsoleEndpoints(endpoints, options, dependencies);
    if (endpointApproval !== 'confirmed') {
        return endpointApproval === 'cancelled' ? 0 : 1;
    }
    dependencies.reporter.success(`Already linked to ${manifest.project.name} in ${manifest.account.name}.`);
    dependencies.reporter.info(
        `Kept ${manifestPath}. Run vendure console link --force to link this project to a different Console Project.`,
    );
    reportProjectLinkGitignore(projectRoot, dependencies.reporter);
    if (!(await confirmRepair(manifest, options, dependencies))) {
        return 0;
    }
    state.outcome = 'repaired';
    state.manifestPath = manifestPath;

    return runConsoleLinkHooks(
        { projectRoot, manifest, manifestPath, endpoints, outcome: 'repaired' },
        options,
        dependencies,
        signal,
    );
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
        dependencies.reporter.info('No plugin setup was run. The Project Link Manifest is unchanged.');
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
}

/**
 * Runs the plugin hooks, in the order the plugins were listed.
 *
 * The manifest is on disk by this point and is not removed by a hook that
 * fails, so a failure is reported as what it is: the link is in place and the
 * work after it did not finish. Rolling the manifest back would be worse,
 * because the Project Link exists in Console either way.
 *
 * The first failure stops the rest. A later hook would be setting up a project
 * whose earlier setup is known to be incomplete.
 */
async function runConsoleLinkHooks(
    inputs: ConsoleLinkHookInputs,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<number> {
    for (const { pluginId, hook } of dependencies.hooks) {
        try {
            await hook(createConsoleLinkContext(inputs, options, dependencies, signal));
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
                dependencies.reporter.error(`The ${pluginId} plugin stopped the run after linking.`);
                dependencies.reporter.warn(linkUnfinished(inputs.outcome, inputs.manifestPath));
                throw error;
            }
            const detail = error instanceof Error ? error.message : String(error);
            dependencies.reporter.error(`The ${pluginId} plugin failed after linking: ${detail}`);
            dependencies.reporter.warn(linkUnfinished(inputs.outcome, inputs.manifestPath));
            return 1;
        }
    }
    return 0;
}

/**
 * Builds a context for one hook.
 *
 * A fresh one each time, rather than one shared by all of them. Hooks run in a
 * configured order, and `endpoints.official` is the fact a hook holding a
 * credential checks before it sends anything. A shared object would let the
 * plugin listed first decide what the plugin listed second sees.
 *
 * `reporter` and `signal` are deliberately the same objects in every context.
 */
function createConsoleLinkContext(
    inputs: ConsoleLinkHookInputs,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): ConsoleLinkContext {
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
        signal,
        reporter: dependencies.reporter,
        confirm: message => confirmForHook(message, dependencies),
        isNonInteractive: dependencies.isNonInteractive(),
        force: options.force === true,
    };
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
    dependencies: ConsoleCommandDependencies,
): Promise<boolean | undefined> {
    if (dependencies.isNonInteractive()) {
        return Promise.reject(
            new Error(
                'Cannot ask for confirmation in a non-interactive environment. ' +
                    'Check context.isNonInteractive before calling context.confirm.',
            ),
        );
    }
    return dependencies.prompt(message);
}

function linkUnfinished(outcome: ConsoleLinkOutcome, manifestPath: string): string {
    const survived =
        outcome === 'linked'
            ? `The link succeeded and ${manifestPath} is in place.`
            : `The existing link at ${manifestPath} was not changed.`;
    return `${survived} The setup that runs after linking did not finish.`;
}

async function confirmCustomConsoleEndpoints(
    endpoints: ConsoleEndpoints,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
): Promise<'confirmed' | 'cancelled' | 'required'> {
    if (!usesCustomRemoteEndpoints(endpoints) || options.allowCustomConsole) {
        return 'confirmed';
    }
    if (dependencies.isNonInteractive()) {
        dependencies.reporter.error(
            'Refusing to use custom remote Console endpoints without explicit approval in a non-interactive environment.',
        );
        dependencies.reporter.info(
            'Run vendure console link --allow-custom-console to approve these endpoints.',
        );
        return 'required';
    }
    const result = await dependencies.prompt(
        [
            'Link through these custom Console endpoints?',
            `Console: ${endpoints.consoleUrl}`,
            `API: ${endpoints.apiUrl}`,
            'The API controls the Project Link Manifest written to this repository.',
        ].join('\n'),
    );
    if (result === undefined) {
        throw new CommandInterruptedError();
    }
    if (!result) {
        dependencies.reporter.info('No Console requests or Project Link Manifest changes were made.');
        return 'cancelled';
    }
    return 'confirmed';
}

function status(projectRoot: string, reporter: ConsoleReporter): number {
    const result = readProjectLinkManifest(projectRoot);
    if (result.kind === 'missing') {
        reporter.info(`Project: Not linked\nManifest: ${result.path}\nAuthentication: Not stored locally`);
        reporter.info(
            'Console authorization happens in the browser; the CLI stores no Console access token.',
        );
        return 0;
    }
    if (result.kind === 'invalid') {
        reporter.error(`Invalid Project Link Manifest at ${result.path}: ${result.reason}`);
        return 1;
    }

    const { manifest } = result;
    reporter.info(
        [
            `Account: ${manifest.account.name} (${manifest.account.id})`,
            `Project: ${manifest.project.name} (${manifest.project.id})`,
            `Schema version: ${manifest.schemaVersion}`,
            `Protocol version: ${manifest.link.protocolVersion}`,
            `Link: ${manifest.link.id}`,
            `Manifest: ${result.path}`,
            'Authentication: Not stored locally (browser authorization)',
        ].join('\n'),
    );
    return 0;
}

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
    dependencies.reporter.info('The Console Project and server-side link request were not changed.');
    return 0;
}

async function confirmManifestChange(
    action: 'replace' | 'remove',
    existing: Exclude<ManifestReadResult, { kind: 'missing' }>,
    options: ConsoleCommandOptions,
    dependencies: ConsoleCommandDependencies,
): Promise<'confirmed' | 'cancelled' | 'required'> {
    if (options.force) {
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

async function createProjectLink(
    endpoints: ConsoleEndpoints,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ProjectLinkRequest> {
    const value = await requestJson(
        `${endpoints.apiUrl}${PROJECT_LINKS_PATH}`,
        { method: 'POST' },
        dependencies,
        signal,
    );
    const object = objectValue(value, 'Console returned a malformed project-link response.');
    const id = uuid(object.id, 'Console returned an invalid project-link id.');
    if (object.state !== 'pending' || object.protocolVersion !== 1) {
        throw new Error('Console returned an unsupported Project Link request.');
    }
    const expiresAt = timestamp(object.expiresAt, 'project-link expiry');
    const pollingSecret = nonEmptyString(object.pollingSecret, 'Console returned an invalid polling secret.');
    const verificationPath = nonEmptyString(
        object.verificationPath,
        'Console returned an invalid verification path.',
    );
    if (!verificationPath.startsWith('/') || verificationPath.startsWith('//')) {
        throw new Error('Console returned an invalid verification path.');
    }
    const verificationUrl = new URL(verificationPath, `${endpoints.consoleUrl}/`).toString();
    if (new URL(verificationUrl).origin !== new URL(endpoints.consoleUrl).origin) {
        throw new Error('Console returned a verification URL for an unexpected origin.');
    }
    if (verificationUrl.includes(pollingSecret)) {
        throw new Error('Console returned an unsafe verification URL.');
    }
    return { id, expiresAt, pollingSecret, verificationUrl };
}

async function waitForApproval(
    request: ProjectLinkRequest,
    endpoints: ConsoleEndpoints,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ProjectLinkManifest> {
    let expiresAt = request.expiresAt;
    while (true) {
        throwIfAborted(signal);
        if (dependencies.now() >= expiresAt) {
            throw new Error('The Project Link request expired. Run vendure console link again.');
        }

        const result = await pollWithRetry(request, expiresAt, endpoints, dependencies, signal);
        expiresAt = result.expiresAt;
        if (result.state === 'approved') {
            if (!result.manifest) {
                throw new Error('Console approved the request without returning a Project Link Manifest.');
            }
            return result.manifest;
        }
        if (result.state === 'denied') {
            throw new Error('The Project Link request was denied in Console.');
        }
        if (result.state === 'expired' || dependencies.now() >= result.expiresAt) {
            throw new Error('The Project Link request expired. Run vendure console link again.');
        }
        await dependencies.sleep(POLL_INTERVAL_MS, signal);
    }
}

async function pollWithRetry(
    request: ProjectLinkRequest,
    expiresAt: number,
    endpoints: ConsoleEndpoints,
    dependencies: ConsoleCommandDependencies,
    signal: AbortSignal,
): Promise<ProjectLinkPollResult> {
    let attempt = 0;
    while (true) {
        if (dependencies.now() >= expiresAt) {
            throw new Error('The Project Link request expired. Run vendure console link again.');
        }
        try {
            const value = await requestJson(
                `${endpoints.apiUrl}${PROJECT_LINKS_PATH}/${encodeURIComponent(request.id)}/poll`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pollingSecret: request.pollingSecret }),
                },
                dependencies,
                signal,
            );
            return parsePollResult(value, request.id);
        } catch (error) {
            if (!(error instanceof ConsoleRequestError) || !error.transient) {
                throw error;
            }
            const remainingMs = expiresAt - dependencies.now();
            if (remainingMs <= 0) {
                throw new Error('The Project Link request expired. Run vendure console link again.');
            }
            await dependencies.sleep(Math.min(retryDelay(attempt), remainingMs), signal);
            attempt++;
        }
    }
}

function retryDelay(attempt: number): number {
    return Math.min(attempt === 0 ? 500 : attempt * 1_000, MAX_RETRY_DELAY_MS);
}

function parsePollResult(value: unknown, expectedLinkId: string): ProjectLinkPollResult {
    const record = objectValue(value, 'Console returned a malformed Project Link polling response.');
    const state = record.state;
    if (typeof state !== 'string' || !['pending', 'approved', 'denied', 'expired'].includes(state)) {
        throw new Error('Console returned an unknown Project Link state.');
    }
    const result: ProjectLinkPollResult = {
        state: state as ProjectLinkPollResult['state'],
        expiresAt: timestamp(record.expiresAt, 'project-link expiry'),
    };
    if (state === 'approved') {
        result.manifest = parseProjectLinkManifest(record.manifest, expectedLinkId);
    }
    return result;
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
                isTransientHttpStatus(response.status),
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
            true,
        );
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
    }
}

function isTransientHttpStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
}

async function readJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
    const text = await readCappedText(response, signal);
    try {
        return JSON.parse(text);
    } catch {
        throw new ConsoleRequestError('Vendure Console API returned malformed JSON.', false);
    }
}

async function readCappedText(response: Response, signal: AbortSignal): Promise<string> {
    if (!response.body) {
        const text = await abortable(response.text(), signal);
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
            throw new ConsoleRequestError('Vendure Console API response exceeded the maximum size.', false);
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
                throw new ConsoleRequestError(
                    'Vendure Console API response exceeded the maximum size.',
                    false,
                );
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

function baseUrl(value: string, label: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(`${label} must be an absolute HTTP or HTTPS URL without credentials.`);
    }
    if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error(`${label} must contain only an origin without a path, query, or fragment.`);
    }
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
        throw new Error(`${label} must use HTTPS unless it is a loopback URL.`);
    }
    return url.origin;
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Whether these origins are a remote Console that is not Vendure's.
 *
 * Both official deployments pass, not only production. Calling the official
 * staging Console "custom" and then reporting it to a hook as official said
 * two different things about one pair, and the prompt was the one that was
 * wrong. A loopback pair still passes, for development and tests.
 */
function usesCustomRemoteEndpoints(endpoints: ConsoleEndpoints): boolean {
    if (officialConsoleEnvironment(endpoints) !== undefined) {
        return false;
    }
    return ![endpoints.consoleUrl, endpoints.apiUrl].every(value =>
        isLoopbackHostname(new URL(value).hostname),
    );
}

function timestamp(value: unknown, label: string): number {
    if (typeof value !== 'string') {
        throw new Error(`Console returned an invalid ${label}.`);
    }
    const result = Date.parse(value);
    if (!Number.isFinite(result)) {
        throw new Error(`Console returned an invalid ${label}.`);
    }
    return result;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new CommandInterruptedError();
    }
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new CommandInterruptedError());
            return;
        }
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(new CommandInterruptedError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

function openUrlInBrowser(url: string): Promise<void> {
    // explorer.exe drops URL query strings, so Windows must go through the url.dll protocol handler.
    const isWindows = process.platform === 'win32';
    const command = process.platform === 'darwin' ? 'open' : isWindows ? 'rundll32' : 'xdg-open';
    const args = isWindows ? ['url.dll,FileProtocolHandler', url] : [url];
    return new Promise((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawn(command, args, { detached: true, stdio: 'ignore' });
        } catch (error) {
            reject(error);
            return;
        }
        child.once('error', reject);
        child.once('spawn', () => {
            child.removeListener('error', reject);
            child.unref();
            resolve();
        });
    });
}
