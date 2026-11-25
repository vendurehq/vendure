import { createCancellation, createHostEnvironment, executeWithCancellation } from './commander-adapter.js';
import { HostResult } from './host.js';
import { presentForPeople } from './present.js';

/**
 * Runs one of the CLI's own `defineCommand` commands for a person, as `vendure <path>` would, and
 * returns its result: the envelope, and the exit code. The older entry points use it: the menus of `vendure add` and
 * `vendure migrate`, and their flags such as `vendure migrate --run`. They pass what they already
 * know, and the host asks for the rest.
 *
 * When the person typed something other than `vendure <path>`, such as an older flag, a result
 * that is `incomplete` names `vendure <path>` with the input given so far, so the missing flags
 * apply to that command line.
 *
 * It always runs the CLI's own declaration. A CLI plugin that replaces the command replaces
 * `vendure <path>` only; the older flags and menus keep running the built-in command.
 */
export async function runCoreCommand(
    path: string[],
    input: Record<string, unknown> = {},
): Promise<HostResult> {
    const { coreCommandDefinitions } = await import('./core-commands.js');
    const key = path.join(' ');
    const def = coreCommandDefinitions.find(candidate => candidate.path.join(' ') === key);
    if (!def) {
        throw new Error(`The CLI has no command "${key}"`);
    }
    const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const controller = createCancellation();
    const result = await executeWithCancellation(def, defined, createHostEnvironment(controller), controller);
    await presentForPeople(def, result, { path, input: defined });
    return result;
}
