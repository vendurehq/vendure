import { log, spinner } from '@clack/prompts';
import { MigrationDiagnostic, runMigrations } from '@vendure/core';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { buildMigrationReport } from '../migration-report';

const cancelledMessage = 'Run migrations cancelled';

export const runMigrationCommand = new CliCommand<{ configFile?: string }>({
    id: 'run-migration',
    category: 'Other',
    description: 'Run any pending database migrations',
    run: options => runRunMigration(options?.configFile),
});

async function runRunMigration(configFile?: string): Promise<CliCommandReturnVal> {
    const { project } = await analyzeProject({ cancelledMessage });
    const vendureConfig = new VendureConfigRef(project, configFile);
    log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
    const config = await loadVendureConfigFile(vendureConfig);

    const runSpinner = spinner();
    runSpinner.start('Running migrations...');
    const diagnostics: MigrationDiagnostic[] = [];
    const migrationsRan = await runMigrations(config, {
        onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    });
    const report = buildMigrationReport(migrationsRan, diagnostics);
    // clack prefixes only the first line, so anything multi-line hangs outside the box. The
    // spinner takes the one-line summary and the detail goes to its own log line.
    runSpinner.stop(report.summary);
    if (report.hasWarnings) {
        log.warn(report.details);
    }
    return {
        project,
        modifiedSourceFiles: [],
    };
}
