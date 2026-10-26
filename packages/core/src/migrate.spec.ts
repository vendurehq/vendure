import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Column, DataSource, DefaultNamingStrategy, Entity, NamingStrategyInterface } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VendureEntity } from './entity/base/base.entity';
import {
    flattenReplication,
    generateMigration,
    getTemplate,
    getTranslationTablesGainingUniqueConstraint,
    withDatabase,
} from './migrate';
import { deduplicateTranslations } from './migration-utils/translation-deduplication';
import { VendurePlugin } from './plugin/vendure-plugin';

@Entity()
class ComposedMigrationEntity extends VendureEntity {
    @Column()
    value: string;
}

@VendurePlugin({ entities: [ComposedMigrationEntity] })
class MigrationEntityPlugin {}

@VendurePlugin({ plugins: [MigrationEntityPlugin] })
class CompositeMigrationPlugin {}

/**
 * Integration coverage for the `fromEmpty` (shadow-database) baseline generation. Uses
 * `better-sqlite3` so the test is self-contained and needs no external database server.
 *
 * The key scenario is a database that is *already populated*: a plain generate finds no schema
 * changes and produces nothing (the CLO-188 bug), whereas `fromEmpty` still produces the complete
 * "zero to current" baseline migration.
 */
describe('generateMigration fromEmpty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-migrate-from-empty-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    const outputDir = path.join(tmpDir, 'migrations');

    const config = {
        dbConnectionOptions: {
            type: 'better-sqlite3' as const,
            database: dbPath,
            logging: false as const,
        },
    };

    /** Extracts the `up()` SQL statements from a generated migration file. */
    function extractUpSql(migrationFile: string): string[] {
        const src = fs.readFileSync(migrationFile, 'utf-8');
        const upBody = src.slice(src.indexOf('up(queryRunner'), src.indexOf('public async down'));
        const re = /queryRunner\.query\(`([\s\S]*?)`,\s*undefined\)/g;
        const statements: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = re.exec(upBody)) !== null) {
            statements.push(match[1].replace(/\\`/g, '`'));
        }
        return statements;
    }

    // Populate the on-disk database up front (via a shadow-generated baseline) so the tests below do
    // not depend on execution order.
    beforeAll(async () => {
        const seed = await generateMigration(config, { name: 'seed', outputDir, fromEmpty: true });
        const db = new BetterSqlite3(dbPath);
        db.pragma('foreign_keys = OFF');
        for (const statement of extractUpSql(seed as string)) {
            db.exec(statement);
        }
        db.pragma('foreign_keys = ON');
        db.close();
    }, 60_000);

    afterAll(() => {
        fs.removeSync(tmpDir);
    });

    it('generates a complete baseline against an empty (shadow) database', async () => {
        const migrationFile = await generateMigration(config, {
            name: 'init',
            outputDir,
            fromEmpty: true,
        });

        expect(migrationFile).toBeTruthy();
        const content = fs.readFileSync(migrationFile as string, 'utf-8');
        expect(content).toContain('CREATE TABLE');
        // sanity-check that this is the full core schema, not a handful of tables
        expect(content).toContain('"product"');
        expect(content).toContain('"order"');
        expect(content).toContain('"customer"');
    }, 60_000);

    it('a plain generate against the populated database produces nothing (the bug)', async () => {
        const migrationFile = await generateMigration(config, {
            name: 'plainAttempt',
            outputDir,
            fromEmpty: false,
        });
        expect(migrationFile).toBeUndefined();
    }, 60_000);

    it('fromEmpty against the populated database still produces the full baseline (the fix)', async () => {
        const migrationFile = await generateMigration(config, {
            name: 'shadowAttempt',
            outputDir,
            fromEmpty: true,
        });
        expect(migrationFile).toBeTruthy();
        const content = fs.readFileSync(migrationFile as string, 'utf-8');
        expect(content).toContain('CREATE TABLE');
        expect(content).toContain('"product"');
    }, 60_000);

    it('includes entities from composed plugins', async () => {
        const migrationFile = await generateMigration(
            { ...config, plugins: [CompositeMigrationPlugin] },
            { name: 'composedPlugin', outputDir, fromEmpty: true },
        );

        expect(migrationFile).toBeTruthy();
        expect(fs.readFileSync(migrationFile as string, 'utf-8')).toContain('"composed_migration_entity"');
    }, 60_000);
});

