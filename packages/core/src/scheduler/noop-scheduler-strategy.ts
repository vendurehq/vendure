import { UpdateScheduledTaskInput } from '@vendure/common/lib/generated-types';

import { Logger } from '../config/logger/vendure-logger';

import { ScheduledTask } from './scheduled-task';
import { SchedulerStrategy, TaskReport } from './scheduler-strategy';

export class NoopSchedulerStrategy implements SchedulerStrategy {
    getTasks(): Promise<TaskReport[]> {
        return Promise.resolve([]);
    }

    getTask(id: string): Promise<TaskReport | undefined> {
        return Promise.resolve(undefined);
    }

    executeTask(task: ScheduledTask) {
        Logger.warn(`No task scheduler is configured! The task ${task.id} will not be executed.`);
        return () => Promise.resolve();
    }

    updateTask(input: UpdateScheduledTaskInput): Promise<TaskReport> {
        throw new Error(`Not implemented`);
    }

    triggerTask(task: ScheduledTask): Promise<void> {
        throw new Error(`Not implemented`);
    }
}
