import { log } from '@clack/prompts';
import { generateMigration, revertLastMigration, runMigrations, VendureConfig } from '@vendure/core';
import path from 'node:path';

import { loadVendureConfigFile } from '../../shared/load-vendure-config-file';
import { validateVendureProjectDirectory } from '../../shared/project-validation';
import { analyzeProject } from '../../shared/shared-prompts';
import { VendureConfigRef } from '../../shared/vendure-config-ref';

export interface MigrationOptions {
    name?: string;
    outputDir?: string;
    config?: string;
}

export interface MigrationResult {
    success: boolean;
    message: string;
    migrationName?: string;
    migrationsRan?: string[];
}

export async function generateMigrationOperation(options: MigrationOptions = {}): Promise<MigrationResult> {
    try {
        validateVendureProjectDirectory();

        const { project, tsConfigPath } = await analyzeProject({ cancelledMessage: '' });
        const vendureConfig = new VendureConfigRef(project, options.config);
        log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());

        const name = options.name;
        if (!name) {
            return {
                success: false,
                message: 'Migration name is required',
            };
        }

        if (!/^[a-zA-Z][a-zA-Z-_0-9]+$/.test(name)) {
            return {
                success: false,
                message: 'The migration name must contain only letters, numbers, underscores and dashes',
            };
        }

        const config = await loadVendureConfigFile(vendureConfig, tsConfigPath);
        const migrationsDirs = getMigrationsDir(vendureConfig, config);
        const migrationDir = options.outputDir || migrationsDirs[0];

        log.info('Generating migration...');
        const migrationName = await generateMigration(config, { name, outputDir: migrationDir });

        const report =
            typeof migrationName === 'string'
                ? `New migration generated: ${migrationName}`
                : 'No changes in database schema were found, so no migration was generated';

        return {
            success: true,
            message: report,
            migrationName: typeof migrationName === 'string' ? migrationName : undefined,
        };
    } catch (error: any) {
        return {
            success: false,
            message: error.message || 'Failed to generate migration',
        };
    }
}

export async function runMigrationsOperation(configFile?: string): Promise<MigrationResult> {
    try {
        validateVendureProjectDirectory();

        const { project } = await analyzeProject({ cancelledMessage: '' });
        const vendureConfig = new VendureConfigRef(project, configFile);
        log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
        const config = await loadVendureConfigFile(vendureConfig);

        log.info('Running migrations...');
        const migrationsRan = await runMigrations(config);

        const report = migrationsRan.length
            ? `Successfully ran ${migrationsRan.length} migrations`
            : 'No pending migrations found';

        return {
            success: true,
            message: report,
            migrationsRan,
        };
    } catch (error: any) {
        return {
            success: false,
            message: error.message || 'Failed to run migrations',
        };
    }
}

export async function revertMigrationOperation(configFile?: string): Promise<MigrationResult> {
    try {
        validateVendureProjectDirectory();

        const { project } = await analyzeProject({ cancelledMessage: '' });
        const vendureConfig = new VendureConfigRef(project, configFile);
        log.info('Using VendureConfig from ' + vendureConfig.getPathRelativeToProjectRoot());
        const config = await loadVendureConfigFile(vendureConfig);

        log.info('Reverting last migration...');
        await revertLastMigration(config);

        return {
            success: true,
            message: 'Successfully reverted last migration',
        };
    } catch (error: any) {
        return {
            success: false,
            message: error.message || 'Failed to revert migration',
        };
    }
}

function getMigrationsDir(vendureConfigRef: VendureConfigRef, config: VendureConfig): string[] {
    const options: string[] = [];
    if (
        Array.isArray(config.dbConnectionOptions.migrations) &&
        config.dbConnectionOptions.migrations.length
    ) {
        const firstEntry = config.dbConnectionOptions.migrations[0];
        if (typeof firstEntry === 'string') {
            options.push(path.dirname(firstEntry));
        }
    }
    const migrationFile = vendureConfigRef.sourceFile
        .getProject()
        .getSourceFiles()
        .find(sf => {
            return sf
                .getClasses()
                .find(c => c.getImplements().find(i => i.getText() === 'MigrationInterface'));
        });
    if (migrationFile) {
        options.push(migrationFile.getDirectory().getPath());
    }
    options.push(path.join(vendureConfigRef.sourceFile.getDirectory().getPath(), '../migrations'));
    return options.map(p => path.normalize(p));
}
