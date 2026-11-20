import { defineError } from '@vendure/common/lib/command';

/** Errors the host itself reports, as opposed to the errors a command declares. */
export const hostErrors = {
    projectRequired: defineError<{ command: string }>({
        code: 'project.required',
        exit: 1,
        message: ({ command }) => `"${command}" needs a Vendure project. Run it from a project directory.`,
    }),
    inputInvalid: defineError<{ messages: string[] }>({
        code: 'input.invalid',
        exit: 1,
        message: ({ messages }) => `The input is not valid: ${messages.join('; ')}`,
    }),
    usage: defineError<{ message: string }>({
        code: 'cli.usage',
        exit: 1,
        message: ({ message }) => message,
    }),
    cancelled: defineError<Record<string, never>>({
        code: 'cancelled',
        exit: 130,
        message: () => 'The command was cancelled.',
    }),
    internal: defineError<{ message: string }>({
        code: 'internal',
        exit: 1,
        message: ({ message }) => message,
    }),
    manifestMismatch: defineError<{ command: string; reason: string }>({
        code: 'manifest.mismatch',
        exit: 1,
        message: ({ command, reason }) =>
            `The manifest entry for "${command}" does not match the command that is installed: ${reason}. Rebuild the package that declares it.`,
    }),
    inputUnreadable: defineError<{ reason: string }>({
        code: 'input.unreadable',
        exit: 1,
        message: ({ reason }) => `The --input document could not be read: ${reason}`,
    }),
};
