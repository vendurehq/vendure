import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Column, Entity } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VendureEntity } from './entity/base/base.entity';
import { flattenReplication, generateMigration, withDatabase } from './migrate';
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
