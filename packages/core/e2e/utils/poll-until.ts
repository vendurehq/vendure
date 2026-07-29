/**
 * Polls the given predicate until it returns true, or throws once the timeout elapses.
 *
 * Use this instead of a fixed `setTimeout` when waiting for asynchronous work whose completion
 * time is not deterministic (e.g. a scheduled task firing). A fixed sleep either flakes when the
 * work is slower than expected (CI load) or wastes time when it is faster; polling waits exactly
 * as long as needed and fails loudly if the work never happens.
 */
export async function pollUntil(
    predicate: () => boolean | Promise<boolean>,
    { timeout = 5000, interval = 25 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
    const startTime = Date.now();
    for (;;) {
        if (await predicate()) {
            return;
        }
        if (Date.now() - startTime >= timeout) {
            throw new Error(`pollUntil timed out after ${timeout}ms waiting for the predicate to pass`);
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
