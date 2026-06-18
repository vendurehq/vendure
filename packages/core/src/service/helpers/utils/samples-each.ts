/**
 * Returns true if and only if exactly one item from each
 * of the "groups" arrays appears in the "sample" array.
 */
export function samplesEach<T>(sample: T[], groups: T[][]): boolean {
    if (sample.length !== groups.length) {
        return false;
    }
    return groups.every(group => {
        for (const item of sample) {
            if (group.includes(item)) {
                return true;
            }
        }
        return false;
    });
}
