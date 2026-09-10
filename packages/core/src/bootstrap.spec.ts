import { Type } from '@vendure/common/lib/shared-types';
import { getMetadataArgsStorage } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { runPluginConfigurations } from './bootstrap';
import { CustomFieldConfig } from './config/custom-field/custom-field-types';
import { RuntimeVendureConfig } from './config/vendure-config';
// Importing the core entities registers their `customFields` embedded columns in the
// TypeORM metadata, and populates `coreEntitiesMap` (which `getAllEntities`, and therefore the
// auto-init seeding, reads). Imported for its side effect only.
import './entity/entities';
import { registerCustomEntityFields } from './entity/register-custom-entity-fields';
import { VendurePlugin } from './plugin/vendure-plugin';

/**
 * Registers custom-field-related TypeORM metadata directly in the process-global metadata storage,
 * so specs can exercise the relation-based translation-entity detection in
 * `getEntityNamesWithCustomFields`. Declaring throwaway `@Entity` classes instead would pollute
 * the metadata for every other test in the process.
 *
 * Set `baseHasCustomFields` to push a `customFields` embedded on the `base`. Pass a
 * `translationTarget` to also push a `customFields` embedded on that target and a `translations`
 * relation from `base` to it. That relation is the signal `getEntityNamesWithCustomFields` uses to
 * exclude translation entities.
 *
 * `relationTarget` is the relation's target reference. It accepts the three shapes TypeORM allows:
 * a constructor closure, a bare string name, or a closure returning a string. Omit it for a bare
 * relation with no target.
 *
 * Returns a cleanup fn that removes exactly what it pushed, matched by reference, so that
 * interleaved registrations across tests unwind cleanly regardless of order.
 */
function registerCustomFieldEntityMetadata(options: {
    base: Type<any> | { name: string };
    baseHasCustomFields?: boolean;
    translationTarget?: Type<any> | { name: string };
    relationTarget?: unknown;
}): () => void {
    const storage = getMetadataArgsStorage();
    const pushedEmbeddeds: unknown[] = [];
    const pushedRelations: unknown[] = [];

    const pushEmbedded = (target: Type<any> | { name: string }) => {
        const embedded = { target, propertyName: 'customFields', prefix: undefined, type: () => Object };
        storage.embeddeds.push(embedded as any);
        pushedEmbeddeds.push(embedded);
    };

    if (options.baseHasCustomFields) {
        pushEmbedded(options.base);
    }
    if (options.translationTarget) {
        pushEmbedded(options.translationTarget);
        const relation = {
            target: options.base,
            propertyName: 'translations',
            relationType: 'one-to-many',
            type: options.relationTarget,
            isLazy: false,
            options: {},
        };
        storage.relations.push(relation as any);
        pushedRelations.push(relation);
    }

    return () => {
        for (const embedded of pushedEmbeddeds) {
            const index = storage.embeddeds.indexOf(embedded as any);
            if (index !== -1) {
                storage.embeddeds.splice(index, 1);
            }
        }
        for (const relation of pushedRelations) {
            const index = storage.relations.indexOf(relation as any);
            if (index !== -1) {
                storage.relations.splice(index, 1);
            }
        }
    };
}

/**
 * Registers a `translations` relation and a matching `customFields` embedded on the translation
 * target. This lets the specs exercise the three shapes TypeORM allows for a relation target: a
 * constructor closure, a bare string name, or a closure returning a string. Declaring throwaway
 * `@Entity` classes instead would pollute the global metadata for every other test in the process.
 *
 * Thin adapter over the shared {@link registerCustomFieldEntityMetadata} helper, which also owns
 * the teardown. Returns a cleanup fn.
 */
