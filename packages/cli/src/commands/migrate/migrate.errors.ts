import { defineError } from '@vendure/common/lib/command';

/** The Vendure config of the project could not be found or loaded. */
export const configUnreadable = defineError<{ message: string }>({
    code: 'migrate.config-unreadable',
    exit: 1,
    message: ({ message }) => `Could not load the Vendure config of the project: ${message}`,
});
