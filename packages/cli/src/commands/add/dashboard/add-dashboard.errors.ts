import { defineError } from '@vendure/common/lib/command';

export const dashboardConflict = defineError<{ plugin: string; message: string }>({
    code: 'add.dashboard-conflict',
    exit: 1,
    message: ({ plugin, message }) => `Could not add Dashboard extensions to ${plugin}: ${message}`,
});
