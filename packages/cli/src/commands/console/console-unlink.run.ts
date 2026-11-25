import { CommandContext, fail } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import { consoleDependencies, silentReporter } from './console-context.js';
import { consoleErrors } from './console.errors.js';
import { previewConsoleChange, runConsole } from './console.js';
import { DirInput, UnlinkOutput } from './console.schema.js';

/**
 * Removes the Project Link Manifest, and asks Console to stop attributing the installation's
 * telemetry to the Project. The Console Project, its link and the CLI login stay as they are.
 */
export async function run(input: DirInput, ctx: CommandContext) {
    const { dependencies, errors } = consoleDependencies(ctx);
    // The host runs this only once the caller gave the consent `plan()` asked for.
    const { preview, requiredConsents } = await previewConsoleChange('unlink', input, {
        ...dependencies,
        reporter: silentReporter,
    });
    const { exitCode, failure, interrupted } = await runConsole(
        'unlink',
        { dir: input.dir, force: requiredConsents.includes('removeLink') },
        dependencies,
    );
    if (interrupted) {
        return fail(hostErrors.cancelled, {});
    }
    if (exitCode !== 0 || typeof preview.manifestPath !== 'string') {
        return fail(consoleErrors.unlinkFailed, {
            message: failure ?? errors.at(-1) ?? 'The Console unlink did not finish.',
        });
    }
    return {
        removed: requiredConsents.length > 0,
        manifestPath: preview.manifestPath,
    } satisfies UnlinkOutput;
}

export function render(output: UnlinkOutput): string {
    return output.removed
        ? `Removed the Project Link Manifest at ${output.manifestPath}.`
        : `The project is not linked. No manifest exists at ${output.manifestPath}.`;
}
