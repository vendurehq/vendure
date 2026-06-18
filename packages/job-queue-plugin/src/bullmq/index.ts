import { Logger } from '@vendure/core';

// ensure that the bullmq package is installed
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('bullmq');
} catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('The BullMQJobQueuePlugin depends on the "bullmq" package being installed.');
    process.exit(1);
}

export * from './plugin';
export * from './types';
