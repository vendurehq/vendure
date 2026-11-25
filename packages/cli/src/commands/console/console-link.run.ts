import { CommandContext, CommandNeed, fail, failed, incomplete } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import {
    consoleDependencies,
    consoleLinkHooks,
    describeNeed,
    pluginProjectMismatch,
    previewForRun,
    projectIsDirectory,
    reportErrors,
    resolveConsoleProject,
} from './console-context.js';
import { consoleErrors } from './console.errors.js';
import { runConsole } from './console.js';
import { link, LinkInput, LinkOutput } from './console.schema.js';

/** The fields of `vendure console link`, which a caller can pass when it runs it again. */
const LINK_FIELDS = new Set(Object.keys(link.input.shape));

function isAnswerable(need: CommandNeed): boolean {
    return need.fix !== undefined || (need.kind === 'input' && LINK_FIELDS.has(need.field));
}

/**
 * Links the project, or repairs the link on disk, then runs the `afterConsoleLink` hooks of the
 * CLI plugins. Without a person, a missing login or Project, and what a hook still needs, are
 * needs. With a person, they are notices: the host would ask the person for fields this command
 * does not take, and run the link and its hooks again. A hook that failed leaves the link it ran
 * after in place, and the result is failed.
 */
export async function run(input: LinkInput, ctx: CommandContext) {
    const refused = projectIsDirectory(input, ctx.cwd);
    if (refused) {
        return refused;
    }
    const { dir, ...rest } = input;
    const project = resolveConsoleProject(['console', 'link'], ctx.cwd, dir, rest);
    if ('error' in project) {
        return project.error;
    }
    // Only a dir the caller gave can name another project than the one the plugins came from. Without
    // one, as from a workspace root, both are found from the working directory.
    const mismatch = dir ? pluginProjectMismatch(project.projectRoot) : undefined;
    if (mismatch) {
        ctx.notice('warning', mismatch);
    }
    const { dependencies, errors } = consoleDependencies(ctx, consoleLinkHooks());
    // The run works from the preview whose consents the host asked for, as `plan()` recorded it,
    // and passes its lookup on, so the link does not look the Project up again.
    const previewed = await previewForRun('link', input, ctx, dependencies, consoleErrors.linkFailed);
    if ('result' in previewed) {
        return previewed.result;
    }
    const { requiredConsents, linked, identity } = previewed.preview;
    const { exitCode, result, manifest, failure, interrupted, changed } = await runConsole(
        'link',
        { ...input, force: requiredConsents.includes('replaceLink'), linked, expected: identity },
        dependencies,
    );
    if (interrupted) {
        return fail(hostErrors.cancelled, {});
    }
    if (changed) {
        return fail(consoleErrors.linkChanged, {});
    }
    const output: LinkOutput | undefined =
        manifest && result.data.link
            ? {
                  outcome: result.data.link.outcome,
                  manifestPath: result.data.link.manifestPath,
                  project: { id: manifest.project.id, name: manifest.project.name },
                  account: { id: manifest.account.id, name: manifest.account.name },
                  plugins: result.data.plugins,
                  nextSteps: result.nextSteps,
              }
            : undefined;
    if (result.outcome === 'incomplete' && result.needs.length > 0) {
        // A need goes back to the caller only when the caller can answer it without a person: an
        // input of this command, or a need with a fix, which names the command that answers it.
        // Any other need, such as an input a plugin hook names that this command does not take,
        // is a next step. So is every need when a person is there, who would otherwise be asked
        // for fields this command drops, and see the link and its hooks run again.
        const answerable = ctx.ask ? [] : result.needs.filter(isAnswerable);
        const steps = result.needs.filter(need => !answerable.includes(need));
        for (const need of steps) {
            ctx.notice('warning', describeNeed(need));
        }
        const withSteps = output && {
            ...output,
            nextSteps: [...output.nextSteps, ...steps.map(describeNeed)],
        };
        if (answerable.length > 0) {
            return reportErrors(ctx, errors, incomplete(answerable, withSteps));
        }
        if (withSteps) {
            return reportErrors(ctx, errors, failed(withSteps));
        }
        // Nothing was linked. The reason the engine gave, such as a Project that is not one of the
        // account's, comes first.
        return reportErrors(
            ctx,
            errors,
            fail(consoleErrors.linkFailed, {
                message: [...errors.slice(-1), ...steps.map(describeNeed)].join(' '),
            }),
        );
    }
    if (exitCode === 0 && output) {
        return reportErrors(ctx, errors, output);
    }
    if (output) {
        // The link is on disk, and the setup after it did not finish. The engine said why.
        return reportErrors(ctx, errors, failed(output));
    }
    return reportErrors(
        ctx,
        errors,
        fail(consoleErrors.linkFailed, {
            message: failure ?? errors.at(-1) ?? 'The Console link did not finish.',
        }),
    );
}
