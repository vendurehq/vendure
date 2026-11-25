import { CommandContext, CommandNeed, fail, failed, incomplete } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import {
    consoleDependencies,
    consoleLinkHooks,
    describeNeed,
    previewForRun,
    projectIsDirectory,
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
 * does not take, and run the link and its hooks again. A hook that failed is a coded error. Either
 * way, the link it ran after stays in place.
 */
export async function run(input: LinkInput, ctx: CommandContext) {
    const refused = projectIsDirectory(input.project, ctx.cwd, input.dir);
    if (refused) {
        return refused;
    }
    const project = resolveConsoleProject(['console', 'link'], ctx.cwd, input.dir);
    if ('error' in project) {
        return project.error;
    }
    const { dependencies, errors } = consoleDependencies(ctx, consoleLinkHooks());
    // The host runs this only once the caller gave the consents that `plan()` asked for, so a
    // replacement found again here has its consent. Its lookup is passed on, so the link does not
    // look the Project up a third time.
    const previewed = await previewForRun('link', input, ctx, dependencies, consoleErrors.linkFailed);
    if ('result' in previewed) {
        return previewed.result;
    }
    const { requiredConsents, linked } = previewed.preview;
    const { exitCode, result, manifest, failure, interrupted } = await runConsole(
        'link',
        { ...input, force: requiredConsents.includes('replaceLink'), linked },
        dependencies,
    );
    if (interrupted) {
        return fail(hostErrors.cancelled, {});
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
            return incomplete(answerable, withSteps);
        }
        if (withSteps) {
            return failed(withSteps);
        }
        // Nothing was linked. The reason the engine gave, such as a Project that is not one of the
        // account's, comes first.
        return fail(consoleErrors.linkFailed, {
            message: [...errors.slice(-1), ...steps.map(describeNeed)].join(' '),
        });
    }
    if (exitCode === 0 && output) {
        return output;
    }
    const reason = failure ?? errors.at(-1) ?? 'The Console link did not finish.';
    if (output) {
        // The link is on disk, and the setup after it did not finish.
        ctx.notice('warning', reason);
        return failed(output);
    }
    return fail(consoleErrors.linkFailed, { message: reason });
}
