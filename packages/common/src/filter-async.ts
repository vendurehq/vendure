/**
 * Performs a filter operation where the predicate is an async function returning a Promise.
 */
export async function filterAsync<T>(arr: T[], predicate: (item: T, index: number) => Promise<boolean> | boolean): Promise<T[]> {
    const results: boolean[] = await Promise.all(
        arr.map(async (value, index) => predicate(value, index)),
    );
    return arr.filter((_, i) => results[i]);
}
