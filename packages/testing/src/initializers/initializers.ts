import { DataSourceOptions } from 'typeorm';

import { TestDbInitializer } from './test-db-initializer';

export type InitializerRegistry = { [type in DataSourceOptions['type']]?: TestDbInitializer<any> };

const initializerRegistry: InitializerRegistry = {};

/**
 * @description
 * Registers a {@link TestDbInitializer} for the given database type. Should be called before invoking
 * {@link createTestEnvironment}.
 *
 * @docsCategory testing
 */
export function registerInitializer(type: DataSourceOptions['type'], initializer: TestDbInitializer<any>) {
    initializerRegistry[type] = initializer;
}

export function getInitializerFor(type: DataSourceOptions['type']): TestDbInitializer<any> {
    const initializer = initializerRegistry[type];
    if (!initializer) {
        throw new Error(`No initializer has been registered for the database type "${type}"`);
    }
    return initializer;
}
