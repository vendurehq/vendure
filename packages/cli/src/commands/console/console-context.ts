import {
    CommandContext,
    CommandErrorDefinition,
    CommandNeed,
    ErrorResult,
    fail,
    incomplete,
    IncompleteResult,
} from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

import { hostErrors } from '../../command-host/host-errors.js';
import { getPluginExtensions } from '../../shared/plugin-extensions.js';
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
        env: process.env,
        fetch: globalThis.fetch,
        hooks,
        isNonInteractive: () => !ask,
        now: () => Date.now(),
        openUrl: openConsoleBrowser,
        prompt: message => (ask ? ask.confirm(message) : Promise.resolve(undefined)),
        select: (message, choices) => (ask ? ask.select(message, choices) : Promise.resolve(undefined)),
        reporter: {
            error: message => {
                errors.push(message);
                ctx.notice('warning', message);
            },
            warn: message => ctx.notice('warning', message),
            info: message => ctx.notice('info', message),
            success: message => ctx.notice('info', message),
            url: value => ctx.event('output', { stream: 'stdout', text: `${value}\n` }),
        },
        // Nobody reads raw errors when nobody is asked: an agent, a script or CI.
        outputMode: ask ? 'human' : 'json',
        signal: ctx.signal,
    };
    return { dependencies, errors };
}

/**
 * `--project` names a Console Project. A value that is a Vendure project directory is the
 * `--project <dir>` of earlier versions, which is `--dir` now.
 */
export function projectIsDirectory(project: string | undefined, cwd: string): ErrorResult | undefined {
    const value = project?.trim();
    if (!value) {
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
            return fail(consoleErrors.projectIsDirectory, { project: value });
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
            }),
        };
    }
}

/**
 * The preview a run works from. A failed preview is reported, never taken for one that needs no
 * consent: a need without a person, and otherwise the command's coded error.
 */
export async function previewForRun(
    action: 'link' | 'unlink',
    options: ConsoleCommandOptions,
    ctx: CommandContext,
    dependencies: ConsoleCommandDependencies,
    failed: CommandErrorDefinition<{ message: string }>,
): Promise<{ preview: ConsoleChangePreview } | { result: ErrorResult | IncompleteResult }> {
    try {
        return {
            preview: await previewConsoleChange(
                action,
                options,
                { ...dependencies, reporter: silentReporter },
                { strict: true },
            ),
        };
    } catch (error) {
        const described = describeConsoleError(error, dependencies.outputMode, ctx.signal);
        if (described.kind === 'interrupted') {
            return { result: fail(hostErrors.cancelled, {}) };
        }
        if (described.kind === 'need') {
            ctx.notice('warning', described.message);
            described.nextSteps.forEach(step => ctx.notice('info', step));
            return {
                result: ctx.ask ? fail(failed, { message: described.message }) : incomplete([described.need]),
            };
        }
        return { result: fail(failed, { message: described.message }) };
    }
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
