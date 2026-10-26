import { generateMigration } from '@vendure/core';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbConfig, TEST_SETUP_TIMEOUT_MS } from '../../../e2e-common/test-config';

/**
 * Exercises the `--from-empty` shadow-database provisioning against the real server databases
 * (Postgres, MySQL, MariaDB) in CI's database matrix. Proves that for each dialect a temporary
 * shadow database is created, diffed to produce the full baseline, and dropped again.
 *
 * The distinguishing "populated database still yields a baseline" logic is dialect-independent and
 * covered by the unit test in `src/migrate.spec.ts`; this test focuses on the parts that only a
 * real server can validate: the dialect-specific `CREATE DATABASE` / `DROP DATABASE` SQL and cleanup.
 */
const dbType = process.env.DB ?? '';
const isServerDb = ['postgres', 'mysql', 'mariadb'].includes(dbType);
const dedicatedDb = 'vendure_from_empty_e2e';

describe.runIf(isServerDb)(`generateMigration --from-empty (${dbType})`, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-from-empty-e2e-'));
    let maintenance: DataSource;

    const isPostgres = dbType === 'postgres';
    const quoted = (name: string) => (isPostgres ? `"${name}"` : `\`${name}\``);

    function serverConnection(): DataSourceOptions {
        // Reuse the same per-dialect connection config as the rest of the e2e suite, so this spec
        // does not drift when CI ports or credentials change. `database` is set explicitly by each
        // caller below; `synchronize` is irrelevant to the raw admin/shadow connections.
        const { synchronize, ...base } = getDbConfig() as any;
        return base as DataSourceOptions;
    }

    async function dropDedicated() {
        if (isPostgres) {
            await maintenance.query(
                'SELECT pg_terminate_backend(pid) FROM pg_stat_activity ' +
                    `WHERE datname = '${dedicatedDb}' AND pid <> pg_backend_pid()`,
            );
        }
        await maintenance.query(`DROP DATABASE IF EXISTS ${quoted(dedicatedDb)}`);
    }

    beforeAll(async () => {
        // Connect to a maintenance database (Postgres: `postgres`; MySQL/MariaDB: none needed) so we
        // can create the dedicated, initially-empty database that the shadow generation points at.
        maintenance = new DataSource({
            ...serverConnection(),
            ...(isPostgres ? { database: 'postgres' } : {}),
            name: 'from-empty-e2e-maintenance',
        } as DataSourceOptions);
        await maintenance.initialize();
        await dropDedicated();
        await maintenance.query(`CREATE DATABASE ${quoted(dedicatedDb)}`);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        if (maintenance?.isInitialized) {
            await dropDedicated();
            await maintenance.destroy();
        }
        fs.removeSync(tmpDir);
    });

    it(
        'generates a complete baseline via a shadow database and cleans it up',
        async () => {
            const config = {
                dbConnectionOptions: { ...serverConnection(), database: dedicatedDb } as DataSourceOptions,
            };

            const migrationFile = await generateMigration(config, {
                name: 'e2eBaseline',
                outputDir: tmpDir,
                fromEmpty: true,
            });

            expect(migrationFile).toBeTruthy();
            const content = fs.readFileSync(migrationFile as string, 'utf-8');
            expect(content).toContain('CREATE TABLE');
            expect(content).toContain('product');
            expect(content).toContain('customer');

            // The shadow database must have been dropped again.
            const rows: Array<{ name: string }> = isPostgres
                ? await maintenance.query(
                      "SELECT datname AS name FROM pg_database WHERE datname LIKE 'vendure_shadow%'",
                  )
                : await maintenance.query(
                      "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'vendure_shadow%'",
                  );
            expect(rows).toHaveLength(0);
        },
        TEST_SETUP_TIMEOUT_MS,
    );
});
