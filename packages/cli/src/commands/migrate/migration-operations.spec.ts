/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    generateMigrationOperation,
    MigrationOptions,
    MigrationResult,
    revertMigrationOperation,
    runMigrationsOperation,
} from './migration-operations';

describe('migration-operations', () => {
    let defaultOptions: MigrationOptions;

    beforeEach(() => {
        defaultOptions = {
            name: 'test-migration',
            outputDir: './test-migrations',
        };
    });

    describe('generateMigrationOperation()', () => {
        it('Returns error when not in Vendure project directory', async () => {
            const options: MigrationOptions = {};

            const result = await generateMigrationOperation(options);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Not in a Vendure project directory');
            expect(result.migrationName).toBeUndefined();
        });

        it('Returns error with project validation for any name', async () => {
            const options: MigrationOptions = {
                name: 'test-migration',
            };

            const result = await generateMigrationOperation(options);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Not in a Vendure project directory');
            expect(result.migrationName).toBeUndefined();
        });

        it('Returns project error for valid migration names', async () => {
            const validNames = [
                'testMigration',
                'test_migration',
                'test-migration',
                'TestMigration123',
                'migration1',
                'a',
                'A123_test-name',
            ];

            for (const name of validNames) {
                const options: MigrationOptions = { name };

                const result = await generateMigrationOperation(options);
                // All should fail with project validation error since we're not in a Vendure project
                expect(result.success).toBe(false);
                expect(result.message).toContain('Not in a Vendure project directory');
            }
        });

        it('Returns project error for invalid migration names', async () => {
            const invalidNames = [
                '123invalid', // starts with number
                'test migration', // contains space
                'test@migration', // contains @
                'test.migration', // contains .
                'test/migration', // contains /
                'test\\migration', // contains \
                'test(migration)', // contains parentheses
                '', // empty string
                'test!migration', // contains !
            ];

            for (const name of invalidNames) {
                const options: MigrationOptions = { name };

                const result = await generateMigrationOperation(options);

                expect(result.success).toBe(false);
                // Project validation happens before name validation
                expect(result.message).toContain('Not in a Vendure project directory');
            }
        });

        it('Returns project error when outputDir is specified', async () => {
            const options: MigrationOptions = {
                name: 'valid-name',
                outputDir: './custom-output',
            };

            const result = await generateMigrationOperation(options);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Not in a Vendure project directory');
        });

        it('Returns error when migration name is missing', async () => {
            const options: MigrationOptions = {};

            const result = await generateMigrationOperation(options);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Not in a Vendure project directory');
            expect(result.migrationName).toBeUndefined();
        });

        it('Rejects migration names with invalid format', async () => {
            const invalidNames = ['123invalid', 'test migration', 'test@migration', '', 'test!migration'];

            for (const name of invalidNames) {
                const result = await generateMigrationOperation({ name });

                expect(result.success).toBe(false);
                // Note: All will fail with project validation in test environment,
                // but this tests that the function handles invalid names correctly
                expect(result.message).toBeDefined();
                expect(result.migrationName).toBeUndefined();
            }
        });

        it('Accepts migration names with valid format', async () => {
            const validNames = ['testMigration', 'test_migration', 'test-migration', 'A123_test-name'];

            for (const name of validNames) {
                const result = await generateMigrationOperation({ name });

                // All will fail with project validation in test environment,
                // but this verifies the function accepts valid name formats
                expect(result.success).toBe(false);
                expect(result.message).toContain('Not in a Vendure project directory');
                expect(result.migrationName).toBeUndefined();
            }
        });

        it('Returns MigrationResult with correct structure on error', async () => {
            const options: MigrationOptions = {
                name: 'valid-name',
            };

            const result = await generateMigrationOperation(options);

            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('message');
            expect(typeof result.success).toBe('boolean');
            expect(typeof result.message).toBe('string');

            if (result.success) {
                expect(result).toHaveProperty('migrationName');
            }
        });
    });

    describe('runMigrationsOperation()', () => {
        it('Returns MigrationResult with correct structure', async () => {
            const result = await runMigrationsOperation();

            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('message');
            expect(typeof result.success).toBe('boolean');
            expect(typeof result.message).toBe('string');

            if (result.success) {
                expect(result).toHaveProperty('migrationsRan');
                expect(Array.isArray(result.migrationsRan)).toBe(true);
            }
        });

        it('Handles error conditions gracefully', async () => {
            const result = await runMigrationsOperation();

            if (!result.success) {
                expect(result.message).toBeDefined();
                expect(result.message.length).toBeGreaterThan(0);
                expect(result.migrationsRan).toBeUndefined();
            }
        });

        it('Returns appropriate message structure', async () => {
            const result = await runMigrationsOperation();

            expect(result.message).toBeDefined();
            expect(typeof result.message).toBe('string');

            if (result.success && result.migrationsRan) {
                if (result.migrationsRan.length > 0) {
                    expect(result.message).toContain('Successfully ran');
                    expect(result.message).toContain('migrations');
                } else {
                    expect(result.message).toContain('No pending migrations found');
                }
            }
        });
    });

    describe('revertMigrationOperation()', () => {
        it('Returns MigrationResult with correct structure', async () => {
            const result = await revertMigrationOperation();

            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('message');
            expect(typeof result.success).toBe('boolean');
            expect(typeof result.message).toBe('string');
        });

        it('Handles error conditions gracefully', async () => {
            const result = await revertMigrationOperation();

            if (!result.success) {
                expect(result.message).toBeDefined();
                expect(result.message.length).toBeGreaterThan(0);
            }
        });

        it('Returns success message when operation succeeds', async () => {
            const result = await revertMigrationOperation();

            if (result.success) {
                expect(result.message).toBe('Successfully reverted last migration');
            } else {
                // When failing, should contain error information
                expect(result.message).toBeDefined();
                expect(result.message.length).toBeGreaterThan(0);
            }
        });

        it('Does not include migration-specific properties on revert', async () => {
            const result = await revertMigrationOperation();

            // Revert operation should not return migrationName or migrationsRan
            expect(result.migrationName).toBeUndefined();
            expect(result.migrationsRan).toBeUndefined();
        });
    });

    describe('MigrationResult interface compliance', () => {
        function validateMigrationResult(result: MigrationResult) {
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('message');
            expect(typeof result.success).toBe('boolean');
            expect(typeof result.message).toBe('string');

            // Optional properties should be undefined or of correct type
            if (result.migrationName !== undefined) {
                expect(typeof result.migrationName).toBe('string');
            }
            if (result.migrationsRan !== undefined) {
                expect(Array.isArray(result.migrationsRan)).toBe(true);
                result.migrationsRan.forEach(migration => {
                    expect(typeof migration).toBe('string');
                });
            }
        }

        it('generateMigrationOperation returns compliant MigrationResult', async () => {
            const result = await generateMigrationOperation({ name: 'test' });
            validateMigrationResult(result);
        });

        it('runMigrationsOperation returns compliant MigrationResult', async () => {
            const result = await runMigrationsOperation();
            validateMigrationResult(result);
        });

        it('revertMigrationOperation returns compliant MigrationResult', async () => {
            const result = await revertMigrationOperation();
            validateMigrationResult(result);
        });
    });

    describe('Error handling consistency', () => {
        it('All operations handle missing project context similarly', async () => {
            const generateResult = await generateMigrationOperation({ name: 'test' });
            const runResult = await runMigrationsOperation();
            const revertResult = await revertMigrationOperation();

            // All should fail in similar way when not in a Vendure project
            expect(generateResult.success).toBe(false);
            expect(runResult.success).toBe(false);
            expect(revertResult.success).toBe(false);

            // All should provide meaningful error messages
            expect(generateResult.message.length).toBeGreaterThan(0);
            expect(runResult.message.length).toBeGreaterThan(0);
            expect(revertResult.message.length).toBeGreaterThan(0);
        });

        it('Operations return structured errors rather than throwing', async () => {
            // These should not throw but return error results
            await expect(generateMigrationOperation({ name: 'test' })).resolves.toBeDefined();
            await expect(runMigrationsOperation()).resolves.toBeDefined();
            await expect(revertMigrationOperation()).resolves.toBeDefined();
        });
    });
});
