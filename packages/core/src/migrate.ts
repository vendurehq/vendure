/* eslint-disable no-console */
import fs from 'fs-extra';
import path from 'path';
import pc from 'picocolors';
import { Connection, createConnection, DataSourceOptions, MigrationExecutor } from 'typeorm';
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
 * The configured `migrations` patterns matched no files, but the database has migrations
 * recorded as applied. The patterns must therefore have stopped matching, for example because
 * they point at compiled output which has not been built.
 *
 * @docsCategory migration
 * @since 3.7.2
 */
export interface NoMigrationsMatchedDiagnostic {
    type: 'no-migrations-matched';
    /**
     * @description
     * The glob patterns configured in `dbConnectionOptions.migrations`.
     */
    patterns: string[];
    /**
     * @description
     * The directory the patterns were resolved against.
     */
    cwd: string;
}

/**
 * @description
 * The database schema does not match the current entity configuration, so a new migration
 * needs to be generated.
 *
 * @docsCategory migration
 * @since 3.7.2
 */
export interface SchemaOutOfSyncDiagnostic {
    type: 'schema-out-of-sync';
    /**
     * @description
     * The SQL statements which would bring the schema back into line with the configuration.
     */
    queries: string[];
}

/**
 * @description
 * A condition detected while running migrations which cannot be inferred from the return value
 * of {@link runMigrations}.
 *
 * @docsCategory migration
 * @since 3.7.2
 */
export type MigrationDiagnostic = NoMigrationsMatchedDiagnostic | SchemaOutOfSyncDiagnostic;

/**
 * @description
 * Options for {@link runMigrations}.
 *
 * @docsCategory migration
 * @since 3.7.2
 */
export interface RunMigrationsOptions {
    /**
     * @description
     * Invoked for each {@link MigrationDiagnostic} detected during the run. These conditions are
     * printed to the console by default, but that output is suppressed when running from the
     * Vendure CLI so that the CLI can render them itself.
     */
    onDiagnostic?: (diagnostic: MigrationDiagnostic) => void;
}

/**
 * @description
 * Runs any pending database migrations. See [TypeORM migration docs](https://typeorm.io/#/migrations)
 * for more information about the underlying migration mechanism.
 *
 * @docsCategory migration
 */
export async function runMigrations(
    userConfig: Partial<VendureConfig>,
    options?: RunMigrationsOptions,
): Promise<string[]> {
    const config = await preBootstrapConfig(userConfig);
    const connection = await createConnection(createConnectionOptions(config));
    const migrationsRan: string[] = [];
    const report = (diagnostic: MigrationDiagnostic) => {
        options?.onDiagnostic?.(diagnostic);
        log(pc.yellow(describeDiagnostic(diagnostic).join('\n')));
    };
    try {
        const unmatched = await detectUnmatchedPatterns(connection);
        if (unmatched) {
            report(unmatched);
        }
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
        await checkMigrationStatus(connection, report);
        await connection.close();
        resetConfig();
    }
    return migrationsRan;
}

async function checkMigrationStatus(connection: Connection, report: (d: MigrationDiagnostic) => void) {
    const builderLog = await connection.driver.createSchemaBuilder().log();
    if (builderLog.upQueries.length) {
        report({ type: 'schema-out-of-sync', queries: builderLog.upQueries.map(q => q.query) });
    }
}

/**
 * @description
 * Renders a {@link MigrationDiagnostic} as lines of human-readable text.
 *
 * @docsCategory migration
 * @since 3.7.2
 */
export function describeDiagnostic(diagnostic: MigrationDiagnostic): string[] {
    switch (diagnostic.type) {
        case 'no-migrations-matched':
            return [
                'No migration files matched the configured `migrations` patterns, but this database has migrations recorded as applied.',
                `Patterns are resolved relative to the current directory (${diagnostic.cwd}):`,
                ...diagnostic.patterns.map(pattern => ' - ' + pattern),
            ];
        case 'schema-out-of-sync':
            return [
                'Your database schema does not match your current configuration. Generate a new migration for the following changes:',
                ...diagnostic.queries.map(query => ' - ' + query),
            ];
    }
}

/**
 * TypeORM resolves migration globs relative to `process.cwd()` and silently yields zero classes
 * when nothing matches. That is indistinguishable from "every migration has already been
 * applied" in the return value of `runMigrations()`, so the command reports success while
 * leaving the database untouched.
 *
 * Zero loaded classes on its own is not evidence of a problem: it is also what a project looks
 * like before its first migration is authored, which is how the `create` scaffold ships. The
 * discriminator is the `migrations` table. If the database has migrations on record but nothing
 * loaded, the patterns can only have stopped matching.
 */
async function detectUnmatchedPatterns(
    connection: Connection,
): Promise<NoMigrationsMatchedDiagnostic | undefined> {
    if (connection.migrations.length) {
        return;
    }
    const patterns = getConfiguredPatterns(connection.options.migrations);
    if (!patterns.length) {
        return;
    }
    // Creates the `migrations` table as a side effect, which `runMigrations()` does anyway on
    // the next line. Returns an empty array rather than throwing against a fresh database.
    const executed = await new MigrationExecutor(connection).getExecutedMigrations();
    if (!executed.length) {
        return;
    }
    return { type: 'no-migrations-matched', patterns, cwd: process.cwd() };
}

function getConfiguredPatterns(configuredMigrations: DataSourceOptions['migrations']): string[] {
    const entries = Array.isArray(configuredMigrations)
        ? configuredMigrations
        : Object.values(configuredMigrations ?? {});
    return entries.filter((entry): entry is string => typeof entry === 'string');
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
