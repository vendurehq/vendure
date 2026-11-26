import {
    CommandContext,
    CommandErrorDefinition,
    CommandNeed,
    ErrorResult,
    fail,
    incomplete,
    IncompleteResult,
    isErrorResult,
} from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

import { authEnvironment } from '../../auth/startup-environment.js';
import { hostErrors } from '../../command-host/host-errors.js';
import { getPluginExtensions, getPluginProjectRoot } from '../../shared/plugin-extensions.js';
import { findProjectDirectoryHints } from '../../utilities/monorepo-utils.js';

import { ConsoleLinkHookRegistration, RegisteredConsoleLinkHook } from './console-link-hook.js';
import { ConsoleReporter } from './console-reporter.js';
import { consoleErrors } from './console.errors.js';
import {
    ConsoleChangePreview,
    ConsoleCommandDependencies,
    ConsoleCommandOptions,
    describeConsoleError,
    previewConsoleChange,
} from './console.js';
import { openConsoleBrowser } from './open-browser.js';
import { resolveProjectRoot } from './project-link-manifest.js';

/** A reporter that says nothing, for the lookups of a preview: the run reports what they find. */
export const silentReporter: ConsoleReporter = {
    error: () => undefined,
    info: () => undefined,
    success: () => undefined,
    warn: () => undefined,
    url: () => undefined,
};

/** The `afterConsoleLink` hooks of the loaded CLI plugins. */
export function consoleLinkHooks(): RegisteredConsoleLinkHook[] {
    return getPluginExtensions<ConsoleLinkHookRegistration>('afterConsoleLink').map(
        ({ pluginId, extension }) =>
            typeof extension === 'function'
                ? { pluginId, hook: extension, requiresSession: false }
                : { pluginId, hook: extension.hook, requiresSession: true },
    );
}

/**
 * The dependencies of the `vendure console` engine for a run on the command host. Messages become
 * notices, a URL a hook reports is passed on as output, and without `ctx.ask` nobody is asked.
 * `errors` collects what the engine reported as an error, for the coded error of a failed run.
 */
export function consoleDependencies(
    ctx: CommandContext,
    hooks: RegisteredConsoleLinkHook[] = [],
): { dependencies: ConsoleCommandDependencies; errors: string[] } {
    const errors: string[] = [];
    const { ask } = ctx;
    const dependencies: ConsoleCommandDependencies = {
        cwd: ctx.cwd,
        // The auth variables as the CLI started with them, never as a project's `.env` set them.
        env: authEnvironment(),
        fetch: globalThis.fetch,
        hooks,
        isNonInteractive: () => !ask,
        now: () => Date.now(),
        openUrl: openConsoleBrowser,
        prompt: message => (ask ? ask.confirm(message) : Promise.resolve(undefined)),
        select: (message, choices) => (ask ? ask.select(message, choices) : Promise.resolve(undefined)),
        reporter: {
            // Reported once the run knows its result, by {@link reportErrors}, so the message that
            // becomes the coded error is not also a notice.
            error: message => {
                errors.push(message);
            },
            warn: message => ctx.notice('warning', message),
            info: message => ctx.notice('info', message),
            success: message => ctx.notice('info', message),
            url: value => ctx.output(`${value}\n`),
        },
        // Nobody reads raw errors when nobody is asked: an agent, a script or CI.
        outputMode: ask ? 'human' : 'json',
        signal: ctx.signal,
    };
    return { dependencies, errors };
}

/**
 * `--project` names a Console Project. A value that is a Vendure project directory is the
 * `--project <dir>` of earlier versions, which is `--dir` now. With `--dir` given, the caller has
 * already chosen the directory, so `--project` is the Console Project whatever its name.
 */
export function projectIsDirectory(
    { project, dir, organization }: { project?: string; dir?: string; organization?: string },
    cwd: string,
): ErrorResult | undefined {
    const value = project?.trim();
    if (!value || dir?.trim()) {
        return undefined;
    }
    // Only a Vendure project directory, which is what `--project` named in 3.x. A slug that happens
    // to match another directory, such as `storefront` in a monorepo, is still a slug.
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(cwd, value, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        } | null;
        if (packageJson?.dependencies?.['@vendure/core'] || packageJson?.devDependencies?.['@vendure/core']) {
            return fail(consoleErrors.projectIsDirectory, {
                project: value,
                ...(organization ? { organization } : {}),
            });
        }
    } catch {
        // Not a directory with a package.json, so it is an id or a slug.
    }
    return undefined;
}

/**
 * The Vendure project the command works on, or the coded error that says why there is none, with a
 * fix for each project directory found nearby.
 */
