import { Type } from '@vendure/common/lib/shared-types';
import { getMetadataArgsStorage } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from './api/common/request-context';
import { runPluginConfigurations } from './bootstrap';
import { PriceCalculationResult } from './common/types/common-types';
import { CustomFieldConfig } from './config/custom-field/custom-field-types';
import { Logger } from './config/logger/vendure-logger';
import { mergeConfig } from './config/merge-config';
import { ActiveOrderStrategy } from './config/order/active-order-strategy';
import { OrderItemPriceCalculationStrategy } from './config/order/order-item-price-calculation-strategy';
import {
    composeStrategy,
    removeLayer,
    replaceBase,
    setLayerPriority,
} from './config/strategy-layer/compose-strategy';
import { StrategyLayer } from './config/strategy-layer/strategy-layer';
import { addStrategyToList, removeStrategyFromList } from './config/strategy-layer/strategy-list';
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

    // The CLI and Dashboard schema generators pass the raw plugin list, which is not flattened
    // by `preBootstrapConfig`. See #5430.
    it('flattens composed plugins and runs their configuration functions once', async () => {
        let childRuns = 0;

        @VendurePlugin({
            configuration: cfg => {
                childRuns++;
                cfg.customFields.Product.push({ name: 'fromChild', type: 'string' });
                return cfg;
            },
        })
        class ChildPlugin {}

        @VendurePlugin({ plugins: [ChildPlugin] })
        class ParentPlugin {}

        const rawConfig = makeConfig({ plugins: [{ module: ParentPlugin }] });
        await runPluginConfigurations(rawConfig);
        expect(rawConfig.plugins).toEqual([ChildPlugin, { module: ParentPlugin }]);
        expect(rawConfig.customFields.Product).toEqual([{ name: 'fromChild', type: 'string' }]);
        expect(childRuns).toBe(1);

        const flattenedConfig = makeConfig({ plugins: [ChildPlugin, ParentPlugin] });
        await runPluginConfigurations(flattenedConfig);
        expect(flattenedConfig.plugins).toEqual([ChildPlugin, ParentPlugin]);
        expect(childRuns).toBe(2);
    });
});

