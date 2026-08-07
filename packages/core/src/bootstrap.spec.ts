import { getMetadataArgsStorage } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { runPluginConfigurations } from './bootstrap';
import { CustomFieldConfig } from './config/custom-field/custom-field-types';
import { RuntimeVendureConfig } from './config/vendure-config';
// Importing the core entities registers their `customFields` embedded columns in the
// TypeORM metadata, which is how getEntityNamesWithCustomFields() detects the entities
// that support custom fields. Imported for its side effect only.
import './entity/entities';
import { registerCustomEntityFields } from './entity/register-custom-entity-fields';
import { VendurePlugin } from './plugin/vendure-plugin';

/**
 * Registers a `translations` relation (and a matching `customFields` embedded on the
 * translation target) directly in the TypeORM metadata, so we can exercise the different
 * shapes TypeORM allows for a relation target — a constructor closure, a bare string name,
 * or a closure returning a string — without declaring throwaway `@Entity` classes that would
 * pollute the global metadata for every other test in the process. Returns a cleanup fn.
 */
function registerTranslationRelation(baseName: string, type: unknown): () => void {
    const storage = getMetadataArgsStorage();
    const base = { name: baseName };
    const translationTarget = { name: `${baseName}Translation` };
    storage.relations.push({
        target: base,
        propertyName: 'translations',
        relationType: 'one-to-many',
        type,
        isLazy: false,
        options: {},
    } as any);
    storage.embeddeds.push({
        target: translationTarget,
        propertyName: 'customFields',
        prefix: undefined,
        type: () => Object,
    } as any);
    return () => {
        storage.relations.pop();
        storage.embeddeds.pop();
    };
}

function makeConfig(partial: {
    plugins?: RuntimeVendureConfig['plugins'];
    customFields?: Record<string, CustomFieldConfig[]>;
}): RuntimeVendureConfig {
    return { plugins: [], customFields: {}, ...partial } as unknown as RuntimeVendureConfig;
}

describe('runPluginConfigurations()', () => {
    // OSS-408: entities that support custom fields get an empty array pre-initialised so a
    // plugin's `configuration` callback can extend them without a defensive guard.
    it('auto-initialises customFields for entities that support them', async () => {
        const config = makeConfig({});
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toEqual([]);
        expect(config.customFields.Customer).toEqual([]);
    });

    // OSS-408: translation entities also declare a `customFields` embedded (for localized
    // values), but must NOT be auto-initialised — a `config.customFields.<Entity>Translation`
    // entry makes the GraphQL schema builder emit a duplicate `customFields` field on the
    // `*TranslationInput` types ("... can only be defined once").
    it('does not auto-initialise translation entities', async () => {
        const config = makeConfig({});
        await runPluginConfigurations(config);
        expect(config.customFields.ProductTranslation).toBeUndefined();
        expect(config.customFields.CollectionTranslation).toBeUndefined();
    });

    it('does not overwrite an existing customFields entry', async () => {
        const existing: CustomFieldConfig[] = [{ name: 'foo', type: 'string' }];
        const config = makeConfig({ customFields: { Product: existing } });
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toBe(existing);
    });

    // OSS-408: a `translations` relation target need not be a constructor closure. TypeORM also
    // accepts a bare string name and a closure returning one (both used to break circular imports).
    // Building the exclusion set must handle all three, or one such relation anywhere in the
    // process throws `relation.type is not a function` and kills every bootstrap (Michael's review).
    describe('translation relation target shapes', () => {
        let cleanup: (() => void) | undefined;
        afterEach(() => {
            cleanup?.();
            cleanup = undefined;
        });

        it('does not throw on a string relation target', async () => {
            cleanup = registerTranslationRelation('Oss408StringTarget', 'Oss408StringTargetTranslation');
            const config = makeConfig({});
            await expect(runPluginConfigurations(config)).resolves.toBeDefined();
            // and the translation entity is still excluded from auto-init
            expect(config.customFields.Oss408StringTargetTranslation).toBeUndefined();
        });

        it('does not throw on a closure returning a string target, and still excludes it', async () => {
            cleanup = registerTranslationRelation(
                'Oss408ClosureString',
                () => 'Oss408ClosureStringTranslation',
            );
            const config = makeConfig({});
            await expect(runPluginConfigurations(config)).resolves.toBeDefined();
            expect(config.customFields.Oss408ClosureStringTranslation).toBeUndefined();
        });

        it('still excludes a constructor-closure translation target', async () => {
            cleanup = registerTranslationRelation('Oss408Closure', () => ({
                name: 'Oss408ClosureTranslation',
            }));
            const config = makeConfig({});
            await runPluginConfigurations(config);
            expect(config.customFields.Oss408ClosureTranslation).toBeUndefined();
        });
    });

    it('lets a plugin extend a supported entity without a guard', async () => {
        @VendurePlugin({
            configuration: cfg => {
                // No `if (!cfg.customFields.Product) cfg.customFields.Product = []` guard needed.
                cfg.customFields.Product.push({ name: 'fromPlugin', type: 'string' });
                return cfg;
            },
        })
        class TestPlugin {}

        const config = makeConfig({ plugins: [TestPlugin] });
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toContainEqual({ name: 'fromPlugin', type: 'string' });
    });
});

describe('registerCustomEntityFields()', () => {
    // OSS-408 / Michael's review: the translatable branch resolved the translation entity via
    // `(translationsMetadata.type as Function)()`, which threw `type is not a function` for a
    // bare-string relation target — the same crash class fixed in getEntityNamesWithCustomFields().
    // It now reuses getRelationTargetName(), so a translatable entity with a string translations
    // target and real custom fields registers without aborting bootstrap.
    it('does not throw when a translatable entity has a bare-string translations relation target', () => {
        const storage = getMetadataArgsStorage();
        class Oss408RegBase {}
        class Oss408RegBaseTranslation {}
        // Base entity declares a customFields embedded…
        storage.embeddeds.push({
            target: Oss408RegBase,
            propertyName: 'customFields',
            prefix: undefined,
            type: () => Oss408RegBase,
        } as any);
        // …a `translations` relation whose target is a BARE STRING (the crash case)…
        storage.relations.push({
            target: Oss408RegBase,
            propertyName: 'translations',
            relationType: 'one-to-many',
            type: 'Oss408RegBaseTranslation',
            isLazy: false,
            options: {},
        } as any);
        // …and the translation entity also declares a customFields embedded.
        storage.embeddeds.push({
            target: Oss408RegBaseTranslation,
            propertyName: 'customFields',
            prefix: undefined,
            type: () => Oss408RegBaseTranslation,
        } as any);

        const config = {
            customFields: { Oss408RegBase: [{ name: 'foo', type: 'string' }] },
            dbConnectionOptions: { type: 'sqljs' },
        } as unknown as RuntimeVendureConfig;

        try {
            expect(() => registerCustomEntityFields(config)).not.toThrow();
        } finally {
            storage.embeddeds.pop();
            storage.relations.pop();
            storage.embeddeds.pop();
        }
    });
});
