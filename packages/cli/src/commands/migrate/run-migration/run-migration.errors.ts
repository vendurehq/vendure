import { defineError } from '@vendure/common/lib/command';

export const runFailed = defineError<{ message: string }>({
    code: 'migrate.run-failed',
    exit: 1,
    message: ({ message }) => `Running the migrations failed: ${message}`,
});
