import { isClassInstance, isObject } from '@vendure/common/lib/shared-utils';

import { Logger } from '../logger/vendure-logger';
import { RuntimeVendureConfig } from '../vendure-config';

import { getStrategyChain, StrategyChain } from './strategy-chain';
import {
    getListEntryClass,
    getListEntryPriority,
    hasListEntryPriority,
    RemovedStrategyListEntry,
    sortStrategyList,
    toArray,
} from './strategy-list-entries';

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

/**
 * The strategy options that are ordered lists. Core sorts them by priority.
 */
const strategyListOptions = [['orderOptions', 'activeOrderStrategy']] as const;

/**
 * Returns the entries of each strategy list option, by its path.
 */
export function findStrategyLists(config: RuntimeVendureConfig): Map<string, object[]> {
    const result = new Map<string, object[]>();
    for (const [optionsKey, key] of strategyListOptions) {
        const value = (config[optionsKey] as Record<string, unknown> | undefined)?.[key];
        if (value) {
            result.set(`${optionsKey}.${key}`, [...toArray(value)]);
        }
    }
    return result;
}

function getEntryName(entry: object): string {
    const name = (entry as { name?: unknown }).name;
    return typeof name === 'string' ? name : entry.constructor.name;
}

function getRemovedClasses(list: object[]) {
    return list
        .filter((e): e is RemovedStrategyListEntry => e instanceof RemovedStrategyListEntry)
        .map(e => e.removed);
}

/**
 * Compares the strategy lists before and after the `configuration` function of a plugin. Logs a
 * warning for each entry and each removal record that the plugin dropped, for example by assigning
 * a new array.
 */
export function warnOnDroppedListEntries(
    before: Map<string, object[]>,
    after: Map<string, object[]>,
    pluginName: string,
) {
    for (const [path, oldList] of before) {
        const newList = after.get(path) ?? [];
        const newClasses = newList.map(getListEntryClass);
        const newRemoved = getRemovedClasses(newList);
        const droppedEntries = oldList
            .filter(e => !(e instanceof RemovedStrategyListEntry))
            .filter(
                e => !newClasses.includes(getListEntryClass(e)) && !newRemoved.includes(getListEntryClass(e)),
            )
            .map(getEntryName);
        const droppedRemovals = getRemovedClasses(oldList)
            .filter(c => !newRemoved.includes(c))
            .map(c => c.name);
        const parts = [
            droppedEntries.length ? `the entries ${droppedEntries.join(', ')}` : '',
            droppedRemovals.length ? `the removal of ${droppedRemovals.join(', ')}` : '',
        ].filter(Boolean);
        if (parts.length) {
            Logger.warn(
                `The plugin "${pluginName}" replaced "${path}" and dropped ${parts.join(' and ')}. ` +
                    'To add an entry, use addStrategyToList(). To remove an entry, use removeStrategyFromList().',
            );
        }
    }
}

/**
 * Sorts each strategy list option that has an entry from `addStrategyToList()` or a removal
 * record, and writes the result to the config. Logs each sorted list in call order, and a warning
 * for two entries with the same priority if one of them came from `addStrategyToList()`.
 */
export function sortStrategyLists(config: RuntimeVendureConfig) {
    for (const [optionsKey, key] of strategyListOptions) {
        const options = config[optionsKey] as Record<string, unknown> | undefined;
        const value = options?.[key];
        if (!options || !Array.isArray(value)) {
            continue;
        }
        const list = value as object[];
        if (!list.some(e => e instanceof RemovedStrategyListEntry || hasListEntryPriority(e))) {
            continue;
        }
        const sorted = sortStrategyList(list);
        options[key] = sorted;
        const path = `${optionsKey}.${key}`;
        const entries = sorted.filter(e => !(e instanceof RemovedStrategyListEntry));
        Logger.info(`Strategy list "${path}": ${entries.map(getEntryName).join(', ')}`);
        for (let i = 1; i < entries.length; i++) {
            const previous = entries[i - 1];
            const current = entries[i];
            const priority = getListEntryPriority(current);
            if (
                getListEntryPriority(previous) === priority &&
                (hasListEntryPriority(previous) || hasListEntryPriority(current))
            ) {
                Logger.warn(
                    `The entries "${getEntryName(previous)}" and "${getEntryName(current)}" of "${path}" ` +
                        `have the same priority (${priority}), so they run in plugin order. ` +
                        'Give one of them a different priority to remove this warning.',
                );
            }
        }
    }
}
