/** A field name as its flag, for example `revertMigration` as `revert-migration`. */
export function kebab(name: string): string {
    return name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/**
 * Orders strings by their UTF-16 code units, the same in every process and locale. Consent
 * digests depend on this order, so it must never use `localeCompare`.
 */
export function compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
