/* eslint-disable no-console */
import fs from 'fs-extra';
import path from 'path';
import pc from 'picocolors';
import { Connection, createConnection, DataSourceOptions } from 'typeorm';
import { MysqlDriver } from 'typeorm/driver/mysql/MysqlDriver';
import { camelCase } from 'typeorm/util/StringUtils';

import { preBootstrapConfig } from './bootstrap';
import { resetConfig } from './config/config-helpers';
import { VendureConfig } from './config/vendure-config';

/**
 * @description
 * Configuration for generating a new migration script via {@link generateMigration}.
 *
 * @docsCategory migration
 */
export interface MigrationOptions {
    /**
     * @description
     * The name of the migration. The resulting migration script will be named
     * `{TIMESTAMP}-{name}.ts`.
     */
    name: string;
    /**
     * @description
     * The output directory of the generated migration scripts.
     */
    outputDir?: string;
}

/**
 * @description
 * Runs any pending database migrations. See [TypeORM migration docs](https://typeorm.io/#/migrations)
 * for more information about the underlying migration mechanism.
 *
 * @docsCategory migration
 */
export async function runMigrations(userConfig: Partial<VendureConfig>): Promise<string[]> {
    const config = await preBootstrapConfig(userConfig);
    const connection = await createConnection(createConnectionOptions(config));
    const migrationsRan: string[] = [];
    try {
        const migrations = await disableForeignKeysForSqLite(connection, () =>
            connection.runMigrations({ transaction: 'each' }),
        );
        for (const migration of migrations) {
            log(pc.green(`Successfully ran migration: ${migration.name}`));
            migrationsRan.push(migration.name);
        }
    } catch (e: any) {
        log(pc.red('An error occurred when running migrations:'));
        log(e.message);
        if (isRunningFromVendureCli()) {
            throw e;
        } else {
            process.exitCode = 1;
        }
    } finally {
        await checkMigrationStatus(connection);
        await connection.close();
        resetConfig();
    }
    return migrationsRan;
}

async function checkMigrationStatus(connection: Connection) {
    const builderLog = await connection.driver.createSchemaBuilder().log();
    if (builderLog.upQueries.length) {
        log(
            pc.yellow(
                'Your database schema does not match your current configuration. Generate a new migration for the following changes:',
            ),
        );
        for (const query of builderLog.upQueries) {
            log(' - ' + pc.yellow(query.query));
        }
    }
}

/**
 * @description
 * Reverts the last applied database migration. See [TypeORM migration docs](https://typeorm.io/#/migrations)
 * for more information about the underlying migration mechanism.
 *
 * @docsCategory migration
 */
export async function revertLastMigration(userConfig: Partial<VendureConfig>) {
    const config = await preBootstrapConfig(userConfig);
    const connection = await createConnection(createConnectionOptions(config));
    try {
        await disableForeignKeysForSqLite(connection, () =>
            connection.undoLastMigration({ transaction: 'each' }),
        );
    } catch (e: any) {
        log(pc.red('An error occurred when reverting migration:'));
        log(e.message);
        if (isRunningFromVendureCli()) {
            throw e;
        } else {
            process.exitCode = 1;
        }
    } finally {
        await connection.close();
        resetConfig();
    }
}

/**
 * @description
 * Generates a new migration file based on any schema changes (e.g. adding or removing CustomFields).
 * See [TypeORM migration docs](https://typeorm.io/#/migrations) for more information about the
 * underlying migration mechanism.
 *
 * @docsCategory migration
 */
