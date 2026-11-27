/**
 * E2E tests for `vendure migrate generate`, `run` and `revert`. Each runs through the command
 * host against a project with a SQLite database, the way the CLI runs it.
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import type { CommandDefinition } from '@vendure/common/lib/command';
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommandInHarness } from '../src/command-host/__tests__/command-harness.js';
import { generateMigrationDefinition } from '../src/commands/migrate/generate-migration/generate-migration.command.js';
import { revertMigrationDefinition } from '../src/commands/migrate/revert-migration/revert-migration.command.js';
import { runMigrationDefinition } from '../src/commands/migrate/run-migration/run-migration.command.js';

const TEST_PROJECT_DIR = path.join(import.meta.dirname, 'fixtures', 'test-project');
const MIGRATIONS_DIR = path.join(TEST_PROJECT_DIR, 'migrations');

/** Runs a command through the host. `inProject: false` runs it where no project is found. */
function runIn(def: CommandDefinition, input: Record<string, unknown>, { inProject = true } = {}) {
    return runCommandInHarness(def, input, { projectRoot: inProject ? TEST_PROJECT_DIR : undefined });
}

const generate = (input: Record<string, unknown>) => runIn(generateMigrationDefinition, input);
const runPending = () => runIn(runMigrationDefinition, {});

/** Runs `migrate revert` with the consent its preview asks for, as a caller that agreed would. */
async function revertWithConsent() {
    const first = await runIn(revertMigrationDefinition, {});
    const need = first.envelope.needs?.find(n => n.kind === 'consent');
    if (!need || need.kind !== 'consent') {
        return first;
    }
    return runIn(revertMigrationDefinition, { [need.consent]: need.digest });
}

