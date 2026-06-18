import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Success, UpdateScheduledTaskInput } from '@vendure/common/lib/generated-types';
import CronTime from 'cron-time-generator';
import { Cron } from 'croner';
import cronstrue from 'cronstrue';

import { ConfigService } from '../config/config.service';
import { Logger } from '../config/logger/vendure-logger';
import { ProcessContext } from '../process-context';

import { NoopSchedulerStrategy } from './noop-scheduler-strategy';
import { ScheduledTask } from './scheduled-task';
import { TaskReport } from './scheduler-strategy';

export interface TaskInfo {
    id: string;
    description: string;
    schedule: string;
    scheduleDescription: string;
    lastExecutedAt: Date | null;
    nextExecutionAt: Date | null;
    isRunning: boolean;
    lastResult: any;
    enabled: boolean;
}

/**
 * @description
 * The service that is responsible for setting up and querying the scheduled tasks.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly jobs: Map<string, { task: ScheduledTask; job: Cron }> = new Map();
    private shouldRunTasks = false;
    private runningTasks = 0;
    constructor(
        private readonly configService: ConfigService,
        private readonly processContext: ProcessContext,
    ) {}

    onApplicationBootstrap() {
        const schedulerStrategy = this.configService.schedulerOptions.schedulerStrategy;
        if (!schedulerStrategy || schedulerStrategy instanceof NoopSchedulerStrategy) {
            Logger.warn('No scheduler strategy is configured! Scheduled tasks will not be executed.');
            Logger.warn(
                'Please use the `DefaultSchedulerPlugin` (or alternative) to enable scheduled tasks.',
            );
            return;
        }
        this.shouldRunTasks =
            this.configService.schedulerOptions.runTasksInWorkerOnly === false ||
            this.processContext.isWorker;
        const scheduledTasks = this.configService.schedulerOptions.tasks ?? [];

        for (const task of scheduledTasks) {
            const job = this.createCronJob(task);
            const pattern = job.getPattern();
            if (!pattern) {
                Logger.warn(`Invalid cron pattern for task ${task.id}`);
            } else {
                if (this.shouldRunTasks) {
                    const schedule = cronstrue.toString(pattern);
                    Logger.info(`Registered scheduled task: ${task.id} - ${schedule}`);
                }
                this.jobs.set(task.id, { task, job });
            }
            schedulerStrategy.registerTask?.(task);
        }
    }

    async onApplicationShutdown(signal?: string) {
        for (const job of this.jobs.values()) {
            job.job.stop();
        }
        const startTime = Date.now();
        // If any tasks are still running, wait a short time for them to finish
        const maxWaitTime = 10_000;
        while (this.runningTasks > 0 && Date.now() - startTime < maxWaitTime) {
            Logger.warn(
                `Waiting for ${this.runningTasks} running tasks to finish before shutting down (signal: ${signal ?? 'unknown'})`,
            );
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * @description
     * Returns a list of all the scheduled tasks and their current status.
     */
    getTaskList(): Promise<TaskInfo[]> {
        return this.configService.schedulerOptions.schedulerStrategy
            .getTasks()
            .then(taskReports =>
                taskReports.map(taskReport => this.createTaskInfo(taskReport)).filter(x => x !== undefined),
            );
    }

    updateTask(input: UpdateScheduledTaskInput): Promise<TaskInfo> {
        return this.configService.schedulerOptions.schedulerStrategy.updateTask(input).then(taskReport => {
            const taskInfo = this.createTaskInfo(taskReport);
            if (!taskInfo) {
                throw new Error(`Task ${input.id} not found`);
            }
            return taskInfo;
        });
    }

    async runTask(taskId: string): Promise<Success> {
        const task = this.jobs.get(taskId);
        if (!task) {
            return {
                success: false,
            };
        }
        try {
            await this.configService.schedulerOptions.schedulerStrategy.triggerTask(task.task);
            return {
                success: true,
            };
        } catch (e: any) {
            Logger.error(`Could not trigger task: ` + (e.message as string));
            return {
                success: false,
            };
        }
    }

    private createTaskInfo(taskReport: TaskReport): TaskInfo | undefined {
        const job = this.jobs.get(taskReport.id)?.job;
        const task = this.jobs.get(taskReport.id)?.task;
        if (!job || !task) {
            return;
        }

        const pattern = job.getPattern();
        return {
            id: taskReport.id,
            description: task.options.description ?? '',
            schedule: pattern ?? 'unknown',
            scheduleDescription: pattern ? cronstrue.toString(pattern) : 'unknown',
            lastExecutedAt: taskReport.lastExecutedAt,
            nextExecutionAt: job.nextRun(),
            isRunning: taskReport.isRunning,
            lastResult: taskReport.lastResult,
            enabled: taskReport.enabled,
        };
    }

    private createCronJob(task: ScheduledTask) {
        const schedulerStrategy = this.configService.schedulerOptions.schedulerStrategy;
        const protectCallback = (_job: Cron) => {
            const currentRun = _job.currentRun();
            if (currentRun) {
                Logger.warn(
                    `Task invocation of ${task.id} at ${new Date().toISOString()} was blocked because an existing task is still running at ${currentRun.toISOString()}`,
                );
            }
        };

        const schedule =
            typeof task.options.schedule === 'function'
                ? task.options.schedule(CronTime)
                : task.options.schedule;

        const job = new Cron(
            schedule,
            {
                name: task.id,
                protect: task.options.preventOverlap ? protectCallback : undefined,
            },
            () => {
                if (this.shouldRunTasks) {
                    // Only execute the cron task on the worker process
                    // so that any expensive logic does not affect
                    // the responsiveness of server processes
                    this.runningTasks++;
                    try {
                        schedulerStrategy.executeTask(task)(job);
                    } catch (e: any) {
                        const message = e instanceof Error ? e.message : String(e);
                        Logger.error(`Error executing scheduled task ${task.id}: ${message}`);
                    } finally {
                        this.runningTasks--;
                    }
                }
            },
        );

        return job;
    }
}