/**
 * Unit coverage for the connection-option transforms that ensure the shadow connection targets the
 * shadow database rather than the configured real database, including the `url` and `replication`
 * configurations that the CI matrix does not exercise.
 */
describe('shadow connection option helpers', () => {
    it('withDatabase overrides the top-level database', () => {
        const out = withDatabase({ type: 'postgres', host: 'h', database: 'real' } as any, 'shadow');
        expect(out.database).toBe('shadow');
    });

    it('withDatabase rewrites the database embedded in a connection url', () => {
        const out = withDatabase(
            { type: 'postgres', url: 'postgres://u:p@host:5432/real?sslmode=require' } as any,
            'shadow_db',
        );
        expect((out as any).url).toBe('postgres://u:p@host:5432/shadow_db?sslmode=require');
        expect(out.database).toBe('shadow_db');
    });

    it('flattenReplication collapses replication.master into the top-level options', () => {
        const out = flattenReplication({
            type: 'postgres',
            replication: {
                master: { host: 'primary', port: 5432, username: 'u', password: 'p', database: 'real' },
                slaves: [{ host: 'replica', port: 5432, username: 'u', password: 'p', database: 'real' }],
            },
        } as any);
        expect((out as any).replication).toBeUndefined();
        expect((out as any).host).toBe('primary');
        expect(out.database).toBe('real');
    });

    it('flattenReplication + withDatabase target the shadow database on the master node', () => {
        const flattened = flattenReplication({
            type: 'postgres',
            replication: { master: { host: 'primary', database: 'real' }, slaves: [] },
        } as any);
        const out = withDatabase(flattened, 'shadow');
        expect((out as any).host).toBe('primary');
        expect(out.database).toBe('shadow');
    });

    it('flattenReplication is a no-op when replication is not configured', () => {
        const input = { type: 'postgres', host: 'h', database: 'real' } as any;
        expect(flattenReplication(input)).toBe(input);
    });
});

/**
 * A minimal stand-in for TypeORM's EntityMetadata. A table whose name ends in `_translation` gets the
 * `languageCode` column and `base` relation which mark a translation entity. Other tables get
 * neither. `columnName` maps a property name to its physical column name, as a naming strategy does.
 */
function metadataFor(...tableNames: string[]) {
    return metadataWithNaming(name => name, ...tableNames);
}

function metadataWithNaming(columnName: (propertyName: string) => string, ...tableNames: string[]) {
    return tableNames.map(tableName => {
        const column = (propertyName: string) => ({ propertyName, databaseName: columnName(propertyName) });
        const isTranslation = tableName.endsWith('_translation');
        const columns = isTranslation
            ? [column('id'), column('updatedAt'), column('languageCode'), column('baseId')]
            : [column('id'), column('updatedAt'), column('slug')];
        return {
            tableName,
            columns,
            findColumnWithPropertyName: (propertyName: string) =>
                columns.find(c => c.propertyName === propertyName),
            findRelationWithPropertyPath: (propertyPath: string) =>
                isTranslation && propertyPath === 'base'
                    ? { joinColumns: [columns.find(c => c.propertyName === 'baseId')] }
                    : undefined,
        };
    }) as any[];
}

const snakeCase = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

