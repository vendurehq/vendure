import { defineError } from '@vendure/common/lib/command';

export const vendureConfigNotFound = defineError<{ message: string }>({
    code: 'add.vendure-config-not-found',
    exit: 1,
    message: ({ message }) => `Could not find the Vendure config to add the plugin to: ${message}`,
});
