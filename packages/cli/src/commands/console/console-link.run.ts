import { CommandContext, fail, incomplete } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import {
    consoleDependencies,
    consoleLinkHooks,
    projectIsDirectory,
    silentReporter,
} from './console-context.js';
import { consoleErrors } from './console.errors.js';
import { previewConsoleChange, runConsole } from './console.js';
import { LinkInput, LinkOutput } from './console.schema.js';

/**
 * Links the project, or repairs the link on disk, then runs the `afterConsoleLink` hooks of the
 * CLI plugins. A missing login or Project, and what a hook still needs, are needs. A hook that
 * failed is a coded error: the link it ran after stays in place.
 */
export async function run(input: LinkInput, ctx: CommandContext) {
    const refused = projectIsDirectory(input.project, ctx.cwd);
    if (refused) {
        return refused;
    }
    const { dependencies, errors } = consoleDependencies(ctx, consoleLinkHooks());
    // The host runs this only once the caller gave the consents that `plan()` asked for, so a
    // replacement found again here has its consent. Only a change between the two, such as another
    // process writing the manifest, could differ.
    const { requiredConsents } = await previewConsoleChange('link', input, {
        ...dependencies,
        reporter: silentReporter,
    });
    const { exitCode, result, manifest, failure, interrupted } = await runConsole(
        'link',
        { ...input, force: requiredConsents.includes('replaceLink') },
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
        return incomplete(result.needs, output);
    }
    if (exitCode === 0 && output) {
        return output;
    }
    return fail(consoleErrors.linkFailed, {
        message: failure ?? errors.at(-1) ?? 'The Console link did not finish.',
    });
}
