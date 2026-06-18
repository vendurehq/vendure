import { JobType } from 'bullmq';

export const loggerCtx = 'BullMQJobQueuePlugin';
export const BULLMQ_PLUGIN_OPTIONS = Symbol('BULLMQ_PLUGIN_OPTIONS');
export const QUEUE_NAME = 'vendure-job-queue';
export const DEFAULT_CONCURRENCY = 3;

export const ALL_JOB_TYPES: JobType[] = [
    'completed',
    'failed',
    'delayed',
    'repeat',
    'waiting-children',
    'active',
    'wait',
    'paused',
    'prioritized',
];
