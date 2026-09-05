/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JobState } from '@vendure/common/lib/generated-types';
import { Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertFound, Injector } from '../common';
import { ConfigService } from '../config/config.service';
import { ProcessContext, setProcessContext } from '../process-context/process-context';

import { Job } from './job';
import { JobBuffer } from './job-buffer/job-buffer';
import { JobBufferService } from './job-buffer/job-buffer.service';
import { TestingJobBufferStorageStrategy } from './job-buffer/testing-job-buffer-storage-strategy';
import { JobQueue } from './job-queue';
import { JobQueueService } from './job-queue.service';
import { TestingJobQueueStrategy } from './testing-job-queue-strategy';

const queuePollInterval = 10;
const backoffStrategySpy = vi.fn();
const testJobQueueStrategy = new TestingJobQueueStrategy({
    concurrency: 1,
    pollInterval: queuePollInterval,
    backoffStrategy: backoffStrategySpy.mockReturnValue(0),
});
const testJobBufferStorageStrategy = new TestingJobBufferStorageStrategy();

describe('JobQueueService', () => {
    let jobQueueService: JobQueueService;
    let module: TestingModule;

    function getJob(job: Job | string): Promise<Job> {
        const id = typeof job === 'string' ? job : job.id!;
        return assertFound(testJobQueueStrategy.findOne(id));
    }

    /**
     * Polls the strategy until every given job is settled. ActiveQueue persists a settled
     * job from its own `onFailOrComplete()` chain, which the test cannot await, so a fixed
     * number of ticks would only line up with that chain by accident.
     */
    async function waitUntilSettled(...ids: string[]): Promise<void> {
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline) {
            const jobs = await Promise.all(ids.map(id => getJob(id)));
            if (jobs.every(job => job.isSettled)) {
                return;
            }
            await tick(1);
        }
        throw new Error(`Timed out waiting for jobs to settle: ${ids.join(', ')}`);
    }

    beforeEach(async () => {
        setProcessContext('server');

        // Both strategies are module-level and shared by every test in this file, and
        // `module.close()` does not clear them. Reset them so no test inherits the jobs,
        // buffers or concurrency left behind by the one before it.
        testJobQueueStrategy.reset();
        testJobQueueStrategy.concurrency = 1;
        testJobBufferStorageStrategy.reset();

        module = await Test.createTestingModule({
            providers: [
                { provide: ConfigService, useClass: MockConfigService },
                JobQueueService,
                JobBufferService,
                ProcessContext,
            ],
        }).compile();
        await module.init();

        jobQueueService = module.get(JobQueueService);
        await jobQueueService.start();
    });

    afterEach(async () => {
        await module.close();
    });

    it('data is passed into job', async () => {
        const subject = new Subject<string>();
        const subNext = subject.pipe(take(1)).toPromise();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: async job => {
                subject.next(job.data);
            },
        });

        await testQueue.add('hello');
        const data = await subNext;
        expect(data).toBe('hello');
    });

    it('job marked as complete', async () => {
        const subject = new Subject<string>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.toPromise();
            },
        });

        const testJob = await testQueue.add('hello');
        expect(testJob.state).toBe(JobState.PENDING);

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.RUNNING);

        subject.next('yay');
        subject.complete();

        await tick();

        expect((await getJob(testJob)).state).toBe(JobState.COMPLETED);
        expect((await getJob(testJob)).result).toBe('yay');
    });

    it('job marked as failed when exception thrown', async () => {
        const subject = new Subject<string>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: async job => {
                const result = await subject.toPromise();
                throw result;
            },
        });

        const testJob = await testQueue.add('hello');
        expect(testJob.state).toBe(JobState.PENDING);

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.RUNNING);

        subject.next('uh oh');
        subject.complete();
        await tick();

        expect((await getJob(testJob)).state).toBe(JobState.FAILED);
        expect((await getJob(testJob)).error).toBe('uh oh');
    });

    it('job marked as failed when async error thrown', async () => {
        const err = new Error('something bad happened');
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: async job => {
                throw err;
            },
        });

        const testJob = await testQueue.add('hello');
        expect(testJob.state).toBe(JobState.PENDING);

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.FAILED);
        expect((await getJob(testJob)).error).toBe(err.message);
    });

    it('jobs processed in FIFO queue', async () => {
        const subject = new Subject<void>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.pipe(take(1)).toPromise();
            },
        });

        const testJob1 = await testQueue.add('1');
        const testJob2 = await testQueue.add('2');
        const testJob3 = await testQueue.add('3');

        const getStates = async () => [
            (await getJob(testJob1)).state,
            (await getJob(testJob2)).state,
            (await getJob(testJob3)).state,
        ];

        await tick(queuePollInterval);

        expect(await getStates()).toEqual([JobState.RUNNING, JobState.PENDING, JobState.PENDING]);

        subject.next();
        await tick();
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.PENDING, JobState.PENDING]);

        await tick(queuePollInterval);
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.RUNNING, JobState.PENDING]);

        subject.next();
        await tick();
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.PENDING]);

        await tick(queuePollInterval);
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.RUNNING]);

        subject.next();
        await tick();
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.COMPLETED]);

        subject.complete();
    });

    it('with concurrency', async () => {
        const testingJobQueueStrategy = module.get(ConfigService).jobQueueOptions
            .jobQueueStrategy as TestingJobQueueStrategy;

        testingJobQueueStrategy.concurrency = 2;

        const subject = new Subject<void>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.pipe(take(1)).toPromise();
            },
        });

        const testJob1 = await testQueue.add('1');
        const testJob2 = await testQueue.add('2');
        const testJob3 = await testQueue.add('3');

        const getStates = async () => [
            (await getJob(testJob1)).state,
            (await getJob(testJob2)).state,
            (await getJob(testJob3)).state,
        ];

        await tick(queuePollInterval);

        expect(await getStates()).toEqual([JobState.RUNNING, JobState.RUNNING, JobState.PENDING]);

        subject.next();
        await tick();
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.PENDING]);

        await tick(queuePollInterval);
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.RUNNING]);

        subject.next();
        await tick();
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED, JobState.COMPLETED]);

        subject.complete();
    });

    it('processes existing jobs on start', async () => {
        // Neither job settles until `subject` emits, so both occupy a concurrency slot at
        // the same time. ActiveQueue reads this when the queue is created below.
        testJobQueueStrategy.concurrency = 2;

        await testJobQueueStrategy.prePopulate([
            new Job<any>({
                queueName: 'test',
                data: {},
                id: 'job-1',
            }),
            new Job<any>({
                queueName: 'test',
                data: {},
                id: 'job-2',
            }),
        ]);

        const subject = new Subject<void>();
        const processing = new Set<string>();
        let onBothProcessing: () => void;
        const bothProcessing = new Promise<void>(resolve => (onBothProcessing = resolve));
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                processing.add(job.id as string);
                if (processing.size === 2) {
                    onBothProcessing();
                }
                return subject.pipe(take(1)).toPromise();
            },
        });

        const getStates = async () => [(await getJob('job-1')).state, (await getJob('job-2')).state];

        // ActiveQueue persists a job before it calls `process`, so once both jobs have
        // entered `process` both must be RUNNING in the store. Neither has settled, so this
        // can only hold if the queue dispatched the jobs which existed before it started.
        await bothProcessing;
        expect(await getStates()).toEqual([JobState.RUNNING, JobState.RUNNING]);

        subject.next();
        await waitUntilSettled('job-1', 'job-2');
        expect(await getStates()).toEqual([JobState.COMPLETED, JobState.COMPLETED]);

        subject.complete();
    });

    it('retries', async () => {
        backoffStrategySpy.mockClear();
        const subject = new Subject<boolean>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject
                    .pipe(take(1))
                    .toPromise()
                    .then(success => {
                        if (!success) {
                            throw new Error();
                        }
                    });
            },
        });

        const testJob = await testQueue.add('hello', { retries: 2 });

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.RUNNING);
        expect((await getJob(testJob)).isSettled).toBe(false);

        subject.next(false);
        await tick();
        expect((await getJob(testJob)).state).toBe(JobState.RETRYING);
        expect((await getJob(testJob)).isSettled).toBe(false);

        await tick(queuePollInterval);

        expect(backoffStrategySpy).toHaveBeenCalledTimes(1);
        expect(backoffStrategySpy.mock.calls[0][0]).toBe('test');
        expect(backoffStrategySpy.mock.calls[0][1]).toBe(1);
        expect(backoffStrategySpy.mock.calls[0][2].id).toBe(testJob.id);

        subject.next(false);
        await tick();
        expect((await getJob(testJob)).state).toBe(JobState.RETRYING);
        expect((await getJob(testJob)).isSettled).toBe(false);

        await tick(queuePollInterval);

        expect(backoffStrategySpy).toHaveBeenCalledTimes(2);
        expect(backoffStrategySpy.mock.calls[1][0]).toBe('test');
        expect(backoffStrategySpy.mock.calls[1][1]).toBe(2);
        expect(backoffStrategySpy.mock.calls[1][2].id).toBe(testJob.id);

        subject.next(false);
        await tick();
        expect((await getJob(testJob)).state).toBe(JobState.FAILED);
        expect((await getJob(testJob)).isSettled).toBe(true);
    });

    it('sets long-running jobs to pending on destroy', async () => {
        const testingJobQueueStrategy = module.get(ConfigService).jobQueueOptions
            .jobQueueStrategy as TestingJobQueueStrategy;

        const subject = new Subject<boolean>();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.pipe(take(1)).toPromise();
            },
        });

        const testJob = await testQueue.add('hello');

        await tick(queuePollInterval);

        expect((await testingJobQueueStrategy.findOne(testJob.id!))?.state).toBe(JobState.RUNNING);

        await testQueue.stop();

        expect((await testingJobQueueStrategy.findOne(testJob.id!))?.state).toBe(JobState.PENDING);
    }, 10000);

    it('should start a queue if its name is in the active list', async () => {
        module.get(ConfigService).jobQueueOptions.activeQueues = ['test'];

        const subject = new Subject();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.toPromise();
            },
        });

        const testJob = await testQueue.add('hello');
        expect(testJob.state).toBe(JobState.PENDING);

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.RUNNING);

        subject.next('yay');
        subject.complete();
        await tick();

        expect((await getJob(testJob)).state).toBe(JobState.COMPLETED);
        expect((await getJob(testJob)).result).toBe('yay');
    });

    it('should not start a queue if its name is in the active list', async () => {
        module.get(ConfigService).jobQueueOptions.activeQueues = ['another'];

        const subject = new Subject();
        const testQueue = await jobQueueService.createQueue<string>({
            name: 'test',
            process: job => {
                return subject.toPromise();
            },
        });

        const testJob = await testQueue.add('hello');
        expect(testJob.state).toBe(JobState.PENDING);

        await tick(queuePollInterval);
        expect((await getJob(testJob)).state).toBe(JobState.PENDING);

        subject.next('yay');
        subject.complete();

        expect((await getJob(testJob)).state).toBe(JobState.PENDING);
    });

    describe('buffering', () => {
        class TestJobBuffer implements JobBuffer<string> {
            readonly id: 'test-job-buffer';

            collect(job: Job<string>): boolean | Promise<boolean> {
                return job.queueName === 'buffer-test-queue-1';
            }

            reduce(collectedJobs: Array<Job<string>>): Array<Job<string>> {
                const concated = collectedJobs.map(j => j.data).join(' ');
                return [
                    new Job({
                        ...collectedJobs[0],
                        id: undefined,
                        data: concated,
                    }),
                ];
            }
        }

        let testQueue1: JobQueue<string>;
        let testQueue2: JobQueue<string>;
        const subject1 = new Subject();
        const subject2 = new Subject();
        const testJobBuffer = new TestJobBuffer();

        beforeEach(async () => {
            // Both queue-2 jobs must be dispatched by the same poll cycle. ActiveQueue reads
            // the concurrency when the queue is created, so this has to be set beforehand.
            testJobQueueStrategy.concurrency = 2;

            testQueue1 = await jobQueueService.createQueue({
                name: 'buffer-test-queue-1',
                process: job => {
                    return subject1.toPromise();
                },
            });
            testQueue2 = await jobQueueService.createQueue({
                name: 'buffer-test-queue-2',
                process: job => {
                    return subject2.toPromise();
                },
            });

            jobQueueService.addBuffer(testJobBuffer);
        });

        it('buffers the specified jobs', async () => {
            const testJob1_1 = await testQueue1.add('hello');
            const testJob1_2 = await testQueue1.add('world');
            const testJob2_1 = await testQueue2.add('foo');
            const testJob2_2 = await testQueue2.add('bar');

            await tick(queuePollInterval);
            expect(await getJob(testJob1_1)).toBeUndefined();
            expect(await getJob(testJob1_2)).toBeUndefined();

            expect((await getJob(testJob2_1)).state).toBe(JobState.RUNNING);
            expect((await getJob(testJob2_2)).state).toBe(JobState.RUNNING);

            const bufferedJobs = testJobBufferStorageStrategy.getBufferedJobs(testJobBuffer.id);
            expect(bufferedJobs.map(j => j.data)).toEqual(['hello', 'world']);
        });

        it('flushes and reduces buffered jobs', async () => {
            await testQueue1.add('hello');
            await testQueue1.add('world');
            await tick(queuePollInterval);

            const result = await jobQueueService.flush(testJobBuffer);

            expect(result.length).toBe(1);
            expect(result[0].data).toBe('hello world');
        });
    });
});

function tick(ms: number = 0): Promise<void> {
    return new Promise<void>(resolve => {
        if (ms > 0) {
            setTimeout(resolve, ms);
        } else {
            process.nextTick(resolve);
        }
    });
}

@Injectable()
class MockConfigService implements OnApplicationBootstrap, OnModuleDestroy {
    constructor(private moduleRef: ModuleRef) {}

    jobQueueOptions = {
        jobQueueStrategy: testJobQueueStrategy,
        activeQueues: [],
        jobBufferStorageStrategy: testJobBufferStorageStrategy,
    };

    systemOptions = {
        errorHandlers: [],
    };

    async onApplicationBootstrap() {
        const injector = new Injector(this.moduleRef);
        this.jobQueueOptions.jobQueueStrategy.init(injector);
    }

    async onModuleDestroy() {
        this.jobQueueOptions.jobQueueStrategy.destroy();
    }
}
