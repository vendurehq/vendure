import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { globalSettingsFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import { getGlobalSettingsDocument, updateGlobalSettingsDocument } from './graphql/shared-definitions';

describe('GlobalSettings resolver', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        ...{
            customFields: {
                Customer: [{ name: 'age', type: 'int' }],
            },
        },
    });
    let globalSettings: FragmentOf<typeof globalSettingsFragment>;

    const globalSettingsGuard: ErrorResultGuard<FragmentOf<typeof globalSettingsFragment>> =
        createErrorResultGuard(input => !!input.availableLanguages);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await adminClient.query(updateGlobalSettingsDocument, {
            input: {
                trackInventory: false,
            },
        });
        const result = await adminClient.query(getGlobalSettingsDocument);
        globalSettings = result.globalSettings;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('globalSettings query', () => {
        it('includes basic settings', () => {
            expect(globalSettings.availableLanguages).toEqual([LanguageCode.en]);
            expect(globalSettings.trackInventory).toBe(false);
        });

        it('includes orderProcess', () => {
            expect(globalSettings.serverConfig.orderProcess[0]).toEqual({
                name: 'Created',
                to: ['AddingItems', 'Draft'],
            });
        });

        it('includes permittedAssetTypes', () => {
            expect(globalSettings.serverConfig.permittedAssetTypes).toEqual([
                'image/*',
                'video/*',
                'audio/*',
                '.pdf',
            ]);
        });

        it('includes customFieldConfig', () => {
            expect(globalSettings.serverConfig.customFieldConfig.Customer).toEqual([{ name: 'age' }]);
        });

        it('includes non-internal permission definitions', () => {
            const permissionNames = globalSettings.serverConfig.permissions.map(p => p.name);
            expect(permissionNames).toContain('CreateAdministrator');
            expect(permissionNames).not.toContain('SuperAdmin');
            expect(permissionNames).not.toContain('Owner');
            expect(permissionNames).not.toContain('Authenticated');
        });
    });

    describe('update', () => {
        it('returns error result when removing required language', async () => {
            const { updateGlobalSettings } = await adminClient.query(updateGlobalSettingsDocument, {
                input: {
                    availableLanguages: [LanguageCode.zh],
                },
            });
            globalSettingsGuard.assertErrorResult(updateGlobalSettings);

            expect(updateGlobalSettings.message).toBe(
                'Cannot make language "en" unavailable as it is used as the defaultLanguage by the channel "__default_channel__"',
            );
        });

        it('successful update', async () => {
            const { updateGlobalSettings } = await adminClient.query(updateGlobalSettingsDocument, {
                input: {
                    availableLanguages: [LanguageCode.en, LanguageCode.zh],
                    trackInventory: true,
                },
            });
            globalSettingsGuard.assertSuccess(updateGlobalSettings);

            expect(updateGlobalSettings.availableLanguages).toEqual([LanguageCode.en, LanguageCode.zh]);
            expect(updateGlobalSettings.trackInventory).toBe(true);
        });
    });
});
