/**
 * E2E tests for the migrate command
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    generateMigrationOperation,
    revertMigrationOperation,
    runMigrationsOperation,
} from '../src/commands/migrate/migration-operations';

const TEST_PROJECT_DIR = path.join(__dirname, 'fixtures', 'test-project');
const MIGRATIONS_DIR = path.join(TEST_PROJECT_DIR, 'migrations');

describe(
    'Migrate Command E2E',
    () => {
        let originalCwd: string;

        beforeAll(() => {
            // Save the original working directory
            originalCwd = process.cwd();
        });

        beforeEach(async () => {
            // Clean up migrations directory before each test
            await fs.emptyDir(MIGRATIONS_DIR);
            // Clean up test database
            const dbPath = path.join(TEST_PROJECT_DIR, 'test.db');
            if (await fs.pathExists(dbPath)) {
                await fs.remove(dbPath);
            }
        });

        afterAll(async () => {
            // Restore original working directory
            process.chdir(originalCwd);
            // Clean up after tests
            await fs.emptyDir(MIGRATIONS_DIR);
            const dbPath = path.join(TEST_PROJECT_DIR, 'test.db');
            if (await fs.pathExists(dbPath)) {
                await fs.remove(dbPath);
            }
        });

        describe('generateMigrationOperation', () => {
            it('should fail when not in a Vendure project directory', async () => {
                // Run from a non-Vendure directory
                process.chdir(__dirname);

                const result = await generateMigrationOperation({ name: 'test-migration' });

                expect(result.success).toBe(false);
                expect(result.message).toContain('Not in a Vendure project directory');
                expect(result.migrationName).toBeUndefined();
            });

            it('should generate a migration when in a valid Vendure project', async () => {
                // Change to test project directory
                process.chdir(TEST_PROJECT_DIR);

                const result = await generateMigrationOperation({
                    name: 'AddTestEntity',
                    outputDir: MIGRATIONS_DIR,
                });

                expect(result.success).toBe(true);
                expect(result.migrationName).toBeDefined();
                expect(result.message).toContain('New migration generated');

                // Verify migration file was created
                const files = await fs.readdir(MIGRATIONS_DIR);
                const migrationFile = files.find(f => f.includes('AddTestEntity'));
                expect(migrationFile).toBeDefined();
            });

            it('should handle invalid migration names correctly', async () => {
                process.chdir(TEST_PROJECT_DIR);

                const invalidNames = [
                    '123-invalid', // starts with number
                    'test migration', // contains space
                    'test@migration', // special character
                ];

                for (const name of invalidNames) {
                    const result = await generateMigrationOperation({ name });

                    expect(result.success).toBe(false);
                    expect(result.message).toContain(
                        'must contain only letters, numbers, underscores and dashes',
                    );
                    expect(result.migrationName).toBeUndefined();
                }
            });

            it('should accept valid migration names', async () => {
                process.chdir(TEST_PROJECT_DIR);

                const validNames = [
                    'TestMigration',
                    'test-migration',
                    'test_migration',
                    'Migration123',
                    'ab', // minimum 2 characters
                ];

                for (const name of validNames) {
                    const result = await generateMigrationOperation({
                        name,
                        outputDir: MIGRATIONS_DIR,
                    });

                    // Since synchronize is false, generateMigration will create the initial migration
                    // The first time it runs, it will generate all tables
                    // Subsequent runs may report no changes
                    // Both are valid outcomes
                    expect(result.success).toBe(true);
                    expect(result.message).toBeDefined();

                    // Clean up the generated migration file for next iteration
                    const files = await fs.readdir(MIGRATIONS_DIR);
                    for (const file of files) {
                        if (file.includes(name)) {
                            await fs.remove(path.join(MIGRATIONS_DIR, file));
                        }
                    }
                }
            });

            it('should handle missing name parameter', async () => {
                process.chdir(TEST_PROJECT_DIR);

                const result = await generateMigrationOperation({});

                expect(result.success).toBe(false);
                expect(result.message).toContain('Migration name is required');
                expect(result.migrationName).toBeUndefined();
            });

            it('should use custom output directory when specified', async () => {
                process.chdir(TEST_PROJECT_DIR);
                const customDir = path.join(TEST_PROJECT_DIR, 'custom-migrations');
                await fs.ensureDir(customDir);

                try {
                    const result = await generateMigrationOperation({
                        name: 'CustomDirTest',
                        outputDir: customDir,
                    });

                    expect(result.success).toBe(true);

                    // Verify migration was created in custom directory
                    const files = await fs.readdir(customDir);
                    const migrationFile = files.find(f => f.includes('CustomDirTest'));
                    expect(migrationFile).toBeDefined();
                } finally {
                    await fs.remove(customDir);
                }
            });

            it('should handle TypeORM config errors gracefully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Temporarily rename the vendure config to simulate a missing config
                const configPath = path.join(TEST_PROJECT_DIR, 'src', 'vendure-config.ts');
                const backupPath = path.join(TEST_PROJECT_DIR, 'src', 'vendure-config.backup.ts');
                await fs.move(configPath, backupPath);

                try {
                    const result = await generateMigrationOperation({ name: 'FailTest' });

                    expect(result.success).toBe(false);
                    expect(result.message).toBeDefined();
                    expect(result.migrationName).toBeUndefined();
                } finally {
                    await fs.move(backupPath, configPath);
                }
            });
        });

        describe('runMigrationsOperation', () => {
            it('should fail when not in a Vendure project directory', async () => {
                process.chdir(__dirname);

                const result = await runMigrationsOperation();

                expect(result.success).toBe(false);
                expect(result.message).toContain('Not in a Vendure project directory');
                expect(result.migrationsRan).toBeUndefined();
            });

            it('should report no pending migrations when none exist', async () => {
                process.chdir(TEST_PROJECT_DIR);

                const result = await runMigrationsOperation();

                expect(result.success).toBe(true);
                expect(result.message).toContain('No pending migrations found');
                expect(result.migrationsRan).toBeDefined();
                expect(result.migrationsRan).toHaveLength(0);
            });

            it('should run pending migrations successfully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // First generate a migration
                const generateResult = await generateMigrationOperation({
                    name: 'TestMigration',
                    outputDir: MIGRATIONS_DIR,
                });
                expect(generateResult.success).toBe(true);

                // Then run migrations
                const runResult = await runMigrationsOperation();

                expect(runResult.success).toBe(true);
                expect(runResult.message).toContain('Successfully ran');
                expect(runResult.migrationsRan).toBeDefined();
                expect(runResult.migrationsRan?.length).toBeGreaterThan(0);
            });

            it('should handle database connection errors gracefully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Ensure a clean module state before mocking
                vi.resetModules();

                // Mock the loadVendureConfigFile helper to return a config with an invalid database path
                vi.doMock('../src/shared/load-vendure-config-file', async () => {
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

                // Re-import the operation after the mock so that it picks up the mocked helper
                const { runMigrationsOperation: runMigrationsWithInvalidDb } = await import(
                    '../src/commands/migrate/migration-operations'
                );

                const result = await runMigrationsWithInvalidDb();

                expect(result.success).toBe(false);
                expect(result.message).toBeDefined();
                expect(result.migrationsRan).toBeUndefined();

                // Clean up mock for subsequent tests
                vi.unmock('../src/commands/migrate/load-vendure-config-file');
            });
        });

        describe('revertMigrationOperation', () => {
            it('should fail when not in a Vendure project directory', async () => {
                process.chdir(__dirname);

                const result = await revertMigrationOperation();

                expect(result.success).toBe(false);
                expect(result.message).toContain('Not in a Vendure project directory');
            });

            it('should revert the last migration successfully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Generate and run a migration first
                const generateResult = await generateMigrationOperation({
                    name: 'RevertTest',
                    outputDir: MIGRATIONS_DIR,
                });
                expect(generateResult.success).toBe(true);

                const runResult = await runMigrationsOperation();
                expect(runResult.success).toBe(true);

                // Now revert
                const revertResult = await revertMigrationOperation();

                expect(revertResult.success).toBe(true);
                expect(revertResult.message).toBe('Successfully reverted last migration');
            });

            it('should handle no migrations to revert gracefully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Try to revert when no migrations have been run
                const result = await revertMigrationOperation();

                // This might fail or succeed depending on TypeORM behavior
                // The important thing is it doesn't throw and returns a structured result
                expect(result).toHaveProperty('success');
                expect(result).toHaveProperty('message');
            });
        });

        describe('Integration scenarios', () => {
            it('should handle a complete migration workflow', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // 1. Generate first migration
                const generate1 = await generateMigrationOperation({
                    name: 'InitialSchema',
                    outputDir: MIGRATIONS_DIR,
                });
                expect(generate1.success).toBe(true);

                // 2. Run migrations
                const run1 = await runMigrationsOperation();
                expect(run1.success).toBe(true);

                // Since there are no actual schema changes, migrations might be empty
                // This is expected behavior

                // 3. Generate second migration
                const generate2 = await generateMigrationOperation({
                    name: 'AddColumns',
                    outputDir: MIGRATIONS_DIR,
                });
                expect(generate2.success).toBe(true);

                // 4. Try to run migrations again
                const run2 = await runMigrationsOperation();
                expect(run2.success).toBe(true);

                // Since no actual schema changes, this might have 0 migrations
                // which is acceptable
            });

            it('should handle concurrent operations gracefully', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Try to run multiple operations concurrently
                const operations = [
                    generateMigrationOperation({ name: 'Concurrent1', outputDir: MIGRATIONS_DIR }),
                    generateMigrationOperation({ name: 'Concurrent2', outputDir: MIGRATIONS_DIR }),
                    generateMigrationOperation({ name: 'Concurrent3', outputDir: MIGRATIONS_DIR }),
                ];

                const results = await Promise.all(operations);

                // All should complete without throwing
                results.forEach(result => {
                    expect(result).toHaveProperty('success');
                    expect(result).toHaveProperty('message');
                });

                // At least some should succeed
                const successCount = results.filter(r => r.success).length;
                expect(successCount).toBeGreaterThan(0);
            });
        });

        describe('Error recovery', () => {
            it('should recover from interrupted migration generation', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Create a partial migration file to simulate interruption
                const partialFile = path.join(MIGRATIONS_DIR, '1234567890-Partial.ts');
                await fs.writeFile(partialFile, 'export class Partial1234567890 {}');

                // Should still be able to generate new migrations
                const result = await generateMigrationOperation({
                    name: 'RecoveryTest',
                    outputDir: MIGRATIONS_DIR,
                });

                // The operation should complete successfully
                expect(result.success).toBe(true);
                expect(result.message).toBeDefined();
            });

            it('should provide helpful error messages for common issues', async () => {
                process.chdir(TEST_PROJECT_DIR);

                // Test various error scenarios
                const scenarios = [
                    {
                        name: 'generate without name',
                        operation: () => generateMigrationOperation({}),
                        expectedMessage: 'Migration name is required',
                    },
                    {
                        name: 'invalid migration name',
                        operation: () => generateMigrationOperation({ name: '123invalid' }),
                        expectedMessage: 'must contain only letters, numbers, underscores and dashes',
                    },
                ];

                for (const scenario of scenarios) {
                    const result = await scenario.operation();
                    expect(result.success).toBe(false);
                    expect(result.message).toContain(scenario.expectedMessage);
                }
            });
        });
    },
    { timeout: 60_000 },
);
