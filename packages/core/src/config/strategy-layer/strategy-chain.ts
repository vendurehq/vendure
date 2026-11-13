import { Injector } from '../../common/injector';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

import { StrategyLayerClass, StrategyLayerType } from './strategy-layer';

/**
 * A layer in a chain definition.
 */
export interface StrategyLayerEntry {
    layer: StrategyLayerClass<any>;
    options: unknown;
    priority: number;
}

/**
 * The input to `buildStrategyChain()`. It is a value: each change makes a new definition,
 * because more than one config can hold the same chain.
 */
export interface StrategyChainDefinition {
    base: InjectableStrategy;
    /** The layers in the order in which they were added. */
    entries: StrategyLayerEntry[];
    /** The layers that `removeLayer()` recorded. */
    removed: Array<StrategyLayerClass<any>>;
    /** The priorities that `setLayerPriority()` recorded. */
    priorities: Map<StrategyLayerClass<any>, number>;
}

/**
 * A built chain.
 */
export interface StrategyChain extends StrategyChainDefinition {
    /** The applied layers in call order, with the priorities that are in effect. */
    callOrder: StrategyLayerEntry[];
    /** The base strategy, then the layer instances from the inside out. */
    members: InjectableStrategy[];
}

/**
 * The chain data is kept outside the strategy objects, so the type of a strategy option does
 * not change. The key is the object that `buildStrategyChain()` returns.
 */
const chains = new WeakMap<object, StrategyChain>();

/**
 * The outermost object of a chain. The config option holds it. It sends each method to the
 * outermost layer, and runs `init()` and `destroy()` for all members of the chain. Thus the
 * lifecycle also works when a hand-written wrapper holds the chain and forwards `init()`.
 */
class ComposedStrategy implements InjectableStrategy {
    async init(injector: Injector) {
        for (const member of chains.get(this)?.members ?? []) {
            if (typeof member.init === 'function') {
                await member.init(injector);
            }
        }
    }

    async destroy() {
        for (const member of [...(chains.get(this)?.members ?? [])].reverse()) {
            if (typeof member.destroy === 'function') {
                await member.destroy();
            }
        }
    }
}

/**
 * Returns the chain that the object is the outermost object of, or `undefined`.
 */
export function getStrategyChain(strategy: unknown): StrategyChain | undefined {
    return strategy != null && typeof strategy === 'object' ? chains.get(strategy) : undefined;
}

/**
 * Returns a copy of the definition of the chain, or a new definition with the strategy as base.
 */
export function getChainDefinition(strategy: InjectableStrategy): StrategyChainDefinition {
    const chain = getStrategyChain(strategy);
    if (!chain) {
        return { base: strategy, entries: [], removed: [], priorities: new Map() };
    }
    return {
        base: chain.base,
        entries: [...chain.entries],
        removed: [...chain.removed],
        priorities: new Map(chain.priorities),
    };
}

export function toLayerEntry(layerType: StrategyLayerType<any>): StrategyLayerEntry {
    const entry =
        typeof layerType === 'function'
            ? { layer: layerType, options: undefined, priority: layerType.priority }
            : {
                  layer: layerType.layer,
                  options: layerType.options,
                  priority: layerType.priority ?? layerType.layer.priority,
              };
    if (typeof entry.priority !== 'number' || !Number.isFinite(entry.priority)) {
        throw new Error(
            `The strategy layer "${entry.layer.name}" has no priority. Set a static "priority" number on the class.`,
        );
    }
    return entry;
}

/**
 * Throws if the priority is not a finite number. A sort by `NaN` or `Infinity` gives no stable order.
 */
export function assertValidPriority(priority: number) {
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
        throw new Error(
            `The priority "${String(priority)}" is not valid. A priority must be a finite number.`,
        );
    }
}

/**
 * Creates the layer instances in priority order and returns the outermost object of the chain.
 * A layer with a lower priority number gets the call first. Layers with equal priorities keep the
 * order in which they were added.
 */
export function buildStrategyChain(definition: StrategyChainDefinition): InjectableStrategy {
    const callOrder = definition.entries
        .filter(entry => !definition.removed.includes(entry.layer))
        .map(entry => ({ ...entry, priority: definition.priorities.get(entry.layer) ?? entry.priority }))
        .sort((a, b) => a.priority - b.priority);
    const members: InjectableStrategy[] = [definition.base];
    let inner: InjectableStrategy = definition.base;
    for (const entry of [...callOrder].reverse()) {
        const layer = new (entry.layer as unknown as new () => InjectableStrategy)();
        Object.defineProperty(layer, 'inner', { value: inner });
        Object.defineProperty(layer, 'options', { value: entry.options });
        forwardMissingMembers(layer, inner);
        members.push(layer);
        inner = layer;
    }
    const head = new ComposedStrategy();
    Object.defineProperty(head, 'inner', { value: inner });
    forwardMissingMembers(head, inner);
    chains.set(head, { ...definition, callOrder, members });
    return head;
}

const notForwarded = new Set(['constructor', 'init', 'destroy', 'inner', 'options']);

/**
 * Defines on `layer` each member of `inner` that `layer` does not have. A method calls the method
 * of `inner`. Another member reads the value of `inner`. An assignment to such a member gives the
 * layer its own value, so the layer can set its own state.
 *
 * The property descriptors are used, so no getter of `inner` runs while the chain is built.
 */
function forwardMissingMembers(layer: object, inner: object) {
    const target = inner as Record<string, any>;
    for (const [key, descriptor] of getMemberDescriptors(inner)) {
        if (notForwarded.has(key) || key in layer) {
            continue;
        }
        if (typeof descriptor.value === 'function') {
            Object.defineProperty(layer, key, {
                configurable: true,
                writable: true,
                value: (...args: unknown[]) => target[key](...args),
            });
        } else {
            Object.defineProperty(layer, key, {
                configurable: true,
                get: () => target[key],
                set(this: object, value: unknown) {
                    Object.defineProperty(this, key, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value,
                    });
                },
            });
        }
    }
}

/**
 * Returns the nearest descriptor of each string-keyed member of the object and of its prototypes,
 * without `Object.prototype`.
 */
function getMemberDescriptors(obj: object): Map<string, PropertyDescriptor> {
    const descriptors = new Map<string, PropertyDescriptor>();
    for (
        let current: object | null = obj;
        current && current !== Object.prototype;
        current = Object.getPrototypeOf(current)
    ) {
        for (const key of Object.getOwnPropertyNames(current)) {
            if (!descriptors.has(key)) {
                descriptors.set(key, Object.getOwnPropertyDescriptor(current, key) as PropertyDescriptor);
            }
        }
    }
    return descriptors;
}
