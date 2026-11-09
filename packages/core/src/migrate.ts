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

type SchemaDiffMode = 'off' | 'summary' | 'full';

const schemaDiffModes: SchemaDiffMode[] = ['off', 'summary', 'full'];

interface SchemaDiffWhitelistEntry {
    key: string;
    reason: string;
}

type SchemaDiffItemKind = 'column' | 'index' | 'constraint' | 'columnNullability' | 'other';

interface SchemaDiffItem {
    sql: string;
    key: string;
    kind: SchemaDiffItemKind;
    table?: string;
    column?: string;
    declaredType?: string;
}

function getSchemaDiffMode(): SchemaDiffMode {
    const raw = (process.env.VENDURE_SCHEMA_DIFF ?? '').trim().toLowerCase();
    if (!raw) {
        return 'summary';
    }
    if ((schemaDiffModes as string[]).includes(raw)) {
        return raw as SchemaDiffMode;
    }
    log(pc.yellow(`[schema] 未识别的 VENDURE_SCHEMA_DIFF="${raw}"，按 summary 处理（可选 off | summary | full）`));
    return 'summary';
}

/**
 * SUMMARY 模式下的显式白名单。文件由 VENDURE_SCHEMA_DIFF_WHITELIST 指定，
 * 每条登记项都必须写明保留原因；白名单之外的差异一律按 ERROR 级别上报。
 */
function loadSchemaDiffWhitelist(filePath?: string): Map<string, string> {
    const whitelist = new Map<string, string>();
    if (!filePath) {
        return whitelist;
    }
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e: any) {
        console.error(pc.red(`[schema][ERROR] 白名单文件无法读取：${filePath}（${e?.message ?? e}）`));
        return whitelist;
    }
    try {
        const parsed = JSON.parse(raw);
        const entries: SchemaDiffWhitelistEntry[] = Array.isArray(parsed) ? parsed : parsed?.entries ?? [];
        for (const entry of entries) {
            if (entry && typeof entry.key === 'string' && entry.key) {
                whitelist.set(entry.key, entry.reason ?? '');
            }
        }
    } catch (e: any) {
        console.error(pc.red(`[schema][ERROR] 白名单文件解析失败：${filePath}（${e?.message ?? e}）`));
    }
    return whitelist;
}

function parseSchemaDiffItem(sql: string): SchemaDiffItem {
    const statement = sql.trim();
    const indexDrop = /^DROP INDEX "[^"]+"\."([^"]+)"/.exec(statement);
    if (indexDrop) {
        return { sql: statement, key: `index:${indexDrop[1]}`, kind: 'index' };
    }
    const indexCreate = /^CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"/.exec(statement);
    if (indexCreate) {
        return { sql: statement, key: `index:${indexCreate[1]}`, kind: 'index', table: indexCreate[2] };
    }
    const columnDrop = /^ALTER TABLE "([^"]+)" DROP COLUMN "([^"]+)"/.exec(statement);
    if (columnDrop) {
        return {
            sql: statement,
            key: `col:${columnDrop[1]}.${columnDrop[2]}`,
            kind: 'column',
            table: columnDrop[1],
            column: columnDrop[2],
        };
    }
    const columnAdd = /^ALTER TABLE "([^"]+)" ADD "([^"]+)" (.+)$/.exec(statement);
    if (columnAdd) {
        return {
            sql: statement,
            key: `col:${columnAdd[1]}.${columnAdd[2]}`,
            kind: 'column',
            table: columnAdd[1],
            column: columnAdd[2],
            declaredType: columnAdd[3],
        };
    }
    const columnAlter = /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)"/.exec(statement);
    if (columnAlter) {
        return {
            sql: statement,
            key: `null:${columnAlter[1]}.${columnAlter[2]}`,
            kind: 'columnNullability',
            table: columnAlter[1],
            column: columnAlter[2],
        };
    }
    const constraint = /^ALTER TABLE "([^"]+)" (?:ADD|DROP) CONSTRAINT "([^"]+)"/.exec(statement);
    if (constraint) {
        return { sql: statement, key: `con:${constraint[1]}.${constraint[2]}`, kind: 'constraint', table: constraint[1] };
    }
    return { sql: statement, key: `other:${statement}`, kind: 'other' };
}

/**
 * 读取差异涉及列的真实类型。时区对必须靠库里的事实确认，而不是按 SQL 文本猜。
 */
async function loadSchemaDiffColumnTypes(
    connection: Connection,
    items: SchemaDiffItem[],
): Promise<Map<string, string>> {
    const types = new Map<string, string>();
    const tables = Array.from(
        new Set(items.filter(item => item.kind === 'column' && item.table).map(item => item.table as string)),
    );
    if (!tables.length) {
        return types;
    }
    const rows: Array<{ table_name: string; column_name: string; data_type: string }> = await connection.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [tables],
    );
    for (const row of rows) {
        types.set(`${row.table_name}.${row.column_name}`, String(row.data_type).toLowerCase());
    }
    return types;
}

