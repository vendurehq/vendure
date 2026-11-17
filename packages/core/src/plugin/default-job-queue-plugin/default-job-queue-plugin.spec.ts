import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';
import { RuntimeVendureConfig } from '../../config/vendure-config';
import { InMemoryJobBufferStorageStrategy } from '../../job-queue/job-buffer/in-memory-job-buffer-storage-strategy';
import { JobBufferStorageStrategy } from '../../job-queue/job-buffer/job-buffer-storage-strategy';
import { getConfigurationFunction } from '../plugin-metadata';

import type { DefaultJobQueuePlugin as DefaultJobQueuePluginType } from './default-job-queue-plugin';
import { SqlJobBufferStorageStrategy } from './sql-job-buffer-storage-strategy';
import { DefaultJobQueueOptions } from './types';

class CustomBufferStrategy implements JobBufferStorageStrategy {
    add = () => Promise.resolve({} as any);
    bufferSize = () => Promise.resolve({});
    flush = () => Promise.resolve({});
}

let DefaultJobQueuePlugin: typeof DefaultJobQueuePluginType;

beforeAll(async () => {
    // The plugin module reads the global config when it is loaded
    await ensureConfigLoaded();
    ({ DefaultJobQueuePlugin } = await import('./default-job-queue-plugin.js'));
});

async function configureWith(options: DefaultJobQueueOptions, bufferStrategy: JobBufferStorageStrategy) {
    const plugin = DefaultJobQueuePlugin.init(options);
    const config = {
        jobQueueOptions: { jobBufferStorageStrategy: bufferStrategy },
        schedulerOptions: { tasks: [] },
    } as unknown as RuntimeVendureConfig;
    const configure = getConfigurationFunction(plugin);
    const result = await configure!(config);
    return result.jobQueueOptions.jobBufferStorageStrategy;
}

describe('DefaultJobQueuePlugin jobBufferStorageStrategy', () => {
    it('replaces the in-memory default by default', async () => {
        const strategy = await configureWith({}, new InMemoryJobBufferStorageStrategy());
        expect(strategy).toBeInstanceOf(SqlJobBufferStorageStrategy);
    });

    it('keeps a strategy configured by the project by default', async () => {
        const custom = new CustomBufferStrategy();
        expect(await configureWith({}, custom)).toBe(custom);
    });

    it('replaces a configured strategy when useDatabaseForBuffer is true', async () => {
        const strategy = await configureWith({ useDatabaseForBuffer: true }, new CustomBufferStrategy());
        expect(strategy).toBeInstanceOf(SqlJobBufferStorageStrategy);
    });

    it('keeps the in-memory strategy when useDatabaseForBuffer is false', async () => {
        const inMemory = new InMemoryJobBufferStorageStrategy();
        expect(await configureWith({ useDatabaseForBuffer: false }, inMemory)).toBe(inMemory);
    });
});
