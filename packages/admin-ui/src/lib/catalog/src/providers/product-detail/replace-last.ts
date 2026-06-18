/**
 * @description
 * Like String.prototype.replace(), but replaces the last instance
 * rather than the first.
 */
export function replaceLast(target: string | undefined | null, search: string, replace: string): string {
    if (!target) {
        return '';
    }
    const lastIndex = target.lastIndexOf(search);
    if (lastIndex === -1) {
        return target;
    }
    const head = target.substr(0, lastIndex);
    const tail = target.substr(lastIndex).replace(search, replace);
    return head + tail;
}
