/**
 * Returns the open section ids after the user opened or closed a section.
 * With `singleOpenSection`, opening a section closes all others.
 */
export function toggleOpenSection(
    open: Set<string>,
    sectionId: string,
    isOpen: boolean,
    singleOpenSection: boolean,
): Set<string> {
    if (singleOpenSection) {
        return isOpen ? new Set([sectionId]) : new Set();
    }
    const next = new Set(open);
    if (isOpen) {
        next.add(sectionId);
    } else {
        next.delete(sectionId);
    }
    return next;
}

/**
 * Returns the open section ids after a route change: the sections of the active route,
 * plus the already open ones unless `singleOpenSection` is set. Returns `open` itself
 * if nothing changes, so React can bail out of the re-render.
 */
export function openActiveSections(
    open: Set<string>,
    active: Set<string>,
    singleOpenSection: boolean,
): Set<string> {
    const next = singleOpenSection ? active : new Set([...open, ...active]);
    return next.size === open.size && [...next].every(id => open.has(id)) ? open : next;
}
