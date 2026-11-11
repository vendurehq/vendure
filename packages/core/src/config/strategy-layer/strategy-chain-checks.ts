import { isClassInstance, isObject } from '@vendure/common/lib/shared-utils';

import { Logger } from '../logger/vendure-logger';
import { RuntimeVendureConfig } from '../vendure-config';

import { getStrategyChain, StrategyChain } from './strategy-chain';

/**
 * Returns each composed strategy in the config, by its path, e.g.
 * `orderOptions.orderItemPriceCalculationStrategy`. The strategy options are on the config object
 * or on one of its option objects, so two levels are examined.
 */
export function findStrategyChains(config: RuntimeVendureConfig): Map<string, StrategyChain> {
    const result = new Map<string, StrategyChain>();
    const visit = (path: string, value: unknown) => {
        const chain = getStrategyChain(value);
        if (chain) {
            result.set(path, chain);
        }
    };
    for (const [key, value] of Object.entries(config)) {
        visit(key, value);
        if (isObject(value) && !isClassInstance(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                visit(`${key}.${subKey}`, subValue);
            }
        }
    }
    return result;
}

/**
 * Compares the chains before and after the `configuration` function of a plugin. Logs a warning
 * for each layer and each removal or priority record that the plugin dropped, for example by
 * assigning a plain strategy to the option.
 */
export function warnOnDroppedLayers(
    before: Map<string, StrategyChain>,
    after: Map<string, StrategyChain>,
    pluginName: string,
) {
    for (const [path, oldChain] of before) {
        const newChain = after.get(path);
        if (newChain === oldChain) {
            continue;
        }
        const keeps = (layer: unknown) =>
            !!newChain &&
            (newChain.entries.some(e => e.layer === layer) || newChain.removed.includes(layer as any));
        const droppedLayers = oldChain.callOrder.filter(e => !keeps(e.layer)).map(e => e.layer.name);
        const droppedRemovals = oldChain.removed.filter(l => !newChain?.removed.includes(l)).map(l => l.name);
        const droppedPriorities = [...oldChain.priorities.keys()]
            .filter(l => !newChain?.priorities.has(l))
            .map(l => l.name);
        const parts = [
            droppedLayers.length ? `the layers ${droppedLayers.join(', ')}` : '',
            droppedRemovals.length ? `the removal of ${droppedRemovals.join(', ')}` : '',
            droppedPriorities.length ? `the priority of ${droppedPriorities.join(', ')}` : '',
        ].filter(Boolean);
        if (parts.length) {
            Logger.warn(
                `The plugin "${pluginName}" replaced "${path}" and dropped ${parts.join(' and ')}. ` +
                    'To change only the base strategy, use replaceBase(). To add a layer, use composeStrategy().',
            );
        }
    }
}

/**
 * Logs each composed strategy with its layers in call order. Logs a warning for each two layers
 * with the same priority.
 */
export function logStrategyChains(chains: Map<string, StrategyChain>) {
    for (const [path, chain] of chains) {
        const names = [...chain.callOrder.map(e => e.layer.name), chain.base.constructor.name];
        Logger.info(`Strategy chain "${path}": ${names.join(' -> ')}`);
        for (let i = 1; i < chain.callOrder.length; i++) {
            const previous = chain.callOrder[i - 1];
            const current = chain.callOrder[i];
            if (previous.priority === current.priority) {
                Logger.warn(
                    `The strategy layers "${previous.layer.name}" and "${current.layer.name}" of "${path}" ` +
                        `have the same priority (${current.priority}), so they run in plugin order. ` +
                        'Set the priority of one of them in the project config to remove this warning.',
                );
            }
        }
    }
}
