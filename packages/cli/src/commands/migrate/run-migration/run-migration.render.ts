import { log } from '@clack/prompts';
import type { MigrationDiagnostic } from '@vendure/core';

import { buildMigrationReport } from '../migration-report.js';

export function render(output: { migrationsRan: string[]; diagnostics: MigrationDiagnostic[] }): void {
    const report = buildMigrationReport(output.migrationsRan, output.diagnostics);
    // clack prefixes only the first line of a message, so the summary and the detail are logged
    // separately.
    if (report.hasWarnings) {
        log.warn(report.summary);
        log.warn(report.details);
    } else {
        log.success(report.summary);
    }
}
