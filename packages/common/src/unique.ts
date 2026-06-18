/**
 * @description
 * Returns an array with only unique values. Objects are compared by reference,
 * unless the `byKey` argument is supplied, in which case matching properties will
 * be used to check duplicates
 */
export function unique<T>(arr: T[], byKey?: keyof T): T[] {
    if (byKey == null) {
        return Array.from(new Set(arr));
    } else {
        // Based on https://stackoverflow.com/a/58429784/772859
        return [...new Map(arr.map(item => [item[byKey], item])).values()];
    }
}
