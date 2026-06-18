/* eslint-disable */
/**
 * Used to profile peak memory usage for perf optimization purposes
 *
 * Add it to the index.ts or index-worker.ts:
 * ```ts
 * import { profileMemory } from './memory-profiler';
 *
 * profileMemory();
 * ```
 */
export function profileMemory() {
    let max = 0;
    setInterval(() => {
        const rss = process.memoryUsage().rss;
        if (max < rss) {
            max = rss;
            console.log(`Peak: ${inMb(max)}`);
        }
    }, 500);
}

function inMb(bytes: number) {
    return `${Math.round((bytes / 1024 / 1024) * 100) / 100}MB;`;
}