describe('getTranslationTablesGainingUniqueConstraint()', () => {
    it('detects the Postgres ADD CONSTRAINT form', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product_translation'), [
            'ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId")',
        ]);
        expect(tables).toEqual(['product_translation']);
    });

    it('detects the MySQL unique index form', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product_translation'), [
            'ALTER TABLE `product_translation` ADD UNIQUE INDEX `IDX_dcc35f0d2b8d422634e878b813` (`languageCode`, `baseId`)',
        ]);
        expect(tables).toEqual(['product_translation']);
    });

    it('detects the SQLite table-recreation form', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product_translation'), [
            'CREATE TABLE "temporary_product_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
                '"languageCode" varchar NOT NULL, "baseId" integer, ' +
                'CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId"))',
            'INSERT INTO "temporary_product_translation"("id", "languageCode", "baseId") SELECT "id", "languageCode", "baseId" FROM "product_translation"',
            'DROP TABLE "product_translation"',
            'ALTER TABLE "temporary_product_translation" RENAME TO "product_translation"',
        ]);
        expect(tables).toEqual(['product_translation']);
    });

    it('only returns tables whose constraint is actually added by this migration', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(
            metadataFor('product_translation', 'collection_translation', 'my_plugin_entity_translation'),
            [
                'ALTER TABLE "collection_translation" ADD CONSTRAINT "UQ_x" UNIQUE ("languageCode", "baseId")',
                'ALTER TABLE "my_plugin_entity_translation" ADD CONSTRAINT "UQ_y" UNIQUE ("languageCode", "baseId")',
                'ALTER TABLE "product_translation" ADD "customFieldsFoo" varchar',
            ],
        );
        expect(tables).toEqual(['collection_translation', 'my_plugin_entity_translation']);
    });

    it('ignores unique constraints over other columns', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product'), [
            'ALTER TABLE "product" ADD CONSTRAINT "UQ_z" UNIQUE ("slug", "channelId")',
        ]);
        expect(tables).toEqual([]);
    });

    it('ignores other unique constraints on a translation table', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product_translation'), [
            'ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_slug" UNIQUE ("slug")',
        ]);
        expect(tables).toEqual([]);
    });

    it('ignores non-translation tables referenced by a translation table recreation (e.g. via FOREIGN KEY)', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(
            metadataFor('product', 'product_translation'),
            [
                'CREATE TABLE "temporary_product_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
                    '"languageCode" varchar NOT NULL, "baseId" integer, ' +
                    'CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId"), ' +
                    'CONSTRAINT "FK_x" FOREIGN KEY ("baseId") REFERENCES "product" ("id") ON DELETE NO ACTION)',
            ],
        );
        expect(tables).toEqual(['product_translation']);
    });

    // OSS-856 — snake_case naming strategies map languageCode/baseId to language_code/base_id
    it('detects the constraint over snake_case physical columns and reports their names', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(
            metadataWithNaming(snakeCase, 'product_translation'),
            ['ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_x" UNIQUE ("language_code", "base_id")'],
        );
        expect(tables).toEqual([
            {
                tableName: 'product_translation',
                columns: { languageCode: 'language_code', baseId: 'base_id', updatedAt: 'updated_at' },
            },
        ]);
    });

    it('detects the snake_case SQLite table-recreation form', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(
            metadataWithNaming(snakeCase, 'product_translation'),
            [
                'CREATE TABLE "temporary_product_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
                    '"language_code" varchar NOT NULL, "base_id" integer, ' +
                    'CONSTRAINT "UQ_x" UNIQUE ("language_code", "base_id"))',
            ],
        );
        expect(tables).toEqual([
            {
                tableName: 'product_translation',
                columns: { languageCode: 'language_code', baseId: 'base_id', updatedAt: 'updated_at' },
            },
        ]);
    });

    it('does not match camelCase identifiers when the physical columns are snake_case', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(
            metadataWithNaming(snakeCase, 'product_translation'),
            ['ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_x" UNIQUE ("languageCode", "baseId")'],
        );
        expect(tables).toEqual([]);
    });

    // OSS-856 — on SQLite, TypeORM recreates a table to add a column, such as a custom field. The
    // recreated table repeats the existing constraint. Generating that migration must not fail for
    // an entity without an updatedAt column.
    it('does not throw for an unrelated SQLite recreation of a translation table without updatedAt', () => {
        const [metadata] = metadataFor('product_translation');
        const findColumn = metadata.findColumnWithPropertyName;
        metadata.findColumnWithPropertyName = (propertyName: string) =>
            propertyName === 'updatedAt' ? undefined : findColumn(propertyName);
        const tables = getTranslationTablesGainingUniqueConstraint(
            [metadata],
            [
                'CREATE TABLE "temporary_product_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
                    '"languageCode" varchar NOT NULL, "baseId" integer, "customFieldsFoo" varchar, ' +
                    'CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId"))',
            ],
        );
        expect(tables).toEqual(['product_translation']);
    });

    it('matches whole table names only', () => {
        const tables = getTranslationTablesGainingUniqueConstraint(metadataFor('product_translation'), [
            'ALTER TABLE "custom_product_translation" ADD CONSTRAINT "UQ_q" UNIQUE ("languageCode", "baseId")',
        ]);
        expect(tables).toEqual([]);
    });
});

