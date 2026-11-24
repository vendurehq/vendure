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
        code: 'cli.cancelled',
        exit: 130,
        message: () => 'The command was cancelled.',
    }),
    internal: defineError<{ message: string }>({
        code: 'cli.internal',
        exit: 1,
        message: ({ message }) => message,
    }),
    manifestMismatch: defineError<{ command: string; reason: string }>({
        code: 'manifest.mismatch',
        exit: 1,
        message: ({ command, reason }) =>
            `The manifest entry for "${command}" does not match the command that is installed: ${reason}. Rebuild the package that declares it.`,
    }),
    commandReplaced: defineError<{ command: string; plugin: string }>({
        code: 'command.replaced',
        exit: 1,
        message: ({ command, plugin }) =>
            `"${command}" is replaced in this project by the CLI plugin ${plugin}, which does not support --json.`,
    }),
    childFailed: defineError<{ message: string }>({
        code: 'mcp.child-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
    inputUnreadable: defineError<{ reason: string }>({
        code: 'input.unreadable',
        exit: 1,
        message: ({ reason }) => `The --input document could not be read: ${reason}`,
    }),
};
