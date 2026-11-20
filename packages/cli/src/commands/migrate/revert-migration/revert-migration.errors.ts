import { defineError } from '@vendure/common/lib/command';

export const revertFailed = defineError<{ message: string }>({
    code: 'migrate.revert-failed',
    exit: 1,
    message: ({ message }) => `Reverting the last migration failed: ${message}`,
});
