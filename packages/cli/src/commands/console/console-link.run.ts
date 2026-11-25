import { CommandContext, fail, failed, incomplete } from '@vendure/common/lib/command';

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
import { LinkInput, LinkOutput } from './console.schema.js';

/**
 * Links the project, or repairs the link on disk, then runs the `afterConsoleLink` hooks of the
 * CLI plugins. Without a person, a missing login or Project, and what a hook still needs, are
 * needs. With a person, they are notices: the host would ask the person for fields this command
 * does not take, and run the link and its hooks again. A hook that failed is a coded error. Either
 * way, the link it ran after stays in place.
 */
export async function run(input: LinkInput, ctx: CommandContext) {
    const refused = projectIsDirectory(input.project, ctx.cwd);
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
        if (!ctx.ask) {
            return incomplete(result.needs, output);
        }
        for (const need of result.needs) {
            ctx.notice('warning', describeNeed(need));
        }
        return output
            ? failed(output)
            : fail(consoleErrors.linkFailed, { message: result.needs.map(describeNeed).join(' ') });
    }
    if (exitCode === 0 && output) {
        return output;
    }
    return fail(consoleErrors.linkFailed, {
        message: failure ?? errors.at(-1) ?? 'The Console link did not finish.',
    });
}
