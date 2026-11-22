import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import pc from 'picocolors';

import { runCoreCommand } from '../../command-host/run-core-command.js';
import { abortIfNonInteractive, withInteractiveTimeout } from '../../utilities/utils.js';

const migrateExamples = [
    'vendure migrate generate my-migration',
    'vendure migrate run',
    'vendure migrate revert',
];

export interface MigrateOptions {
    generate?: string;
    run?: boolean;
    outputDir?: string;
    /** Generate a baseline migration by diffing against an empty shadow database */
    fromEmpty?: boolean;
    /** Specify the path to a custom Vendure config file */
    config?: string;
}

/**
 * @description
 * Generates or runs a migration from the flags, or asks which migration command to run. Each of
 * them runs `vendure migrate generate`, `run` or `revert` through the command host.
 */
export async function migrateCommand(options: MigrateOptions = {}): Promise<number> {
    if (options.generate && options.run) {
        log.error('The migrate command accepts only one operation at a time. Received: --generate, --run.');
        log.info(
            'Run one of: vendure migrate generate <name>, vendure migrate run, or vendure migrate revert.',
        );
        return 1;
    }
    if (options.fromEmpty && !options.generate) {
        log.error('The --from-empty flag can only be used together with --generate <name>.');
        return 1;
    }
    if (options.generate) {
        return runCoreCommand(['migrate', 'generate'], {
            name: options.generate,
            outputDir: options.outputDir,
            fromEmpty: options.fromEmpty,
            config: options.config,
        });
    }
    if (options.run) {
        return runCoreCommand(['migrate', 'run'], { config: options.config });
    }

    if (abortIfNonInteractive('vendure migrate', migrateExamples)) {
        return 1;
    }
    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue('🛠️️ Vendure migrations'));
    const action = await withInteractiveTimeout(
        () =>
            select({
                message: 'What would you like to do?',
                options: [
                    { value: 'generate', label: 'Generate a new migration' },
                    { value: 'run', label: 'Run pending migrations' },
                    { value: 'revert', label: 'Revert the last migration' },
                ],
            }),
        { examples: migrateExamples, helpCommands: ['vendure migrate --help'] },
    );
    if (isCancel(action)) {
        cancel('Migrate cancelled.');
        return 0;
    }
    const exitCode = await runCoreCommand(['migrate', String(action)], { config: options.config });
    outro(exitCode === 0 ? '✅ Done!' : '❌ Error');
    return exitCode;
}
