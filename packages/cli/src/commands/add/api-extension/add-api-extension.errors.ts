import { defineError } from '@vendure/common/lib/command';

export const apiExtensionFailed = defineError<{ plugin: string; message: string }>({
    code: 'add.api-extension-failed',
    exit: 1,
    message: ({ plugin, message }) => `Could not add the API extension to ${plugin}: ${message}`,
});