describe('Migrate Command E2E', { timeout: 60_000 }, () => {
    let originalCwd: string;

    beforeAll(() => {
        originalCwd = process.cwd();
    });

    beforeEach(async () => {
        await fs.emptyDir(MIGRATIONS_DIR);
        const dbPath = path.join(TEST_PROJECT_DIR, 'test.db');
        if (await fs.pathExists(dbPath)) {
            await fs.remove(dbPath);
        }
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        await fs.emptyDir(MIGRATIONS_DIR);
        const dbPath = path.join(TEST_PROJECT_DIR, 'test.db');
        if (await fs.pathExists(dbPath)) {
            await fs.remove(dbPath);
        }
    });

    describe('migrate generate', () => {
        it('needs a Vendure project', async () => {
            process.chdir(import.meta.dirname);

            const result = await runIn(
                generateMigrationDefinition,
                { name: 'test-migration' },
                { inProject: false },
            );

            expect(result.envelope.status).toBe('error');
            expect(result.envelope.error?.code).toBe('project.required');
        });

        it('generates a migration in a Vendure project', async () => {
            process.chdir(TEST_PROJECT_DIR);

            const result = await generate({ name: 'AddTestEntity', outputDir: MIGRATIONS_DIR });

            expect(result.envelope.status).toBe('ok');
            expect(result.envelope.output).toMatchObject({
                file: expect.stringContaining('AddTestEntity'),
                outputDir: MIGRATIONS_DIR,
            });
            const files = await fs.readdir(MIGRATIONS_DIR);
            expect(files.find(f => f.includes('AddTestEntity'))).toBeDefined();
        });

        it.each(['123-invalid', 'test migration', 'test@migration', 'a'])(
            'refuses the migration name %j',
            async name => {
                process.chdir(TEST_PROJECT_DIR);

                const result = await generate({ name });

                expect(result.envelope.status).toBe('error');
                expect(result.envelope.error?.code).toBe('input.invalid');
                expect(result.envelope.error?.message).toContain('start with a letter');
            },
        );

        it.each(['TestMigration', 'test-migration', 'test_migration', 'Migration123', 'ab'])(
            'accepts the migration name %j',
            async name => {
                process.chdir(TEST_PROJECT_DIR);

                const result = await generate({ name, outputDir: MIGRATIONS_DIR });

                expect(result.envelope.status).toBe('ok');
            },
        );

        it('asks for the name when it is missing', async () => {
            process.chdir(TEST_PROJECT_DIR);

            const result = await generate({});

            expect(result.envelope.status).toBe('incomplete');
            expect(result.envelope.needs).toEqual([
                expect.objectContaining({ kind: 'input', field: 'name' }),
            ]);
        });

        it('writes to the output directory it is given', async () => {
            process.chdir(TEST_PROJECT_DIR);
            const customDir = path.join(TEST_PROJECT_DIR, 'custom-migrations');
            await fs.ensureDir(customDir);
            try {
                const result = await generate({ name: 'CustomDirTest', outputDir: customDir });

                expect(result.envelope.status).toBe('ok');
                const files = await fs.readdir(customDir);
                expect(files.find(f => f.includes('CustomDirTest'))).toBeDefined();
            } finally {
                await fs.remove(customDir);
            }
        });

        it('fails without a config file', async () => {
            process.chdir(TEST_PROJECT_DIR);
            // Moved out of the project, since the config is found by what a file declares, not by
            // its name.
            const configPath = path.join(TEST_PROJECT_DIR, 'src', 'vendure-config.ts');
            const backupPath = path.join(import.meta.dirname, 'fixtures', '.vendure-config.backup.ts');
            await fs.move(configPath, backupPath);
            try {
                const result = await generate({ name: 'FailTest' });

                expect(result.envelope.error?.code).toBe('migrate.config-unreadable');
            } finally {
                await fs.move(backupPath, configPath);
            }
        });

        it('generates a migration next to a partly written one', async () => {
            process.chdir(TEST_PROJECT_DIR);
            await fs.writeFile(
                path.join(MIGRATIONS_DIR, '1234567890-Partial.ts'),
                'export class Partial1234567890 {}',
            );

            const result = await generate({ name: 'RecoveryTest', outputDir: MIGRATIONS_DIR });

            expect(result.envelope.status).toBe('ok');
        });
    });

    describe('migrate run', () => {
        it('needs a Vendure project', async () => {
            process.chdir(import.meta.dirname);

            const result = await runIn(runMigrationDefinition, {}, { inProject: false });

            expect(result.envelope.error?.code).toBe('project.required');
        });

        it('reports no pending migrations when none exist', async () => {
            process.chdir(TEST_PROJECT_DIR);

            const result = await runPending();

            // A database with no tables is not "out of sync": every table is pending because the
            // project has not been set up yet.
            expect(result.envelope).toMatchObject({
                status: 'ok',
                output: { migrationsRan: [], diagnostics: [] },
            });
        });

        it('runs pending migrations', async () => {
            process.chdir(TEST_PROJECT_DIR);
            expect(
                (await generate({ name: 'TestMigration', outputDir: MIGRATIONS_DIR })).envelope.status,
            ).toBe('ok');

            const result = await runPending();

            expect(result.envelope.status).toBe('ok');
            expect((result.envelope.output as any).migrationsRan).toEqual([
                expect.stringContaining('TestMigration'),
            ]);
        });

        // #5001 — a `migrations` glob that stopped matching must not be reported as "up to date"
        it('reports unmatched migration patterns when migrations have already been applied', async () => {
            process.chdir(TEST_PROJECT_DIR);
            await generate({ name: 'TestMigration', outputDir: MIGRATIONS_DIR });
            expect((await runPending()).envelope.output).toMatchObject({
                migrationsRan: [expect.any(String)],
            });

            // Simulate the glob resolving to nothing (wrong cwd, or unbuilt `dist/migrations/*.js`)
            await fs.emptyDir(MIGRATIONS_DIR);

            const output = (await runPending()).envelope.output as any;

            expect(output.migrationsRan).toHaveLength(0);
            const text = output.diagnostics.flatMap((d: { lines: string[] }) => d.lines).join('\n');
            expect(output.diagnostics.map((d: { code: string }) => d.code)).toContain(
                'no-migrations-matched',
            );
            expect(text).toContain('No migration files matched');
            // The fixture config uses `path.join(__dirname, ...)`, and an absolute pattern ignores
            // the working directory, so pointing at it would misdirect the user
            expect(text).not.toContain('resolved against the current directory');
        });

        // #5001 — a schema built with `synchronize: true` has no migration history, so an empty
        // `migrations` table must not be taken to mean an empty database
        it('reports schema drift on a database with tables but no migration history', async () => {
            process.chdir(TEST_PROJECT_DIR);
            await generate({ name: 'TestMigration', outputDir: MIGRATIONS_DIR });
            await runPending();

            // Leave the tables in place but clear the history, which is what a `synchronize: true`
            // database looks like, and drop one table so the schema no longer matches the entities.
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(path.join(TEST_PROJECT_DIR, 'test.db'));
            db.exec('DELETE FROM "migrations"');
            db.exec('DROP TABLE "history_entry"');
            db.close();
            await fs.emptyDir(MIGRATIONS_DIR);

            const output = (await runPending()).envelope.output as any;

            const text = output.diagnostics.flatMap((d: { lines: string[] }) => d.lines).join('\n');
            expect(text).toContain('does not match your current configuration');
        });

        it('reports a database it cannot open as a coded error', async () => {
            process.chdir(TEST_PROJECT_DIR);
            vi.resetModules();
            vi.doMock('../src/shared/load-vendure-config-file.js', async () => {
                const { config: realConfig }: { config: any } = await vi.importActual(
                    path.join(TEST_PROJECT_DIR, 'src', 'vendure-config.ts'),
                );
                return {
                    __esModule: true,
                    loadVendureConfigFile: () =>
                        Promise.resolve({
                            ...realConfig,
                            dbConnectionOptions: {
                                ...realConfig.dbConnectionOptions,
                                database: '/nonexistent/dir/test.db',
                            },
                        }),
                };
            });
            try {
                // Imported after the mock, so the command loads the mocked helper.
                const { runMigrationDefinition: withInvalidDb } =
                    await import('../src/commands/migrate/run-migration/run-migration.command.js');

                const result = await runIn(withInvalidDb, {});

                expect(result.envelope.status).toBe('error');
                expect(result.envelope.error?.code).toBe('migrate.run-failed');
            } finally {
                vi.doUnmock('../src/shared/load-vendure-config-file.js');
                vi.resetModules();
            }
        });
    });

    describe('migrate revert', () => {
        it('needs a Vendure project', async () => {
            process.chdir(import.meta.dirname);

            const result = await runIn(revertMigrationDefinition, {}, { inProject: false });

            expect(result.envelope.error?.code).toBe('project.required');
        });

        it('reverts the last migration', async () => {
            process.chdir(TEST_PROJECT_DIR);
            await generate({ name: 'RevertTest', outputDir: MIGRATIONS_DIR });
            await runPending();

            const result = await revertWithConsent();

            expect(result.envelope).toMatchObject({
                status: 'ok',
                output: { reverted: true, migration: expect.stringContaining('RevertTest') },
            });
        });

        it('reverts nothing when no migration has run', async () => {
            process.chdir(TEST_PROJECT_DIR);

            const result = await revertWithConsent();

            expect(result.envelope).toMatchObject({ status: 'ok', output: { reverted: false } });
        });
    });

    describe('a workflow', () => {
        it('generates, runs, and generates again', async () => {
            process.chdir(TEST_PROJECT_DIR);

            expect(
                (await generate({ name: 'InitialSchema', outputDir: MIGRATIONS_DIR })).envelope.status,
            ).toBe('ok');
            expect((await runPending()).envelope.status).toBe('ok');
            // The schema now matches the entities, so there is nothing new to generate.
            expect(
                (await generate({ name: 'AddColumns', outputDir: MIGRATIONS_DIR })).envelope,
            ).toMatchObject({
                status: 'ok',
                output: { file: null },
            });
            expect((await runPending()).envelope.status).toBe('ok');
        });

        it('completes concurrent generations', async () => {
            process.chdir(TEST_PROJECT_DIR);

            const results = await Promise.all(
                ['Concurrent1', 'Concurrent2', 'Concurrent3'].map(name =>
                    generate({ name, outputDir: MIGRATIONS_DIR }),
                ),
            );

            // The database is empty, so each one writes a complete migration of its own.
            expect(results.map(r => r.envelope.status)).toEqual(['ok', 'ok', 'ok']);
            const files = await fs.readdir(MIGRATIONS_DIR);
            for (const name of ['Concurrent1', 'Concurrent2', 'Concurrent3']) {
                expect(files.filter(f => f.includes(name))).toHaveLength(1);
            }
        });
    });
});