function registerTranslationRelation(baseName: string, type: unknown): () => void {
    return registerCustomFieldEntityMetadata({
        base: { name: baseName },
        translationTarget: { name: `${baseName}Translation` },
        relationTarget: type,
    });
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

    // OSS-653: runPluginConfigurations is also called directly (CLI/dashboard schema generators,
    // codegen) with a config that never passed through preBootstrapConfig, so `dbConnectionOptions`
    // carries no `entities`. Seeding must still work there — the entity list is derived from
    // `config` (core entities + plugin entities) via getAllEntities, not from dbConnectionOptions.
    it('seeds core entities when the config has no dbConnectionOptions.entities', async () => {
        const config = makeConfig({});
        expect((config as any).dbConnectionOptions?.entities).toBeUndefined();
        await runPluginConfigurations(config);
        expect(config.customFields.Product).toEqual([]);
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

    // OSS-654: detection is relation-based, so it excludes only the target of a `translations`
    // relation. Nothing points such a relation at this entity, so it is seeded like any other,
    // even though its name ends in "Translation" and it has a `languageCode` column. The
    // name + column heuristic this replaced wrongly excluded it.
    it('seeds an entity that only looks like a translation entity by name + languageCode', async () => {
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

        @VendurePlugin({ entities: [Oss654OrphanTranslation] })
        class TestPlugin {}

        try {
            const config = makeConfig({ plugins: [TestPlugin] });
            await runPluginConfigurations(config);
            expect(config.customFields.Oss654OrphanTranslation).toEqual([]);
        } finally {
            const index = storage.columns.indexOf(languageCodeColumn as any);
            if (index !== -1) {
                storage.columns.splice(index, 1);
            }
            cleanup();
        }
    });

    // OSS-653: seeding must be scoped to the entities registered with THIS server, not the global
    // TypeORM metadata storage. An entity whose `customFields` embedded is present in the process
    // (e.g. a second test server in the same process, or an imported-but-uninstalled plugin) but
    // is not in this server's entity list must not produce a phantom `config.customFields` key.
    it('does not seed customFields for entities not registered with this server', async () => {
        class Oss653PhantomEntity {}
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss653PhantomEntity,
            baseHasCustomFields: true,
        });
        try {
            const config = makeConfig({});
            await runPluginConfigurations(config);
            // a real, registered entity is still seeded
            expect(config.customFields.Product).toEqual([]);
            // the phantom entity, present only in the global metadata, is not seeded
            expect(config.customFields.Oss653PhantomEntity).toBeUndefined();
        } finally {
            cleanup();
        }
    });

    // OSS-408: the core point of the feature — a plugin's OWN entity that supports custom fields
    // gets a seeded key too, so the plugin's `configuration` callback can extend it without a
    // defensive guard. Contrast with the phantom-entity test above: seeding happens here because
    // the entity is registered with this server (via the plugin's `entities`), not merely present
    // in the global metadata.
    it('seeds customFields for a plugin-registered entity', async () => {
        class Oss408PluginEntity {}
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss408PluginEntity,
            baseHasCustomFields: true,
        });

        @VendurePlugin({ entities: [Oss408PluginEntity] })
        class TestPlugin {}

        try {
            const config = makeConfig({ plugins: [TestPlugin] });
            await runPluginConfigurations(config);
            expect(config.customFields.Oss408PluginEntity).toEqual([]);
        } finally {
            cleanup();
        }
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
        class Oss408RegBase {}
        class Oss408RegBaseTranslation {}
        // A base entity with a customFields embedded, a `translations` relation whose target is a
        // BARE STRING (the crash case), and a translation entity that also declares a customFields
        // embedded.
        const cleanup = registerCustomFieldEntityMetadata({
            base: Oss408RegBase,
            baseHasCustomFields: true,
            translationTarget: Oss408RegBaseTranslation,
            relationTarget: 'Oss408RegBaseTranslation',
        });

        const config = {
            customFields: { Oss408RegBase: [{ name: 'foo', type: 'string' }] },
            dbConnectionOptions: { type: 'sqljs' },
        } as unknown as RuntimeVendureConfig;

        try {
            expect(() => registerCustomEntityFields(config)).not.toThrow();
        } finally {
            cleanup();
        }
    });
});
