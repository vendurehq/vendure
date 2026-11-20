/** A field name as its flag, for example `revertMigration` as `revert-migration`. */
export function kebab(name: string): string {
    return name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}
