import { createCancellation, createHostEnvironment, executeWithCancellation } from './commander-adapter.js';
import { presentForPeople } from './present.js';

/**
 * Runs one of the CLI's own `defineCommand` commands for a person, as `vendure <path>` would, and
 * returns its exit code. The older entry points use it: the menus of `vendure add` and
 * `vendure migrate`, and their flags such as `vendure migrate --run`. They pass what they already
 * know, and the host asks for the rest.
 */
export async function runCoreCommand(path: string[], input: Record<string, unknown> = {}): Promise<number> {
    const { coreCommandDefinitions } = await import('./core-commands.js');
    const key = path.join(' ');
    const def = coreCommandDefinitions.find(candidate => candidate.path.join(' ') === key);
    if (!def) {
        throw new Error(`The CLI has no command "${key}"`);
    }
    const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const controller = createCancellation();
    const result = await executeWithCancellation(def, defined, createHostEnvironment(controller), controller);
    await presentForPeople(def, result);
    return result.exitCode;
}