describe('runPluginConfigurations() with strategy layers', () => {
    type PriceArgs = Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>;
    let calls: string[] = [];

    class TestBasePrice implements OrderItemPriceCalculationStrategy {
        constructor(private readonly label = 'TestBasePrice') {}
        calculateUnitPrice(): PriceCalculationResult {
            calls.push(this.label);
            return { price: 0, priceIncludesTax: false };
        }
    }

    function priceLayer(name: string, priority: number) {
        const layer = class extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
            static priority = priority;
            async calculateUnitPrice(...args: PriceArgs) {
                calls.push(name);
                return this.inner.calculateUnitPrice(...args);
            }
        };
        Object.defineProperty(layer, 'name', { value: name });
        return layer;
    }

    function layerPlugin(layer: ReturnType<typeof priceLayer>) {
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.orderItemPriceCalculationStrategy = composeStrategy(
                    layer,
                    cfg.orderOptions.orderItemPriceCalculationStrategy,
                );
                return cfg;
            },
        })
        class LayerPlugin {}
        return LayerPlugin;
    }

    function makeLayerConfig(
        plugins: RuntimeVendureConfig['plugins'],
        strategy: OrderItemPriceCalculationStrategy = new TestBasePrice(),
    ): RuntimeVendureConfig {
        return {
            ...makeConfig({ plugins }),
            orderOptions: { orderItemPriceCalculationStrategy: strategy },
        } as unknown as RuntimeVendureConfig;
    }

    async function callOrder(config: RuntimeVendureConfig) {
        calls = [];
        await config.orderOptions.orderItemPriceCalculationStrategy.calculateUnitPrice(
            ...([{} as RequestContext, {}, {}, {}, 1] as unknown as PriceArgs),
        );
        return calls;
    }

    const Layer100 = priceLayer('Layer100', 100);
    const Layer200 = priceLayer('Layer200', 200);
    const Layer300 = priceLayer('Layer300', 300);
    const Plugin100 = layerPlugin(Layer100);
    const Plugin200 = layerPlugin(Layer200);
    const Plugin300 = layerPlugin(Layer300);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('orders the layers by priority with each order of the plugins array', async () => {
        const orders = [
            [Plugin100, Plugin200, Plugin300],
            [Plugin100, Plugin300, Plugin200],
            [Plugin200, Plugin100, Plugin300],
            [Plugin200, Plugin300, Plugin100],
            [Plugin300, Plugin100, Plugin200],
            [Plugin300, Plugin200, Plugin100],
        ];
        for (const plugins of orders) {
            const config = await runPluginConfigurations(makeLayerConfig(plugins));
            expect(await callOrder(config)).toEqual(['Layer100', 'Layer200', 'Layer300', 'TestBasePrice']);
        }
    });

    it('does not change the chain when the configuration functions run again', async () => {
        const config = await runPluginConfigurations(makeLayerConfig([Plugin200, Plugin100, Plugin200]));
        const chain = config.orderOptions.orderItemPriceCalculationStrategy;
        await runPluginConfigurations(config);
        expect(config.orderOptions.orderItemPriceCalculationStrategy).toBe(chain);
        expect(await callOrder(config)).toEqual(['Layer100', 'Layer200', 'TestBasePrice']);
    });

    it('logs each chain with the layers in call order', async () => {
        const info = vi.spyOn(Logger, 'info');
        await runPluginConfigurations(makeLayerConfig([Plugin300, Plugin100]));
        expect(info).toHaveBeenCalledWith(
            'Strategy chain "orderOptions.orderItemPriceCalculationStrategy": Layer100 -> Layer300 -> TestBasePrice',
        );
    });

    it('does not log when no strategy is composed', async () => {
        const info = vi.spyOn(Logger, 'info');
        const warn = vi.spyOn(Logger, 'warn');
        await runPluginConfigurations(makeLayerConfig([]));
        expect(info).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns when a plugin replaces a chain with a plain strategy', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.orderItemPriceCalculationStrategy = new TestBasePrice('Replaced');
                return cfg;
            },
        })
        class ReplacingPlugin {}

        const config = await runPluginConfigurations(
            makeLayerConfig([Plugin100, Plugin200, ReplacingPlugin, Plugin300]),
        );
        expect(warn).toHaveBeenCalledWith(
            'The plugin "ReplacingPlugin" replaced "orderOptions.orderItemPriceCalculationStrategy" and ' +
                'dropped the layers Layer100, Layer200. To change only the base strategy, use replaceBase(). ' +
                'To add a layer, use composeStrategy().',
        );
        expect(await callOrder(config)).toEqual(['Layer300', 'Replaced']);
    });

    it('warns about a lost removal and a lost priority when a plugin replaces a chain', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.orderItemPriceCalculationStrategy = new TestBasePrice('Replaced');
                return cfg;
            },
        })
        class ReplacingPlugin {}

        const projectStrategy = removeLayer<OrderItemPriceCalculationStrategy>(
            setLayerPriority<OrderItemPriceCalculationStrategy>(new TestBasePrice(), Layer300, 50),
            Layer200,
        );
        await runPluginConfigurations(makeLayerConfig([Plugin100, ReplacingPlugin], projectStrategy));
        expect(warn).toHaveBeenCalledWith(
            'The plugin "ReplacingPlugin" replaced "orderOptions.orderItemPriceCalculationStrategy" and ' +
                'dropped the layers Layer100 and the removal of Layer200 and the priority of Layer300. ' +
                'To change only the base strategy, use replaceBase(). To add a layer, use composeStrategy().',
        );
    });

    it('keeps the layers when a plugin uses replaceBase()', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.orderItemPriceCalculationStrategy = replaceBase(
                    cfg.orderOptions.orderItemPriceCalculationStrategy,
                    new TestBasePrice('Replaced'),
                );
                return cfg;
            },
        })
        class ReplacingPlugin {}

        const config = await runPluginConfigurations(
            makeLayerConfig([Plugin200, Plugin100, ReplacingPlugin]),
        );
        expect(warn).not.toHaveBeenCalled();
        expect(await callOrder(config)).toEqual(['Layer100', 'Layer200', 'Replaced']);
    });

    it('warns about two layers with the same priority and keeps plugin order', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        const PluginA = layerPlugin(priceLayer('LayerA', 100));
        const PluginB = layerPlugin(priceLayer('LayerB', 100));

        const config = await runPluginConfigurations(makeLayerConfig([PluginB, PluginA]));
        expect(warn).toHaveBeenCalledWith(
            'The strategy layers "LayerB" and "LayerA" of "orderOptions.orderItemPriceCalculationStrategy" ' +
                'have the same priority (100), so they run in plugin order. ' +
                'Set the priority of one of them in the project config to remove this warning.',
        );
        expect(await callOrder(config)).toEqual(['LayerB', 'LayerA', 'TestBasePrice']);
    });

    it('removes a plugin layer with removeLayer() in the project config', async () => {
        const config = await runPluginConfigurations(
            makeLayerConfig([Plugin100, Plugin200, Plugin300], removeLayer<OrderItemPriceCalculationStrategy>(new TestBasePrice(), Layer200)),
        );
        expect(await callOrder(config)).toEqual(['Layer100', 'Layer300', 'TestBasePrice']);
    });

    it('changes the priority of a plugin layer with setLayerPriority() in the project config', async () => {
        const config = await runPluginConfigurations(
            makeLayerConfig(
                [Plugin100, Plugin200, Plugin300],
                setLayerPriority<OrderItemPriceCalculationStrategy>(new TestBasePrice(), Layer100, 250),
            ),
        );
        expect(await callOrder(config)).toEqual(['Layer200', 'Layer100', 'Layer300', 'TestBasePrice']);
    });

    it('uses the priority from with() in the project config for a plugin layer', async () => {
        const projectStrategy = composeStrategy<OrderItemPriceCalculationStrategy>(
            Layer300.with(undefined, { priority: 50 }),
            new TestBasePrice(),
        );
        const config = await runPluginConfigurations(
            makeLayerConfig([Plugin100, Plugin200, Plugin300], projectStrategy),
        );
        expect(await callOrder(config)).toEqual(['Layer300', 'Layer100', 'Layer200', 'TestBasePrice']);
    });

    it('keeps the chain through mergeConfig()', async () => {
        const projectConfig = mergeConfig(makeLayerConfig([Plugin100, Plugin200]), {
            orderOptions: {
                orderItemPriceCalculationStrategy: removeLayer<OrderItemPriceCalculationStrategy>(new TestBasePrice(), Layer100),
            },
        });
        @VendurePlugin({ configuration: cfg => mergeConfig(cfg, {}) })
        class NewObjectPlugin {}
        projectConfig.plugins.push(NewObjectPlugin);

        const warn = vi.spyOn(Logger, 'warn');
        const config = await runPluginConfigurations(projectConfig);
        expect(warn).not.toHaveBeenCalled();
        expect(await callOrder(config)).toEqual(['Layer200', 'TestBasePrice']);
    });
});

