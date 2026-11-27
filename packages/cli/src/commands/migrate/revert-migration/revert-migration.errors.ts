import { defineError } from '@vendure/common/lib/command';

export const databaseUnreadable = defineError<{ message: string }>({
    code: 'migrate.database-unreadable',
    exit: 1,
    message: ({ message }) =>
        `Could not read which migration the database applied last, so nothing can be reverted: ${message}`,
});

export const revertFailed = defineError<{ message: string }>({
    code: 'migrate.revert-failed',
    exit: 1,
    message: ({ message }) => `Reverting the last migration failed: ${message}`,
});
