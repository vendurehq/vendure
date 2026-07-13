import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { generateMigration } from './migrate';

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

    afterAll(() => {
        fs.removeSync(tmpDir);
    });

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

    it('generates a complete baseline migration against an empty database', async () => {
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

        // Apply the baseline to the on-disk database so it is now populated.
        const db = new BetterSqlite3(dbPath);
        db.pragma('foreign_keys = OFF');
        for (const statement of extractUpSql(migrationFile as string)) {
            db.exec(statement);
        }
        db.pragma('foreign_keys = ON');
        db.close();
    }, 60_000);

    it('a plain generate against the now-populated database produces nothing (the bug)', async () => {
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
});