describe('runPluginConfigurations() with a strategy list', () => {
    function activeOrderStrategy(name: string) {
        const strategy = class implements ActiveOrderStrategy {
            readonly name = name;
            determineActiveOrder() {
                return Promise.resolve(undefined);
            }
        };
        Object.defineProperty(strategy, 'name', { value: name });
        return strategy;
    }

    const DefaultEntry = activeOrderStrategy('default');
    const EarlyEntry = activeOrderStrategy('early');
    const LateEntry = activeOrderStrategy('late');

    function entryPlugin(entry: () => ActiveOrderStrategy, priority: number) {
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.activeOrderStrategy = addStrategyToList(
                    cfg.orderOptions.activeOrderStrategy,
                    entry(),
                    { priority },
                );
                return cfg;
            },
        })
        class EntryPlugin {}
        return EntryPlugin;
    }

    const EarlyPlugin = entryPlugin(() => new EarlyEntry(), -100);
    const LatePlugin = entryPlugin(() => new LateEntry(), 100);

    function makeListConfig(
        plugins: RuntimeVendureConfig['plugins'],
        list: ActiveOrderStrategy | ActiveOrderStrategy[] = new DefaultEntry(),
    ): RuntimeVendureConfig {
        return {
            ...makeConfig({ plugins }),
            orderOptions: { activeOrderStrategy: list },
        } as unknown as RuntimeVendureConfig;
    }

    const names = (config: RuntimeVendureConfig) =>
        (config.orderOptions.activeOrderStrategy as ActiveOrderStrategy[])
            .map(e => e.name)
            .filter(n => !n.startsWith('removed:'));

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('orders the entries of two plugins by priority with each plugin order', async () => {
        for (const plugins of [
            [EarlyPlugin, LatePlugin],
            [LatePlugin, EarlyPlugin],
        ]) {
            const config = await runPluginConfigurations(makeListConfig(plugins));
            expect(names(config)).toEqual(['early', 'default', 'late']);
        }
    });

    it('removes the default entry with removeStrategyFromList() in the project config', async () => {
        const config = await runPluginConfigurations(
            makeListConfig(
                [LatePlugin, EarlyPlugin],
                removeStrategyFromList(new DefaultEntry(), DefaultEntry),
            ),
        );
        expect(names(config)).toEqual(['early', 'late']);
    });

    it('removes a plugin entry with removeStrategyFromList() in the project config', async () => {
        const config = await runPluginConfigurations(
            makeListConfig([LatePlugin, EarlyPlugin], removeStrategyFromList(new DefaultEntry(), LateEntry)),
        );
        expect(names(config)).toEqual(['early', 'default']);
    });

    it('does not change the list when the configuration functions run again', async () => {
        const config = await runPluginConfigurations(
            makeListConfig([LatePlugin, EarlyPlugin], removeStrategyFromList(new DefaultEntry(), LateEntry)),
        );
        await runPluginConfigurations(config);
        expect(names(config)).toEqual(['early', 'default']);
    });

    it('does not change or log a list without entries from addStrategyToList()', async () => {
        const info = vi.spyOn(Logger, 'info');
        const list = [new DefaultEntry(), new LateEntry()];
        const config = await runPluginConfigurations(makeListConfig([], list));
        expect(config.orderOptions.activeOrderStrategy).toBe(list);
        expect(info).not.toHaveBeenCalled();
    });

    it('warns when a plugin replaces the list', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        @VendurePlugin({
            configuration: cfg => {
                cfg.orderOptions.activeOrderStrategy = [new LateEntry()];
                return cfg;
            },
        })
        class ReplacingPlugin {}

        await runPluginConfigurations(
            makeListConfig(
                [EarlyPlugin, ReplacingPlugin],
                removeStrategyFromList(new DefaultEntry(), LateEntry),
            ),
        );
        expect(warn).toHaveBeenCalledWith(
            'The plugin "ReplacingPlugin" replaced "orderOptions.activeOrderStrategy" and dropped the entries ' +
                'default, early and the removal of late. To add an entry, use addStrategyToList(). ' +
                'To remove an entry, use removeStrategyFromList().',
        );
    });

    it('warns when a plugin removes an entry from the list array in place', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        @VendurePlugin({
            configuration: cfg => {
                (cfg.orderOptions.activeOrderStrategy as ActiveOrderStrategy[]).splice(0, 1);
                return cfg;
            },
        })
        class SplicingPlugin {}

        await runPluginConfigurations(
            makeListConfig([SplicingPlugin], [new DefaultEntry(), new LateEntry()]),
        );
        expect(warn).toHaveBeenCalledWith(
            'The plugin "SplicingPlugin" replaced "orderOptions.activeOrderStrategy" and dropped the entries ' +
                'default. To add an entry, use addStrategyToList(). To remove an entry, use removeStrategyFromList().',
        );
    });

    it('warns about an added entry with the same priority as another entry', async () => {
        const warn = vi.spyOn(Logger, 'warn');
        const config = await runPluginConfigurations(makeListConfig([entryPlugin(() => new LateEntry(), 0)]));
        expect(names(config)).toEqual(['default', 'late']);
        expect(warn).toHaveBeenCalledWith(
            'The entries "default" and "late" of "orderOptions.activeOrderStrategy" have the same priority (0), ' +
                'so they run in plugin order. Give one of them a different priority to remove this warning.',
        );
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
