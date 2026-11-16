import { InjectableStrategy } from '../../common/types/injectable-strategy';

import {
    assertValidPriority,
    buildStrategyChain,
    getChainDefinition,
    getStrategyChain,
    toLayerEntry,
} from './strategy-chain';
import { StrategyLayerClass, StrategyLayerType } from './strategy-layer';

/**
 * @description
 * Adds layers to a strategy and returns a strategy of the same type. The layers are sorted by
 * their priority. A layer with a lower number gets the call first. The order of the arguments has no
 * effect.
 *
 * If the strategy is already composed, the layers are added to its chain. A layer class that is
 * already in the chain is not added again, and its options and priority do not change. Because the
 * project config is merged before the `configuration` functions of the plugins run, the options and
 * the priority that the project config gives a layer win.
 *
 * Do not keep a reference to the returned strategy. A later call that changes the chain returns
 * a new object.
 *
 * @example
 * ```ts
 * \@VendurePlugin({
 *     configuration: config => {
 *         config.orderOptions.orderItemPriceCalculationStrategy = composeStrategy(
 *             MinimumPriceLayer.with({ minimum: 100 }),
 *             config.orderOptions.orderItemPriceCalculationStrategy,
 *         );
 *         return config;
 *     },
 * })
 * export class MinimumPricePlugin {}
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage composeStrategy
 */
export function composeStrategy<S extends InjectableStrategy>(
    ...layersAndStrategy: [...Array<StrategyLayerType<S>>, S]
): S {
    const strategy = layersAndStrategy[layersAndStrategy.length - 1] as S;
    const layers = layersAndStrategy.slice(0, -1) as Array<StrategyLayerType<S>>;
    const definition = getChainDefinition(strategy);
    let changed = false;
    for (const layerType of layers) {
        const entry = toLayerEntry(layerType);
        if (!definition.entries.some(e => e.layer === entry.layer)) {
            definition.entries.push(entry);
            changed = true;
        }
    }
    return changed ? (buildStrategyChain(definition) as S) : strategy;
}

/**
 * @description
 * Replaces the base strategy of a composed strategy and keeps its layers. If the strategy is not
 * composed, returns `base`.
 *
 * Use this function when a plugin changes the base strategy of an option, so that the layers of
 * other plugins and of the project config stay in the chain.
 *
 * @example
 * ```ts
 * config.catalogOptions.stockLocationStrategy = replaceBase(
 *     config.catalogOptions.stockLocationStrategy,
 *     new MultiChannelStockLocationStrategy(),
 * );
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage composeStrategy
 */
export function replaceBase<S extends InjectableStrategy>(strategy: S, base: S): S {
    if (!getStrategyChain(strategy)) {
        return base;
    }
    const definition = getChainDefinition(strategy);
    if (definition.base === base) {
        return strategy;
    }
    definition.base = base;
    return buildStrategyChain(definition) as S;
}

/**
 * @description
 * Records that a layer must not be in the chain of the strategy. The record stays with the chain,
 * so the removal also applies to a layer that a plugin adds later. Thus a project can remove the
 * layer of a plugin in the project config.
 *
 * @example
 * ```ts
 * // vendure-config.ts
 * orderOptions: {
 *     orderItemPriceCalculationStrategy: removeLayer(
 *         new DefaultOrderItemPriceCalculationStrategy(),
 *         MinimumPriceLayer,
 *     ),
 * },
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage composeStrategy
 */
export function removeLayer<S extends InjectableStrategy, T extends S = S>(
    strategy: T,
    layer: StrategyLayerClass<S>,
): T {
    const definition = getChainDefinition(strategy);
    if (definition.removed.includes(layer)) {
        return strategy;
    }
    definition.removed.push(layer);
    return buildStrategyChain(definition) as T;
}

/**
 * @description
 * Records a priority for a layer in the chain of the strategy. The recorded priority replaces the
 * priority of the layer, and keeps the options that the plugin gave. Like {@link removeLayer}, the
 * record also applies to a layer that a plugin adds later. It does not add the layer.
 *
 * @example
 * ```ts
 * // vendure-config.ts
 * orderOptions: {
 *     orderItemPriceCalculationStrategy: setLayerPriority(
 *         new DefaultOrderItemPriceCalculationStrategy(),
 *         MinimumPriceLayer,
 *         250,
 *     ),
 * },
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage composeStrategy
 */
export function setLayerPriority<S extends InjectableStrategy, T extends S = S>(
    strategy: T,
    layer: StrategyLayerClass<S>,
    priority: number,
): T {
    assertValidPriority(priority);
    const definition = getChainDefinition(strategy);
    if (definition.priorities.get(layer) === priority) {
        return strategy;
    }
    definition.priorities.set(layer, priority);
    return buildStrategyChain(definition) as T;
}

/**
 * @description
 * Returns the base strategy of a composed strategy. If the strategy is not composed, returns the
 * strategy. Use it in place of an `instanceof` check or a class name check on a configured strategy.
 *
 * @example
 * ```ts
 * const jobQueueStrategy = getBaseStrategy(configService.jobQueueOptions.jobQueueStrategy);
 * if (jobQueueStrategy instanceof InMemoryJobQueueStrategy) {
 *     // ...
 * }
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage composeStrategy
 */
export function getBaseStrategy<S>(strategy: S): S {
    return (getStrategyChain(strategy)?.base as S | undefined) ?? strategy;
}
