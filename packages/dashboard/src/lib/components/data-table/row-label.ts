/**
 * The text that names a table row for assistive technology, for example in
 * "Actions for Laptop". Returns undefined when the row has no readable name.
 */
export function getRowLabel(entity: unknown): string | undefined {
    if (!entity || typeof entity !== 'object') {
        return undefined;
    }
    const record = entity as Record<string, unknown>;
    for (const key of ['name', 'code', 'title', 'emailAddress']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    const fullName = [record.firstName, record.lastName]
        .filter(part => typeof part === 'string' && part.trim())
        .join(' ');
    return fullName || undefined;
}
