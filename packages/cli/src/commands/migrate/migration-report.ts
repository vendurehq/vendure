import { MigrationDiagnostic } from '@vendure/core';

export interface MigrationReport {
    /** A one-line summary, suitable for a spinner. */
    summary: string;
    /** The diagnostics, rendered. Empty when there are none. */
    details: string;
    /** True when a diagnostic was reported, so the caller can pick a warning channel. */
    hasWarnings: boolean;
}

/**
 * Builds what `vendure migrate run` prints for a person: a one-line summary that does not claim
 * the database is up to date when it is not, and the diagnostics.
 */
export function buildMigrationReport(
    migrationsRan: string[],
    diagnostics: MigrationDiagnostic[],
): MigrationReport {
    // "No pending migrations found" is false when the patterns stopped matching: migrations are
    // pending, they just could not be loaded.
    const patternsUnmatched = diagnostics.some(d => d.code === 'no-migrations-matched');
    const summary = migrationsRan.length
        ? `Successfully ran ${migrationsRan.length} migration${migrationsRan.length === 1 ? '' : 's'}`
        : patternsUnmatched
          ? 'No migration files could be loaded'
          : 'No pending migrations found';

    const details = diagnostics.map(render).join('\n\n');
    return {
        summary,
        details,
        hasWarnings: diagnostics.length > 0,
    };
}

/**
 * A schema drift list can be the entire schema, which is more than a terminal should be asked to
 * render. Callers of `runMigrations()` still receive every line on the diagnostic.
 */
const maxRenderedLines = 11;

function render(diagnostic: MigrationDiagnostic): string {
    const shown = diagnostic.lines.slice(0, maxRenderedLines);
    const remaining = diagnostic.lines.length - shown.length;
    return [...shown, ...(remaining ? [` ...and ${remaining} more`] : [])].join('\n');
}
