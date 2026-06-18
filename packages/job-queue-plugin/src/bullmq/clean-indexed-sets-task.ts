import { ScheduledTask } from '@vendure/core';

import { JobListIndexService } from './job-list-index.service';

export const cleanIndexedSetsTask = new ScheduledTask({
    id: 'clean-job-queue-index',
    description: 'Cleans up the index used to speed up job queue listing operations',
    schedule: cron => cron.everyMinute(),
    async execute({ injector }) {
        return injector.get(JobListIndexService).cleanupIndexedSets();
    },
});
