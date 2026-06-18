import { GlobalRegistryContents } from './registry-types.js';

/**
 * There are certain global objects that are used in the configuration and extension
 * of the dashboard. Due to the way that Vite bundles and executes the code,
 * we cannot rely on closures over variables in the root scope, as the same variable
 * in different bundles will be different instances.
 *
 * This class is used to register and retrieve these global objects.
 */
class GlobalRegistry {
    private static instance: GlobalRegistry;
    private registry: Map<string, any> = new Map();

    constructor() {
        if (!GlobalRegistry.instance) {
            GlobalRegistry.instance = this;
        }
        return GlobalRegistry.instance;
    }

    public register<T extends GlobalRegistryKey>(key: T, value: GlobalRegistryContents[T]) {
        if (!this.registry.has(key)) {
            this.registry.set(key, value);
        }
    }

    public get<T extends GlobalRegistryKey>(key: T): GlobalRegistryContents[T] {
        return this.registry.get(key);
    }

    public set<T extends GlobalRegistryKey>(
        key: T,
        updater: (oldValue: GlobalRegistryContents[T]) => GlobalRegistryContents[T],
    ) {
        const oldValue = this.get(key);
        this.registry.set(key, updater(oldValue));
    }

    public has(key: string): boolean {
        return this.registry.has(key);
    }
}

export type GlobalRegistryKey = keyof GlobalRegistryContents;

const _globalRegistry: GlobalRegistry = (globalThis as any).globalRegistry ?? new GlobalRegistry();
(globalThis as any).globalRegistry = _globalRegistry;

export const globalRegistry = _globalRegistry;
