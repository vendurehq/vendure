import { getMetadataArgsStorage } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { registerCustomFieldEntityMetadata } from '../testing/custom-field-metadata-test-utils';
// Registers the core entities' metadata (side effect only).
import '../entity/entities';

import { resetConfig, setConfig } from './config-helpers';
import { ConfigService } from './config.service';
import { CustomFieldConfig } from './custom-field/custom-field-types';

/**
 * OSS-654: the ConfigService.customFields getter seeds an empty array for every registered entity
 * that supports custom fields but isn't explicitly configured. It used to detect translation
 * entities (which must be excluded) by a `*Translation` name suffix plus a `languageCode` column;
 * it now delegates to the shared, relation-based `getEntityNamesWithCustomFields`, so it can no
 * longer diverge from the bootstrap-time auto-init.
 */
describe('ConfigService.customFields', () => {
    afterEach(() => {
        resetConfig();
    });

    it('seeds supporting entities and excludes translation entities via relation-based detection', async () => {
        class Oss654Base {}
        // A translation target whose name does NOT end in "Translation" — the old name+suffix
        // heuristic would have wrongly seeded it; the relation-based detection excludes it.
        class Oss654Locale {}
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss654Base,
            baseHasCustomFields: true,
            translationTarget: Oss654Locale,
            relationTarget: () => Oss654Locale,
        });
        try {
            await setConfig({
                dbConnectionOptions: { type: 'sqljs', entities: [Oss654Base, Oss654Locale] } as any,
                customFields: {},
            });
            const configService = new ConfigService();
            const customFields = configService.customFields;
            // the base entity supports custom fields → seeded
            expect(customFields.Oss654Base).toEqual([]);
            // the translation target is excluded despite not ending in "Translation"
            expect((customFields as any).Oss654Locale).toBeUndefined();
        } finally {
            cleanup();
        }
    });

    it('seeds an entity that only looks like a translation entity by name + languageCode', async () => {
        // The other direction of the behaviour change: the OLD heuristic excluded any entity whose
        // name ends in "Translation" AND which has a `languageCode` column. The relation-based
        // detection excludes only the *target of a `translations` relation*, so an entity that
        // merely looks like a translation entity — but which nothing points a `translations`
        // relation at — is now correctly seeded. Guards against a regression to the name+column heuristic.
        class Oss654OrphanTranslation {}
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss654OrphanTranslation,
            baseHasCustomFields: true,
        });
        const storage = getMetadataArgsStorage();
        const languageCodeColumn = {
            target: Oss654OrphanTranslation,
            propertyName: 'languageCode',
            mode: 'regular',
            options: {},
        };
        storage.columns.push(languageCodeColumn as any);
        try {
            await setConfig({
                dbConnectionOptions: { type: 'sqljs', entities: [Oss654OrphanTranslation] } as any,
                customFields: {},
            });
            const configService = new ConfigService();
            expect((configService.customFields as any).Oss654OrphanTranslation).toEqual([]);
        } finally {
            const index = storage.columns.indexOf(languageCodeColumn as any);
            if (index !== -1) {
                storage.columns.splice(index, 1);
            }
            cleanup();
        }
    });

    it('does not overwrite an explicitly-configured entity', async () => {
        // The entity must be in `entities` AND support custom fields, so the seeding loop actually
        // runs for it and reaches the "already configured?" guard — otherwise the assertion passes
        // vacuously (the loop body never executes).
        class Oss654Explicit {}
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss654Explicit,
            baseHasCustomFields: true,
        });
        const existing: CustomFieldConfig[] = [{ name: 'foo', type: 'string' }];
        try {
            await setConfig({
                dbConnectionOptions: { type: 'sqljs', entities: [Oss654Explicit] } as any,
                customFields: { Oss654Explicit: existing },
            });
            const configService = new ConfigService();
            // the pre-configured array is left untouched, not replaced with a fresh `[]`
            expect((configService.customFields as any).Oss654Explicit).toBe(existing);
        } finally {
            cleanup();
        }
    });
});