async function checkMigrationStatus(connection: Connection) {
    const mode = getSchemaDiffMode();
    if (mode === 'off') {
        return;
    }
    const builderLog = await connection.driver.createSchemaBuilder().log();
    const upQueries = builderLog.upQueries;
    if (!upQueries.length) {
        return;
    }
    if (mode === 'full') {
        log(
            pc.yellow(
                'Your database schema does not match your current configuration. Generate a new migration for the following changes:',
            ),
        );
        for (const query of upQueries) {
            log(' - ' + pc.yellow(query.query));
        }
        return;
    }

    const whitelist = loadSchemaDiffWhitelist(process.env.VENDURE_SCHEMA_DIFF_WHITELIST);
    const items = upQueries.map(query => parseSchemaDiffItem(query.query));
    let columnTypes: Map<string, string>;
    try {
        columnTypes = await loadSchemaDiffColumnTypes(connection, items);
    } catch (e: any) {
        columnTypes = new Map();
        console.error(pc.red(`[schema][ERROR] 读取 information_schema 失败，时区对按未登记处理：${e?.message ?? e}`));
    }

    // 预期差异：同一列的 DROP COLUMN + ADD COLUMN 成对出现，实体要 timestamp，
    // 而库里实际是 timestamptz —— 这是时区治理的既定结果，DDL 无法对齐。
    const droppedColumnKeys = new Set(
        items.filter(item => item.kind === 'column' && /DROP COLUMN/i.test(item.sql)).map(item => item.key),
    );
    const expectedItems = new Set<number>();
    let expectedPairs = 0;
    items.forEach((item, index) => {
        if (item.kind !== 'column' || !item.declaredType || !item.table || !item.column) {
            return;
        }
        if (!/^TIMESTAMP/i.test(item.declaredType) || !droppedColumnKeys.has(item.key)) {
            return;
        }
        if (columnTypes.get(`${item.table}.${item.column}`) === 'timestamp with time zone') {
            expectedItems.add(index);
            expectedPairs++;
        }
    });

    const registered: SchemaDiffItem[] = [];
    const unregistered: SchemaDiffItem[] = [];
    items.forEach((item, index) => {
        if (expectedItems.has(index)) {
            return;
        }
        if (whitelist.has(item.key)) {
            registered.push(item);
        } else {
            unregistered.push(item);
        }
    });

    log(
        pc.cyan(
            `[schema] ${items.length} 项差异：预期时区 ${expectedPairs} 组（${expectedItems.size} 项）/ ` +
                `已登记 ${registered.length} 项 / 未登记 ${unregistered.length} 项`,
        ),
    );
    if (unregistered.length) {
        console.error(pc.red(`[schema][ERROR] 未登记差异 ${unregistered.length} 项（白名单之外出现的结构漂移）：`));
        for (const item of unregistered) {
            console.error(pc.red(' - ' + item.sql));
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
