import { defineError } from '@vendure/common/lib/command';

export const generateFailed = defineError<{ message: string }>({
    code: 'migrate.generate-failed',
    exit: 1,
    message: ({ message }) => `Generating the migration failed: ${message}`,
});