export async function generateMigration(
    userConfig: Partial<VendureConfig>,
    options: MigrationOptions,
): Promise<string | undefined> {
    const config = await preBootstrapConfig(userConfig);
    const connection = await createConnection(createConnectionOptions(config));

    // TODO: This can hopefully be simplified if/when TypeORM exposes this CLI command directly.
    // See https://github.com/typeorm/typeorm/issues/4494
    const sqlInMemory = await connection.driver.createSchemaBuilder().log();
    const upSqls: string[] = [];
    const downSqls: string[] = [];
    let migrationName: string | undefined;

    // mysql is exceptional here because it uses ` character in to escape names in queries, that's why for mysql
    // we are using simple quoted string instead of template string syntax
    if (connection.driver instanceof MysqlDriver) {
        sqlInMemory.upQueries.forEach(upQuery => {
            upSqls.push(
                '        await queryRunner.query("' +
                    upQuery.query.replace(new RegExp('"', 'g'), '\\"') +
                    '", ' +
                    JSON.stringify(upQuery.parameters) +
                    ');',
            );
        });
        sqlInMemory.downQueries.forEach(downQuery => {
            downSqls.push(
                '        await queryRunner.query("' +
                    downQuery.query.replace(new RegExp('"', 'g'), '\\"') +
                    '", ' +
                    JSON.stringify(downQuery.parameters) +
                    ');',
            );
        });
    } else {
        sqlInMemory.upQueries.forEach(upQuery => {
            upSqls.push(
                '        await queryRunner.query(`' +
                    upQuery.query.replace(new RegExp('`', 'g'), '\\`') +
                    '`, ' +
                    JSON.stringify(upQuery.parameters) +
                    ');',
            );
        });
        sqlInMemory.downQueries.forEach(downQuery => {
            downSqls.push(
                '        await queryRunner.query(`' +
                    downQuery.query.replace(new RegExp('`', 'g'), '\\`') +
                    '`, ' +
                    JSON.stringify(downQuery.parameters) +
                    ');',
            );
        });
    }

    if (upSqls.length) {
        if (options.name) {
            const timestamp = new Date().getTime();
            const filename = timestamp.toString() + '-' + options.name + '.ts';
            const directory = options.outputDir;
            const fileContent = getTemplate(options.name as any, timestamp, upSqls, downSqls.reverse());
            const outputPath = directory
                ? path.join(directory, filename)
                : path.join(process.cwd(), filename);
            await fs.ensureFile(outputPath);
            fs.writeFileSync(outputPath, fileContent);

            log(pc.green(`Migration ${pc.blue(outputPath)} has been generated successfully.`));
            migrationName = outputPath;
        }
    } else {
        log(pc.yellow('No changes in database schema were found - cannot generate a migration.'));
    }
    await connection.close();
    resetConfig();
    return migrationName;
}

function createConnectionOptions(userConfig: Partial<VendureConfig>): DataSourceOptions {
    return Object.assign({ logging: ['query', 'error', 'schema'] }, userConfig.dbConnectionOptions, {
        subscribers: [],
        synchronize: false,
        migrationsRun: false,
        dropSchema: false,
        logger: 'advanced-console',
    });
}

/**
 * There is a bug in TypeORM which causes db schema changes to fail with SQLite. This
 * is a work-around for the issue.
 * See https://github.com/typeorm/typeorm/issues/2576#issuecomment-499506647
 */
async function disableForeignKeysForSqLite<T>(connection: Connection, work: () => Promise<T>): Promise<T> {
    const isSqLite = connection.options.type === 'sqlite' || connection.options.type === 'better-sqlite3';
    if (isSqLite) {
        await connection.query('PRAGMA foreign_keys=OFF');
    }
    const result = await work();
    if (isSqLite) {
        await connection.query('PRAGMA foreign_keys=ON');
    }
    return result;
}

/**
 * Gets contents of the migration file.
 */
function getTemplate(name: string, timestamp: number, upSqls: string[], downSqls: string[]): string {
    return `import {MigrationInterface, QueryRunner} from "typeorm";

export class ${camelCase(name, true)}${timestamp} implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
${upSqls.join(`
`)}
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
${downSqls.join(`
`)}
   }

}
`;
}

function log(message: string) {
    // If running from within the Vendure CLI, we allow the CLI app
    // to handle the logging.
    if (isRunningFromVendureCli()) {
        return;
    }
    console.log(message);
}

function isRunningFromVendureCli(): boolean {
    return process.env.VENDURE_RUNNING_IN_CLI != null;
}