describe('getTemplate()', () => {
    const upSqls = ['        await queryRunner.query(`ALTER TABLE "x" ADD "y" varchar`, undefined);'];
    const downSqls = ['        await queryRunner.query(`ALTER TABLE "x" DROP COLUMN "y"`, undefined);'];

    it('prepends a deduplicateTranslations call and its import when translation tables gain the constraint', () => {
        const template = getTemplate('add-unique', 1700000000000, upSqls, downSqls, [
            'product_translation',
            'collection_translation',
        ]);
        expect(template).toContain('import { deduplicateTranslations } from "@vendure/core";');
        const call =
            'await deduplicateTranslations(queryRunner, ["product_translation", "collection_translation"]);';
        expect(template).toContain(call);
        // The call must run before the DDL that creates the constraint.
        expect(template.indexOf(call)).toBeLessThan(template.indexOf(upSqls[0]));
        expect(template.indexOf(call)).toBeGreaterThan(template.indexOf('public async up('));
        expect(template.indexOf(call)).toBeLessThan(template.indexOf('public async down('));
    });

    // OSS-856
    it('passes non-default physical column names through to deduplicateTranslations', () => {
        const template = getTemplate('add-unique', 1700000000000, upSqls, downSqls, [
            'collection_translation',
            {
                tableName: 'product_translation',
                columns: { languageCode: 'language_code', baseId: 'base_id', updatedAt: 'updated_at' },
            },
        ]);
        expect(template).toContain(
            'await deduplicateTranslations(queryRunner, ["collection_translation", ' +
                '{ tableName: "product_translation", columns: { languageCode: "language_code", ' +
                'baseId: "base_id", updatedAt: "updated_at" } }]);',
        );
    });

    // OSS-856
    it('escapes quotes and backslashes in table and column names', () => {
        const targets = [
            "it's_translation",
            { tableName: "o'neil_translation", columns: { languageCode: 'lang\\code', baseId: 'base"id' } },
        ];
        const template = getTemplate('add-unique', 1700000000000, upSqls, downSqls, targets);
        const args = /await deduplicateTranslations\(queryRunner, (.*)\);\n/.exec(template)?.[1];
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        expect(new Function(`return ${String(args)};`)()).toEqual(targets);
    });

    it('generates the plain template when no translation tables gain the constraint', () => {
        const template = getTemplate('add-column', 1700000000000, upSqls, downSqls, []);
        expect(template).not.toContain('deduplicateTranslations');
        expect(template).not.toContain('@vendure/core');
        expect(template).toContain(upSqls[0]);
    });
});

/**
 * Reproduces the column and join column naming of `SnakeNamingStrategy` from the
 * `typeorm-naming-strategies` package, e.g. `languageCode` -> `language_code` and
 * `base` -> `base_id`. The package is not a dependency of `@vendure/core`.
 */
class SnakeCaseNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
    columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
        return snakeCase(embeddedPrefixes.concat(customName ?? propertyName).join('_'));
    }

    joinColumnName(relationName: string, referencedColumnName: string): string {
        return snakeCase(`${relationName}_${referencedColumnName}`);
    }
}

/**
 * End-to-end: product_translation is recreated without the unique constraint, to match a database
 * created before the constraint existed. In the `withDuplicates: true` cases it also holds duplicate
 * rows. `generateMigration` must de-duplicate product_translation, and no other table, before adding
 * the constraint. After the generated steps run, product_translation must hold one row per
 * (baseId, languageCode) and have the constraint. The suite runs with the default naming strategy
 * and with a snake_case strategy, whose physical column names differ from the entity property
 * names (OSS-856).
 */
