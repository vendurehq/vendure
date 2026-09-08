import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Column, DataSource, Entity } from 'typeorm';
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
 * A minimal stand-in for TypeORM's EntityMetadata. Translation tables carry the
 * `languageCode` and `baseId` columns; anything else is a non-translation table.
 */
function metadataFor(...tableNames: string[]) {
    return tableNames.map(tableName => ({
        tableName,
        columns: (tableName.endsWith('_translation') ? ['id', 'languageCode', 'baseId'] : ['id', 'slug']).map(
            databaseName => ({ databaseName }),
        ),
    })) as any[];
}

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
            "await deduplicateTranslations(queryRunner, ['product_translation', 'collection_translation']);";
        expect(template).toContain(call);
        // The call must run before the DDL that creates the constraint.
        expect(template.indexOf(call)).toBeLessThan(template.indexOf(upSqls[0]));
        expect(template.indexOf(call)).toBeGreaterThan(template.indexOf('public async up('));
        expect(template.indexOf(call)).toBeLessThan(template.indexOf('public async down('));
    });

    it('generates the plain template when no translation tables gain the constraint', () => {
        const template = getTemplate('add-column', 1700000000000, upSqls, downSqls, []);
        expect(template).not.toContain('deduplicateTranslations');
        expect(template).not.toContain('@vendure/core');
        expect(template).toContain(upSqls[0]);
    });
});

/**
 * End-to-end: a database whose product_translation table predates the unique constraint and
 * contains duplicate rows. `generateMigration` must emit a migration that de-duplicates that
 * table (and only that table) before adding the constraint, and running the emitted steps must
 * leave one row per (baseId, languageCode) with the constraint in place.
 */
describe('generateMigration de-duplicates translation tables gaining the unique constraint', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-migrate-dedupe-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    const outputDir = path.join(tmpDir, 'migrations');
    const config = {
        dbConnectionOptions: {
            type: 'better-sqlite3' as const,
            database: dbPath,
            logging: false as const,
        },
    };

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

    beforeAll(async () => {
        // Build the current schema, then rewrite product_translation *without* the unique
        // constraint to simulate a database created before it existed, and plant duplicates.
        const seed = await generateMigration(config, { name: 'seed', outputDir, fromEmpty: true });
        const db = new BetterSqlite3(dbPath);
        db.pragma('foreign_keys = OFF');
        for (const statement of extractUpSql(seed as string)) {
            db.exec(statement);
        }
        const { sql: createSql } = db
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_translation'")
            .get() as { sql: string };
        const withoutConstraint = createSql.replace(
            /,\s*CONSTRAINT "UQ_[0-9a-f]+" UNIQUE \("languageCode", "baseId"\)/,
            '',
        );
        expect(withoutConstraint).not.toBe(createSql);
        db.exec('DROP TABLE "product_translation"');
        db.exec(withoutConstraint);
        db.exec(
            `INSERT INTO "product_translation" ("createdAt", "updatedAt", "languageCode", "name", "slug", "description", "baseId")
             VALUES ('2024-01-01 00:00:00', '2024-01-01 00:00:00', 'en', 'older duplicate', 'p', '', 1),
                    ('2024-01-01 00:00:00', '2024-06-01 00:00:00', 'en', 'newer duplicate', 'p', '', 1),
                    ('2024-01-01 00:00:00', '2024-01-01 00:00:00', 'de', 'not a duplicate', 'p', '', 1)`,
        );
        db.close();
    }, 60_000);

    afterAll(() => {
        fs.removeSync(tmpDir);
    });

    it('emits the de-duplication step for exactly the affected table, and the result is consistent', async () => {
        const migrationFile = await generateMigration(config, { name: 'add-unique', outputDir });
        expect(migrationFile).toBeDefined();
        const src = fs.readFileSync(migrationFile as string, 'utf-8');
        expect(src).toContain('import { deduplicateTranslations } from "@vendure/core";');
        expect(src).toContain("await deduplicateTranslations(queryRunner, ['product_translation']);");

        // Replay what the migration does: the de-duplication helper, then the generated DDL.
        const dataSource = await new DataSource({ ...config.dbConnectionOptions }).initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await deduplicateTranslations(queryRunner, 'product_translation');
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
            .prepare('SELECT "languageCode", "name" FROM "product_translation" ORDER BY "languageCode"')
            .all() as Array<{ languageCode: string; name: string }>;
        expect(rows).toEqual([
            { languageCode: 'de', name: 'not a duplicate' },
            { languageCode: 'en', name: 'newer duplicate' },
        ]);
        const { sql } = db
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_translation'")
            .get() as { sql: string };
        expect(sql).toMatch(/UNIQUE \("languageCode", "baseId"\)/);
        db.close();
    }, 60_000);
});
