import {
    CurrencyCode,
    LanguageCode,
    mergeConfig,
    Permission,
    SettingsStoreEntry,
    SettingsStoreService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { SettingsStoreTestPlugin } from './fixtures/test-plugins/settings-store-test-plugin';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    getSettingsStoreValueDocument,
    getSettingsStoreValuesDocument,
    setSettingsStoreValueDocument,
    setSettingsStoreValuesDocument,
} from './graphql/shared-definitions';

describe('SettingsStore system', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [SettingsStoreTestPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('Global scoped fields', () => {
        it('should set and get a global value', async () => {
            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.globalSetting', value: 'global-value' },
            });
            expect(setSettingsStoreValue.result).toBe(true);
            expect(setSettingsStoreValue.key).toBe('test.globalSetting');
            expect(setSettingsStoreValue.error).toBeNull();

            const { getSettingsStoreValue } = await adminClient.query(getSettingsStoreValueDocument, {
                key: 'test.globalSetting',
            });
            expect(getSettingsStoreValue).toBe('global-value');
        });

        it('should return same global value from different contexts', async () => {
            // Create another user
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Test',
                    lastName: 'Admin',
                    emailAddress: 'test@test.com',
                    password: 'password',
                    roleIds: ['1'], // SuperAdmin role
                },
            });

            // Login as the new user and check global value
            await adminClient.asUserWithCredentials('test@test.com', 'password');

            const { getSettingsStoreValue } = await adminClient.query(getSettingsStoreValueDocument, {
                key: 'test.globalSetting',
            });
            expect(getSettingsStoreValue).toBe('global-value');
        });
    });

    describe('User scoped fields', () => {
        beforeAll(async () => {
            await adminClient.asSuperAdmin();
        });

        it('should store separate values per user', async () => {
            // Set value as superadmin
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.userSetting', value: 'superadmin-value' },
            });

            // Create and switch to another user
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Test2',
                    lastName: 'Admin2',
                    emailAddress: 'test2@test.com',
                    password: 'password',
                    roleIds: ['1'],
                },
            });

            await adminClient.asUserWithCredentials('test2@test.com', 'password');

            // Should not see superadmin's value
            const { getSettingsStoreValue: emptyValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userSetting',
                },
            );
            expect(emptyValue).toBeNull();

            // Set different value for this user
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.userSetting', value: 'test2-value' },
            });

            const { getSettingsStoreValue: userValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userSetting',
                },
            );
            expect(userValue).toBe('test2-value');

            // Switch back to superadmin and verify original value
            await adminClient.asSuperAdmin();
            const { getSettingsStoreValue: superadminValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userSetting',
                },
            );
            expect(superadminValue).toBe('superadmin-value');
        });
    });

    describe('Channel scoped fields', () => {
        const testChannelToken = 'test-channel-token';

        it('should store separate values per channel', async () => {
            await adminClient.asSuperAdmin();

            // Set value in default channel
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.channelSetting', value: 'default-channel-value' },
            });

            const defaultZoneId = 'T_1';
            // Create a new channel
            await adminClient.query(createChannelDocument, {
                input: {
                    code: 'test-channel',
                    token: testChannelToken,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: defaultZoneId,
                    defaultTaxZoneId: defaultZoneId,
                },
            });

            // Switch to new channel
            adminClient.setChannelToken(testChannelToken);

            // Should not see default channel's value
            const { getSettingsStoreValue: emptyValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.channelSetting',
                },
            );
            expect(emptyValue).toBeNull();

            // Set different value for this channel
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.channelSetting', value: 'test-channel-value' },
            });

            const { getSettingsStoreValue: channelValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.channelSetting',
                },
            );
            expect(channelValue).toBe('test-channel-value');

            // Switch back to default channel and verify original value
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { getSettingsStoreValue: defaultValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.channelSetting',
                },
            );
            expect(defaultValue).toBe('default-channel-value');
        });
    });

    describe('User and channel scoped fields', () => {
        const testChannelToken = 'test-channel-token';
        it('should store separate values per user per channel', async () => {
            await adminClient.asSuperAdmin();

            // Set value as superadmin in default channel
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.userAndChannelSetting', value: 'superadmin-default' },
            });

            // Switch to test channel
            adminClient.setChannelToken(testChannelToken);
            // Should not see default channel value
            const { getSettingsStoreValue: emptyValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userAndChannelSetting',
                },
            );
            expect(emptyValue).toBeNull();

            // Set different value for superadmin in test channel
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.userAndChannelSetting', value: 'superadmin-test' },
            });

            // Switch to test2 user in test channel
            await adminClient.asUserWithCredentials('test2@test.com', 'password');
            adminClient.setChannelToken(testChannelToken);

            // Should not see superadmin's value
            const { getSettingsStoreValue: emptyUserValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userAndChannelSetting',
                },
            );
            expect(emptyUserValue).toBeNull();

            // Set value for test2 user in test channel
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.userAndChannelSetting', value: 'test2-test' },
            });

            // Verify all combinations maintain separate values
            const { getSettingsStoreValue: test2TestValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userAndChannelSetting',
                },
            );
            expect(test2TestValue).toBe('test2-test');

            // Switch back to superadmin in test channel
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(testChannelToken);
            const { getSettingsStoreValue: superadminTestValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userAndChannelSetting',
                },
            );
            expect(superadminTestValue).toBe('superadmin-test');

            // Switch to default channel
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { getSettingsStoreValue: superadminDefaultValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.userAndChannelSetting',
                },
            );
            expect(superadminDefaultValue).toBe('superadmin-default');
        });
    });

    describe('Bulk operations', () => {
        it('should get multiple values', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const result = await adminClient.query(getSettingsStoreValuesDocument, {
                keys: ['test.globalSetting', 'test.userSetting'],
            });

            expect(result.getSettingsStoreValues).toEqual({
                'test.globalSetting': 'global-value',
                'test.userSetting': 'superadmin-value',
            });
        });

        it('should set multiple values', async () => {
            await adminClient.asSuperAdmin();

            const { setSettingsStoreValues } = await adminClient.query(setSettingsStoreValuesDocument, {
                inputs: [
                    { key: 'test.bulk1', value: 'bulk-value-1' },
                    { key: 'test.bulk2', value: 'bulk-value-2' },
                ],
            });
            expect(setSettingsStoreValues).toHaveLength(2);
            expect(setSettingsStoreValues[0].result).toBe(true);
            expect(setSettingsStoreValues[0].key).toBe('test.bulk1');
            expect(setSettingsStoreValues[1].result).toBe(true);
            expect(setSettingsStoreValues[1].key).toBe('test.bulk2');

            const result = await adminClient.query(getSettingsStoreValuesDocument, {
                keys: ['test.bulk1', 'test.bulk2'],
            });

            expect(result.getSettingsStoreValues).toEqual({
                'test.bulk1': 'bulk-value-1',
                'test.bulk2': 'bulk-value-2',
            });
        });
    });

    describe('Complex data types', () => {
        it('should handle JSON objects', async () => {
            await adminClient.asSuperAdmin();

            const complexData = {
                nested: {
                    array: [1, 2, 3],
                    boolean: true,
                    null: null,
                },
                string: 'test',
            };

            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.complexData', value: complexData },
            });

            const { getSettingsStoreValue } = await adminClient.query(getSettingsStoreValueDocument, {
                key: 'test.complexData',
            });

            expect(getSettingsStoreValue).toEqual(complexData);
        });
    });

    describe('Validation', () => {
        it('should validate values according to field config', async () => {
            await adminClient.asSuperAdmin();

            // Try to set invalid theme value - should return structured error result
            const invalidResult = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.validatedField', value: 'invalid-value' },
            });
            expect(invalidResult.setSettingsStoreValue.result).toBe(false);
            expect(invalidResult.setSettingsStoreValue.key).toBe('test.validatedField');
            expect(invalidResult.setSettingsStoreValue.error).toContain('Validation failed');

            // Set valid value should work
            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.validatedField', value: 'valid-option' },
            });
            expect(setSettingsStoreValue.result).toBe(true);
            expect(setSettingsStoreValue.error).toBeNull();
        });
    });

    describe('Readonly fields', () => {
        it('should prevent modification of readonly fields', async () => {
            await adminClient.asSuperAdmin();

            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.readonlyField', value: 'attempt-change' },
            });
            expect(setSettingsStoreValue.result).toBe(false);
            expect(setSettingsStoreValue.key).toBe('test.readonlyField');
            expect(setSettingsStoreValue.error).toContain('readonly');
        });
    });

    describe('Permission handling', () => {
        it('should reject users without required permissions', async () => {
            await adminClient.asSuperAdmin();

            // Create a role with limited permissions (no CreateAdministrator permission)
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'limited-role',
                    description: 'Limited permissions role',
                    permissions: [Permission.Authenticated, Permission.ReadAdministrator], // No CreateAdministrator
                },
            });

            // Create a user with limited permissions
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Limited',
                    lastName: 'User',
                    emailAddress: 'limited@test.com',
                    password: 'password',
                    roleIds: [createRole.id],
                },
            });

            // Switch to limited user
            await adminClient.asUserWithCredentials('limited@test.com', 'password');

            // Try to access admin-only field - should get null (no access)
            const { getSettingsStoreValue: deniedValue } = await adminClient.query(
                getSettingsStoreValueDocument,
                {
                    key: 'test.adminOnlyField',
                },
            );
            expect(deniedValue).toBeNull();

            // Try to set admin-only field - should return structured error result
            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.adminOnlyField', value: 'denied-value' },
            });
            expect(setSettingsStoreValue.result).toBe(false);
            expect(setSettingsStoreValue.key).toBe('test.adminOnlyField');
            expect(setSettingsStoreValue.error).toContain('Insufficient permissions');
        });

        it('should allow users with required permissions', async () => {
            await adminClient.asSuperAdmin();

            // SuperAdmin should have all permissions
            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.adminOnlyField', value: 'admin-value' },
            });
            expect(setSettingsStoreValue.result).toBe(true);
            expect(setSettingsStoreValue.key).toBe('test.adminOnlyField');
            expect(setSettingsStoreValue.error).toBeNull();

            const { getSettingsStoreValue } = await adminClient.query(getSettingsStoreValueDocument, {
                key: 'test.adminOnlyField',
            });
            expect(getSettingsStoreValue).toBe('admin-value');
        });
    });

    describe('Invalid key handling', () => {
        it('should gracefully handle getting invalid keys', async () => {
            await adminClient.asSuperAdmin();

            try {
                await adminClient.query(getSettingsStoreValueDocument, {
                    key: 'invalid.nonExistentKey',
                });
                expect.fail('Should have thrown an error for invalid key');
            } catch (error) {
                expect((error as Error).message).toContain('not registered');
            }
        });

        it('should gracefully handle setting invalid keys', async () => {
            await adminClient.asSuperAdmin();

            const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'invalid.nonExistentKey', value: 'some-value' },
            });
            expect(setSettingsStoreValue.result).toBe(false);
            expect(setSettingsStoreValue.key).toBe('invalid.nonExistentKey');
            expect(setSettingsStoreValue.error).toContain('not registered');
        });
    });

    describe('Bulk operations with mixed keys', () => {
        it('should handle bulk get with one valid, one invalid key', async () => {
            await adminClient.asSuperAdmin();

            try {
                await adminClient.query(getSettingsStoreValuesDocument, {
                    keys: ['test.globalSetting', 'invalid.nonExistentKey'],
                });
                expect.fail('Should have thrown an error for invalid key in bulk operation');
            } catch (error) {
                expect((error as Error).message).toContain('not registered');
            }
        });

        it('should handle bulk set with one valid, one invalid key', async () => {
            await adminClient.asSuperAdmin();

            const { setSettingsStoreValues } = await adminClient.query(setSettingsStoreValuesDocument, {
                inputs: [
                    { key: 'test.bulk1', value: 'valid-value' },
                    { key: 'invalid.nonExistentKey', value: 'invalid-value' },
                ],
            });

            expect(setSettingsStoreValues).toHaveLength(2);
            expect(setSettingsStoreValues[0].result).toBe(true);
            expect(setSettingsStoreValues[0].key).toBe('test.bulk1');
            expect(setSettingsStoreValues[0].error).toBeNull();

            expect(setSettingsStoreValues[1].result).toBe(false);
            expect(setSettingsStoreValues[1].key).toBe('invalid.nonExistentKey');
            expect(setSettingsStoreValues[1].error).toContain('not registered');
        });

        it('should handle bulk operations with permission-restricted keys', async () => {
            await adminClient.asSuperAdmin();

            // First set a value as admin
            await adminClient.query(setSettingsStoreValueDocument, {
                input: { key: 'test.adminOnlyField', value: 'admin-bulk-value' },
            });

            // Switch to limited user
            await adminClient.asUserWithCredentials('limited@test.com', 'password');

            // Try bulk get with mix of accessible and restricted keys
            const { getSettingsStoreValues } = await adminClient.query(getSettingsStoreValuesDocument, {
                keys: ['test.globalSetting', 'test.adminOnlyField'],
            });

            // Should only return values for accessible keys
            expect(getSettingsStoreValues).toEqual({
                'test.globalSetting': 'global-value',
                // adminOnlyField should be omitted due to permissions
            });

            // Try bulk set with mix of accessible and restricted keys
            const { setSettingsStoreValues } = await adminClient.query(setSettingsStoreValuesDocument, {
                inputs: [
                    { key: 'test.globalSetting', value: 'new-global-value' },
                    { key: 'test.adminOnlyField', value: 'denied-value' },
                ],
            });

            expect(setSettingsStoreValues).toHaveLength(2);
            expect(setSettingsStoreValues[0].result).toBe(true);
            expect(setSettingsStoreValues[0].key).toBe('test.globalSetting');
            expect(setSettingsStoreValues[0].error).toBeNull();

            expect(setSettingsStoreValues[1].result).toBe(false);
            expect(setSettingsStoreValues[1].key).toBe('test.adminOnlyField');
            expect(setSettingsStoreValues[1].error).toContain('Insufficient permissions');
        });
    });

    describe('Orphaned entries cleanup', () => {
        let settingsStoreService: SettingsStoreService;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            // Get the SettingsStoreService directly from the application
            try {
                settingsStoreService = server.app.get(SettingsStoreService);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to get SettingsStoreService:', error);
                // Try getting it from the service module
                settingsStoreService = server.app.get('SettingsStoreService');
            }
        });

        it('should identify orphaned entries', async () => {
            // Insert some orphaned entries directly into the database
            const connection = server.app.get(TransactionalConnection);
            const repo = connection.rawConnection.getRepository(SettingsStoreEntry);

            // Create entries with keys that don't have field definitions
            await repo.save([
                {
                    key: 'orphaned.oldSetting1',
                    value: 'old-value-1',
                    scope: '',
                    updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
                },
                {
                    key: 'orphaned.oldSetting2',
                    value: { complex: 'object', array: [1, 2, 3] },
                    scope: 'user:123',
                    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
                },
                {
                    key: 'orphaned.recentSetting',
                    value: 'recent-value',
                    scope: '',
                    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
                },
            ]);

            // Test finding orphaned entries older than 7 days
            const orphanedEntries = await settingsStoreService.findOrphanedEntries({
                olderThan: '7d',
                maxDeleteCount: 100,
            });

            expect(orphanedEntries.length).toBe(2); // Should find the 8-day and 10-day old entries
            expect(orphanedEntries.map(e => e.key)).toEqual(
                expect.arrayContaining(['orphaned.oldSetting1', 'orphaned.oldSetting2']),
            );
            expect(orphanedEntries.find(e => e.key === 'orphaned.oldSetting1')?.scope).toBe('');
            expect(orphanedEntries.find(e => e.key === 'orphaned.oldSetting2')?.scope).toBe('user:123');
            expect(orphanedEntries.find(e => e.key === 'orphaned.oldSetting2')?.valuePreview).toContain(
                'complex',
            );
        });

        it('should perform dry-run cleanup', async () => {
            const result = await settingsStoreService.cleanupOrphanedEntries({
                olderThan: '7d',
                dryRun: true,
                maxDeleteCount: 100,
            });

            expect(result.dryRun).toBe(true);
            expect(result.deletedCount).toBe(2); // Should find 2 entries to delete
            expect(result.deletedEntries.length).toBeLessThanOrEqual(10); // Sample entries

            // Verify entries are still in database (dry run shouldn't delete)
            const connection = server.app.get(TransactionalConnection);
            const repo = connection.rawConnection.getRepository(SettingsStoreEntry);
            const remainingEntries = await repo.find({
                where: [{ key: 'orphaned.oldSetting1' }, { key: 'orphaned.oldSetting2' }],
            });
            expect(remainingEntries.length).toBe(2);
        });

        it('should actually cleanup orphaned entries', async () => {
            const result = await settingsStoreService.cleanupOrphanedEntries({
                olderThan: '7d',
                dryRun: false,
                maxDeleteCount: 100,
                batchSize: 50,
            });

            expect(result.dryRun).toBe(false);
            expect(result.deletedCount).toBe(2);
            expect(result.deletedEntries.length).toBeLessThanOrEqual(10);

            // Verify entries are actually deleted from database
            const connection = server.app.get(TransactionalConnection);
            const repo = connection.rawConnection.getRepository(SettingsStoreEntry);
            const remainingEntries = await repo.find({
                where: [{ key: 'orphaned.oldSetting1' }, { key: 'orphaned.oldSetting2' }],
            });
            expect(remainingEntries.length).toBe(0);

            // Recent entry should still exist (not old enough)
            const recentEntry = await repo.findOne({ where: { key: 'orphaned.recentSetting' } });
            expect(recentEntry).not.toBeNull();
        });

        it('should respect age thresholds with ms package formats', async () => {
            // Create entries of different ages
            const connection = server.app.get(TransactionalConnection);
            const repo = connection.rawConnection.getRepository(SettingsStoreEntry);

            await repo.save([
                {
                    key: 'orphaned.veryOld',
                    value: 'very-old',
                    scope: '',
                    updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
                },
                {
                    key: 'orphaned.somewhartOld',
                    value: 'somewhat-old',
                    scope: '',
                    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
                },
            ]);

            // Test different ms package formats
            const old10d = await settingsStoreService.findOrphanedEntries({ olderThan: '10d' });
            expect(old10d.map(e => e.key)).toContain('orphaned.veryOld');
            expect(old10d.map(e => e.key)).not.toContain('orphaned.somewhartOld');

            const old3d = await settingsStoreService.findOrphanedEntries({ olderThan: '3 days' });
            expect(old3d.map(e => e.key)).toContain('orphaned.veryOld');
            expect(old3d.map(e => e.key)).toContain('orphaned.somewhartOld');

            const old1w = await settingsStoreService.findOrphanedEntries({ olderThan: '1w' });
            expect(old1w.map(e => e.key)).toContain('orphaned.veryOld');
            expect(old1w.map(e => e.key)).not.toContain('orphaned.somewhartOld');

            // Cleanup
            await settingsStoreService.cleanupOrphanedEntries({ olderThan: '1d' });
        });
    });
});
