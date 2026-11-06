import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Injector } from '../../../common/injector';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { Job } from '../../../job-queue/job';
import { JobBufferStorageStrategy } from '../../../job-queue/job-buffer/job-buffer-storage-strategy';
import { JobBufferService } from '../../../job-queue/job-buffer/job-buffer.service';
import { TestingJobBufferStorageStrategy } from '../../../job-queue/job-buffer/testing-job-buffer-storage-strategy';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { TestingJobQueueStrategy } from '../../../job-queue/testing-job-queue-strategy';
import { ProcessContext, setProcessContext } from '../../../process-context/process-context';
import { BUFFER_SEARCH_INDEX_UPDATES } from '../constants';

import { SearchJobBufferService } from './search-job-buffer.service';

const jobQueueStrategy = new TestingJobQueueStrategy({
    concurrency: 1,
    pollInterval: 10,
    backoffStrategy: () => 0,
});

class SharedJobBufferStorageStrategy implements JobBufferStorageStrategy {
    private delegate = new TestingJobBufferStorageStrategy();

    add(bufferId: string, job: Job) {
        return this.delegate.add(bufferId, job);
    }

    bufferSize(bufferIds?: string[]) {
        return this.delegate.bufferSize(bufferIds);
    }

    flush(bufferIds?: string[]) {
        return this.delegate.flush(bufferIds);
    }
}

describe('SearchJobBufferService', () => {
    let module: TestingModule;
    let jobQueueService: JobQueueService;
    let searchJobBufferService: SearchJobBufferService;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    async function bootstrap(options: {
        context: 'server' | 'worker';
        bufferUpdates: boolean;
        bufferStorage: JobBufferStorageStrategy;
    }) {
        setProcessContext(options.context);
        module = await Test.createTestingModule({
            providers: [
                { provide: ConfigService, useClass: createConfigService(options.bufferStorage) },
                JobQueueService,
                JobBufferService,
                ProcessContext,
                SearchJobBufferService,
                { provide: BUFFER_SEARCH_INDEX_UPDATES, useValue: options.bufferUpdates },
            ],
        }).compile();
        await module.init();
        jobQueueService = module.get(JobQueueService);
        searchJobBufferService = module.get(SearchJobBufferService);
        await jobQueueService.start();
    }

    async function addSearchUpdateJob() {
        const queue = await jobQueueService.createQueue<any>({
            name: 'update-search-index',
            process: () => Promise.resolve(),
        });
        return queue.add({ type: 'update-variants-by-id', ids: [1], ctx: {} });
    }

    beforeEach(() => {
        jobQueueStrategy.reset();
        warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        warnSpy.mockRestore();
        await module?.close();
        setProcessContext('server');
    });

    it('buffers search updates in the server', async () => {
        await bootstrap({
            context: 'server',
            bufferUpdates: true,
            bufferStorage: new TestingJobBufferStorageStrategy(),
        });

        const job = await addSearchUpdateJob();

        expect(job.id).toBe('buffered');
        expect(await searchJobBufferService.getPendingSearchUpdates()).toBe(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not buffer search updates created in the worker when the buffer store is in memory', async () => {
        await bootstrap({
            context: 'worker',
            bufferUpdates: true,
            bufferStorage: new TestingJobBufferStorageStrategy(),
        });

        const job = await addSearchUpdateJob();

        expect(job.id).not.toBe('buffered');
        expect(await searchJobBufferService.getPendingSearchUpdates()).toBe(0);
        expect(await jobQueueStrategy.findOne(job.id as string)).toBeDefined();
    });

    it('warns once that the worker does not buffer when the buffer store is in memory', async () => {
        await bootstrap({
            context: 'worker',
            bufferUpdates: true,
            bufferStorage: new TestingJobBufferStorageStrategy(),
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('useDatabaseForBuffer: true');
    });

    it('buffers search updates created in the worker when the buffer store is shared', async () => {
        await bootstrap({
            context: 'worker',
            bufferUpdates: true,
            bufferStorage: new SharedJobBufferStorageStrategy(),
        });

        const job = await addSearchUpdateJob();

        expect(job.id).toBe('buffered');
        expect(await searchJobBufferService.getPendingSearchUpdates()).toBe(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not buffer anything when bufferUpdates is disabled', async () => {
        await bootstrap({
            context: 'worker',
            bufferUpdates: false,
            bufferStorage: new TestingJobBufferStorageStrategy(),
        });

        const job = await addSearchUpdateJob();

        expect(job.id).not.toBe('buffered');
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

function createConfigService(jobBufferStorageStrategy: JobBufferStorageStrategy) {
    @Injectable()
    class MockConfigService implements OnApplicationBootstrap, OnModuleDestroy {
        constructor(private moduleRef: ModuleRef) {}

        jobQueueOptions = { jobQueueStrategy, activeQueues: [], jobBufferStorageStrategy };
        systemOptions = { errorHandlers: [] };

        onApplicationBootstrap() {
            jobQueueStrategy.init(new Injector(this.moduleRef));
        }

        onModuleDestroy() {
            jobQueueStrategy.destroy();
        }
    }
    return MockConfigService;
}
