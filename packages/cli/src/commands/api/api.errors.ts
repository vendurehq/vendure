import { defineError } from '@vendure/common/lib/command';

export const apiErrors = {
    invalidVariables: defineError<{ message: string }>({
        code: 'api.invalid-variables',
        exit: 2,
        message: ({ message }) => `--variables must be a JSON object: ${message}`,
    }),
};
