import { log, spinner } from '@clack/prompts';
import { revertLastMigration } from '@vendure/core';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';

const cancelledMessage = 'Revert migrations cancelled';

export const revertMigrationCommand = new CliCommand<{ configFile?: string }>({
    id: 'revert-migration',
    category: 'Other',
    description: 'Revert the last applied database migration',
    run: options => runRevertMigration(options?.configFile),
});

async function runRevertMigration(configFile?: string): Promise<CliCommandReturnVal> {
    const { project } = await analyzeProject({ cancelledMessage });
    const vendureConfig = new VendureConfigRef(project, configFile);
    log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
    const config = await loadVendureConfigFile(vendureConfig);

    const runSpinner = spinner();
    runSpinner.start('Reverting last migration...');
    await revertLastMigration(config);
    runSpinner.stop(`Successfully reverted last migration`);
    return {
        project,
        modifiedSourceFiles: [],
    };
}
