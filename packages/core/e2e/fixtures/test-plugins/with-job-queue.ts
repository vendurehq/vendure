import { Controller, Get, OnModuleInit } from '@nestjs/common';
import { JobQueue, JobQueueService, Logger, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { Subject } from 'rxjs';
import { take } from 'rxjs/operators';

@Controller('run-job')
class TestController implements OnModuleInit {
    private queue: JobQueue<{ returnValue?: string }>;
    private progressQueue: JobQueue<{ duration: number }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: 'test',
            process: async job => {
                if (job.data.returnValue) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return job.data.returnValue;
                } else {
                    const interval = setInterval(() => {
                        Logger.info(`Job is running...`);
                        if (job.state === 'CANCELLED') {
                            clearInterval(interval);
                            PluginWithJobQueue.jobSubject.next();
                        }
                    }, 500);
                    return PluginWithJobQueue.jobSubject
                        .pipe(take(1))
                        .toPromise()
                        .then(() => {
                            PluginWithJobQueue.jobHasDoneWork = true;
                            clearInterval(interval);
                            return 'job result';
                        });
                }
            },
        });

        // Queue for testing that updates() emits multiple times until job completion
        this.progressQueue = await this.jobQueueService.createQueue({
            name: 'test-progress',
            process: async job => {
                const duration = job.data.duration;
                const steps = 4;
                const stepDuration = duration / steps;
                for (let i = 1; i <= steps; i++) {
                    await new Promise(resolve => setTimeout(resolve, stepDuration));
                    job.setProgress(i * 25);
                }
                return 'completed';
            },
        });
    }

    @Get()
    async runJob() {
        await this.queue.add({});
        return true;
    }

    @Get('subscribe')
    async runJobAndSubscribe() {
        const job = await this.queue.add({ returnValue: '42!' });
        return job
            .updates()
            .toPromise()
            .then(update => update?.result);
    }

    @Get('subscribe-timeout')
    async runJobAndSubscribeTimeout() {
        const job = await this.queue.add({});
        const result = await job
            .updates({ timeoutMs: 100 })
            .toPromise()
            .then(update => update?.result);
        return result;
    }

    /**
     * This endpoint tests that job.updates() emits multiple times as the job progresses,
     * and continues until the job reaches a terminal state (COMPLETED).
     * See https://github.com/vendure-ecommerce/vendure/issues/4112
     */
    @Get('subscribe-all-updates')
    async runJobAndSubscribeAllUpdates() {
        const job = await this.progressQueue.add({ duration: 500 });
        const allUpdates: Array<{ state: string; progress: number; result: any }> = [];
        return new Promise(resolve => {
            job.updates({ pollInterval: 50, timeoutMs: 10000 }).subscribe({
                next: update => {
                    allUpdates.push({
                        state: update.state as string,
                        progress: update.progress,
                        result: update.result,
                    });
                },
                error: err => {
                    resolve(
                        JSON.stringify({
                            updateCount: allUpdates.length,
                            states: allUpdates.map(u => u.state),
                            finalState: allUpdates[allUpdates.length - 1]?.state,
                            finalResult: allUpdates[allUpdates.length - 1]?.result,
                            error: err.message,
                        }),
                    );
                },
                complete: () => {
                    resolve(
                        JSON.stringify({
                            updateCount: allUpdates.length,
                            states: allUpdates.map(u => u.state),
                            finalState: allUpdates[allUpdates.length - 1]?.state,
                            finalResult: allUpdates[allUpdates.length - 1]?.result,
                        }),
                    );
                },
            });
        });
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [TestController],
})
export class PluginWithJobQueue {
    static jobHasDoneWork = false;
    static jobSubject = new Subject<void>();
}