export function resolveConsoleProject(
    command: string[],
    cwd: string,
    dir: string | undefined,
    /** The rest of the caller's input, which each fix keeps. */
    input: Record<string, unknown> = {},
): { projectRoot: string } | { error: ErrorResult } {
    try {
        return { projectRoot: resolveProjectRoot(cwd, dir) };
    } catch (error) {
        let candidates: string[] = [];
        try {
            candidates = dir ? [] : findProjectDirectoryHints(cwd);
        } catch {
            // The hints only add fixes.
        }
        return {
            error: fail(consoleErrors.projectNotFound, {
                message: error instanceof Error ? error.message : String(error),
                command,
                candidates,
                input,
            }),
        };
    }
}

/**
 * The preview `plan()` computed for a run, by its context. The host passes the same context to
 * `plan()` and `run()`, and asks for the consents of that preview in between, so a run works from
 * the preview the caller consented to rather than from a second lookup that could differ.
 *
 * This depends on the host passing `run()` the very context object it passed `plan()`, which a
 * spec of the host asserts. It goes away once the host passes the consents it was given to `run()`.
 */
const plannedPreviews = new WeakMap<CommandContext, ConsoleChangePreview>();

/** Computes the preview for `plan()`, and records it for the run with the same context. */
export async function planConsoleChange(
    action: 'link' | 'unlink',
    options: ConsoleCommandOptions,
    ctx: CommandContext,
): Promise<ConsoleChangePreview> {
    const { dependencies } = consoleDependencies(ctx);
    const preview = await previewConsoleChange(action, options, {
        ...dependencies,
        reporter: silentReporter,
    });
    plannedPreviews.set(ctx, preview);
    return preview;
}

/**
 * The preview a run works from: the one `plan()` recorded, whose consents the host asked for.
 * Without one, nobody was asked, so a change that needs a consent is refused. A failed preview is
 * reported, never taken for one that needs no consent: a need without a person, and otherwise the
 * command's coded error.
 */
export async function previewForRun(
    action: 'link' | 'unlink',
    options: ConsoleCommandOptions,
    ctx: CommandContext,
    dependencies: ConsoleCommandDependencies,
    failed: CommandErrorDefinition<{ message: string }>,
): Promise<{ preview: ConsoleChangePreview } | { result: ErrorResult | IncompleteResult }> {
    const planned = plannedPreviews.get(ctx);
    if (planned) {
        return { preview: planned };
    }
    let preview: ConsoleChangePreview;
    try {
        preview = await previewConsoleChange(
            action,
            options,
            { ...dependencies, reporter: silentReporter },
            { strict: true },
        );
    } catch (error) {
        const described = describeConsoleError(error, dependencies.outputMode, ctx.signal);
        if (described.kind === 'interrupted') {
            return { result: fail(hostErrors.cancelled, {}) };
        }
        if (described.kind === 'need') {
            if (!ctx.ask) {
                // The need has no message of its own, so the reason is a notice.
                ctx.notice('warning', described.message);
            }
            described.nextSteps.forEach(step => ctx.notice('info', step));
            return {
                result: ctx.ask ? fail(failed, { message: described.message }) : incomplete([described.need]),
            };
        }
        return { result: fail(failed, { message: described.message }) };
    }
    if (preview.requiredConsents.length > 0) {
        return {
            result: fail(failed, {
                message:
                    `This change needs the ${preview.requiredConsents.join(' and ')} consent, which ` +
                    'nobody was asked for. Run the command again to be asked.',
            }),
        };
    }
    return { preview };
}

/** A need, worded for a person who reads it as a notice. */
export function describeNeed(need: CommandNeed): string {
    switch (need.kind) {
        case 'input':
            return need.description;
        case 'consent':
            return need.description;
        case 'person':
            return `${need.summary} ${need.url}`;
    }
}

/**
 * Reports what the engine said was an error, as warning notices, once the run knows its result.
 * A message the coded error carries is left out, so a person does not read it twice.
 */
export function reportErrors<Result>(ctx: CommandContext, errors: string[], result: Result): Result {
    const details = isErrorResult(result) ? (result.details as { message?: unknown } | undefined) : undefined;
    const coded = typeof details?.message === 'string' ? details.message : undefined;
    for (const message of errors) {
        if (!coded?.includes(message)) {
            ctx.notice('warning', message);
        }
    }
    return result;
}

/**
 * Why the plugin setup of this run is not that of `projectRoot`: the CLI loaded the plugins of
 * another project, because `dir` came only in the input, which the CLI reads after it loads them.
 */
export function pluginProjectMismatch(projectRoot: string): string | undefined {
    const loadedFor = getPluginProjectRoot();
    if (!loadedFor || sameDirectory(loadedFor, projectRoot)) {
        return undefined;
    }
    return (
        `The CLI plugins of ${loadedFor} were loaded, so their setup runs, not that of ${projectRoot}. ` +
        `To run the plugin setup of ${projectRoot}, pass --dir ${projectRoot} on the command line.`
    );
}

function sameDirectory(a: string, b: string): boolean {
    const real = (directory: string) => {
        try {
            return fs.realpathSync(directory);
        } catch {
            return path.resolve(directory);
        }
    };
    return real(a) === real(b);
}
