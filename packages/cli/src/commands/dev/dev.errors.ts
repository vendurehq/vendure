import { defineError } from '@vendure/common/lib/command';

export const devErrors = {
    startFailed: defineError<{ message: string }>({
        code: 'dev.start-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
};