describe.each([
    {
        naming: 'default',
        namingStrategy: undefined,
        columnName: (name: string) => name,
        expectedTargets: ['product_translation'],
    },
    {
        naming: 'snake_case',
        namingStrategy: new SnakeCaseNamingStrategy(),
        columnName: snakeCase,
        expectedTargets: [
            {
                tableName: 'product_translation',
                columns: { languageCode: 'language_code', baseId: 'base_id', updatedAt: 'updated_at' },
            },
        ],
    },
])(
    'generateMigration de-duplicates translation tables gaining the unique constraint ($naming naming)',
    ({ naming, namingStrategy, columnName, expectedTargets }) => {
        const col = (propertyName: string) => `"${columnName(propertyName)}"`;

        function extractUpSql(migrationFile: string): string[] {
            const src = fs.readFileSync(migrationFile, 'utf-8');
            const upBody = src.slice(src.indexOf('up(queryRunner'), src.indexOf('public async down'));
            const re = /queryRunner\.query\(`([\s\S]*?)`,\s*undefined\)/g;
            const statements: string[] = [];
            let match: RegExpExecArray | null;
            while ((match = re.exec(upBody)) !== null) {
                statements.push(match[1].replace(/\\`/g, '`'));
            }
            return statements;
        }

        /** Evaluates the array which the generated migration passes to `deduplicateTranslations`. */
        function extractDeduplicationTargets(migrationFile: string) {
            const src = fs.readFileSync(migrationFile, 'utf-8');
            const args = /await deduplicateTranslations\(queryRunner, ([\s\S]*?)\);\n/.exec(src)?.[1];
            expect(args).toBeDefined();
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            return new Function(`return ${String(args)};`)();
        }

        describe.each([{ withDuplicates: true }, { withDuplicates: false }])(
            'withDuplicates: $withDuplicates',
            ({ withDuplicates }) => {
                const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vendure-migrate-dedupe-${naming}-`));
                const dbPath = path.join(tmpDir, 'test.sqlite');
                const outputDir = path.join(tmpDir, 'migrations');
                const config = {
                    dbConnectionOptions: {
                        type: 'better-sqlite3' as const,
                        database: dbPath,
                        logging: false as const,
                        namingStrategy,
                    },
                };

                beforeAll(async () => {
                    // Build the current schema, then recreate product_translation without the unique
                    // constraint. This matches a database created before the constraint existed.
                    // Then insert the test rows.
                    const seed = await generateMigration(config, {
                        name: 'seed',
                        outputDir,
                        fromEmpty: true,
                    });
                    const db = new BetterSqlite3(dbPath);
                    db.pragma('foreign_keys = OFF');
                    for (const statement of extractUpSql(seed as string)) {
                        db.exec(statement);
                    }
                    const { sql: createSql } = db
                        .prepare(
                            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_translation'",
                        )
                        .get() as { sql: string };
                    const withoutConstraint = createSql.replace(
                        new RegExp(
                            `,\\s*CONSTRAINT "UQ_[0-9a-f]+" UNIQUE \\(${col('languageCode')}, ${col('baseId')}\\)`,
                        ),
                        '',
                    );
                    expect(withoutConstraint).not.toBe(createSql);
                    db.exec('DROP TABLE "product_translation"');
                    db.exec(withoutConstraint);
                    // The newer duplicate gets the lower id. If `deduplicateTranslations` keeps the newer
                    // duplicate, the row with the latest updatedAt won, not the row with the highest id.
                    const rows = withDuplicates
                        ? [
                              ['2024-06-01 00:00:00', 'en', 'newer duplicate'],
                              ['2024-01-01 00:00:00', 'en', 'older duplicate'],
                              ['2024-01-01 00:00:00', 'de', 'not a duplicate'],
                          ]
                        : [
                              ['2024-01-01 00:00:00', 'en', 'english'],
                              ['2024-01-01 00:00:00', 'de', 'not a duplicate'],
                          ];
                    const insert = db.prepare(
                        `INSERT INTO "product_translation" (${[
                            'createdAt',
                            'updatedAt',
                            'languageCode',
                            'name',
                            'slug',
                            'description',
                            'baseId',
                        ]
                            .map(col)
                            .join(', ')}) VALUES ('2024-01-01 00:00:00', ?, ?, ?, 'p', '', 1)`,
                    );
                    for (const row of rows) {
                        insert.run(...row);
                    }
                    db.close();
                }, 60_000);

                afterAll(() => {
                    fs.removeSync(tmpDir);
                });

                it('emits the de-duplication step for exactly the affected table, and applying it succeeds', async () => {
                    const migrationFile = await generateMigration(config, { name: 'add-unique', outputDir });
                    expect(migrationFile).toBeDefined();
                    const src = fs.readFileSync(migrationFile as string, 'utf-8');
                    expect(src).toContain('import { deduplicateTranslations } from "@vendure/core";');
                    const targets = extractDeduplicationTargets(migrationFile as string);
                    expect(targets).toEqual(expectedTargets);

                    // Run what the migration runs: `deduplicateTranslations` with the generated arguments,
                    // then the generated DDL.
                    const dataSource = await new DataSource({ ...config.dbConnectionOptions }).initialize();
                    const queryRunner = dataSource.createQueryRunner();
                    try {
                        await deduplicateTranslations(queryRunner, targets);
                    } finally {
                        await queryRunner.release();
                        await dataSource.destroy();
                    }
                    const db = new BetterSqlite3(dbPath);
                    db.pragma('foreign_keys = OFF');
                    for (const statement of extractUpSql(migrationFile as string)) {
                        db.exec(statement);
                    }
                    const rows = db
                        .prepare(
                            `SELECT ${col('languageCode')} AS "languageCode", "name" FROM "product_translation" ORDER BY ${col('languageCode')}`,
                        )
                        .all() as Array<{ languageCode: string; name: string }>;
                    expect(rows).toEqual(
                        withDuplicates
                            ? [
                                  { languageCode: 'de', name: 'not a duplicate' },
                                  { languageCode: 'en', name: 'newer duplicate' },
                              ]
                            : [
                                  { languageCode: 'de', name: 'not a duplicate' },
                                  { languageCode: 'en', name: 'english' },
                              ],
                    );
                    const { sql } = db
                        .prepare(
                            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_translation'",
                        )
                        .get() as { sql: string };
                    expect(sql).toContain(`UNIQUE (${col('languageCode')}, ${col('baseId')})`);
                    db.close();
                }, 60_000);
            },
        );
    },
);

// OSS-856
describe('deduplicateTranslations() with a missing column', () => {
    async function withTable(
        rows: string[],
        run: (dataSource: DataSource) => Promise<void>,
        languageCodeColumn = 'languageCode',
    ) {
        const dataSource = await new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            logging: false,
        }).initialize();
        try {
            await dataSource.query(
                'CREATE TABLE "thing_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
                    `"${languageCodeColumn}" varchar NOT NULL, "baseId" integer)`,
            );
            for (const row of rows) {
                await dataSource.query(
                    `INSERT INTO "thing_translation" ("${languageCodeColumn}", "baseId") VALUES ('${row}', 1)`,
                );
            }
            await run(dataSource);
        } finally {
            await dataSource.destroy();
        }
    }

    it('throws a clear error when a key column is missing, before counting duplicates', async () => {
        await withTable(
            [],
            async dataSource => {
                await expect(
                    deduplicateTranslations(dataSource.createQueryRunner(), 'thing_translation'),
                ).rejects.toThrow(
                    'Cannot de-duplicate the thing_translation table: it has no column named "languageCode"',
                );
            },
            'language_code',
        );
    });

    it('does nothing when the table has no duplicates', async () => {
        await withTable(['en', 'de'], async dataSource => {
            await deduplicateTranslations(dataSource.createQueryRunner(), 'thing_translation');
            expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "thing_translation"')).toEqual([
                { count: 2 },
            ]);
        });
    });

    it('throws a clear error when the table has duplicates', async () => {
        await withTable(['en', 'en'], async dataSource => {
            await expect(
                deduplicateTranslations(dataSource.createQueryRunner(), 'thing_translation'),
            ).rejects.toThrow(
                'Cannot de-duplicate the thing_translation table: it has no column named "updatedAt"',
            );
        });
    });
});
