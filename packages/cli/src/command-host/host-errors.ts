import { defineError } from '@vendure/common/lib/command';

import { LOGIN_FIX } from '../auth/credential.js';

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
    credentialFailed: defineError<{ message: string }>({
        code: 'auth.credential-failed',
        exit: 1,
        message: ({ message }) =>
            `The command needs a Vendure Cloud credential, and finding one failed: ${message}`,
        fix: () => [LOGIN_FIX],
    }),
    pluginCommandClash: defineError<{ plugin: string; command: string; other: string }>({
        code: 'plugin.command-clash',
        exit: 1,
        message: ({ plugin, command, other }) =>
            `${plugin} declares the command "${command}", which clashes with ${other}. ` +
            `None of the commands ${plugin} declares with defineCommand are loaded. Disable one of the two packages, or rename the command.`,
    }),
    pluginParentPositional: defineError<{ plugin: string; command: string; child: string }>({
        code: 'plugin.parent-positional',
        exit: 1,
        message: ({ plugin, command, child }) =>
            `${plugin} declares the command "${command}" with positional fields, and the command "${child}" under it. ` +
            'A command with commands under it takes no positional fields, so that a value is never taken for a command name. ' +
            `None of the commands ${plugin} declares with defineCommand are loaded.`,
    }),
    pluginParentFlagConflict: defineError<{ plugin: string; command: string; child: string; flag: string }>({
        code: 'plugin.parent-flag-conflict',
        exit: 1,
        message: ({ plugin, command, child, flag }) =>
            `${plugin} declares ${flag} differently on the command "${command}" and on the command "${child}" under it. ` +
            'A command and the commands under it must declare a shared flag the same way, because the command above reads it first. ' +
            `None of the commands ${plugin} declares with defineCommand are loaded.`,
    }),
    // Only a command line can put an option in the wrong place, so this message names the corrected
    // command line. `vendure mcp` builds its command lines itself and never gets this error.
    optionBeforeCommand: defineError<{ option: string; line: string }>({
        code: 'cli.option-before-command',
        exit: 1,
        message: ({ option, line }) =>
            `${option} comes before the end of the command path. Options go after it: ${line}`,
    }),
    pluginManifestInvalid: defineError<{ plugin: string; reason: string }>({
        code: 'plugin.manifest-invalid',
        exit: 1,
        message: ({ plugin, reason }) =>
            `The command manifest of ${plugin} is not valid, so none of its defineCommand commands are loaded: ${reason}`,
    }),
    pluginUnavailable: defineError<{ plugin: string; reason: string }>({
        code: 'plugin.unavailable',
        exit: 1,
        message: ({ plugin, reason }) =>
            `${plugin} is enabled, but its defineCommand commands could not be loaded: ${reason}`,
    }),
    pluginDefinitionsFailed: defineError<{ plugin: string; command: string; reason: string }>({
        code: 'plugin.definitions-failed',
        exit: 1,
        message: ({ plugin, command, reason }) =>
            `"${command}" could not run, because the command declarations of ${plugin} failed to load: ${reason}`,
    }),
    inputUnreadable: defineError<{ reason: string }>({
        code: 'input.unreadable',
        exit: 1,
        message: ({ reason }) => `The --input document could not be read: ${reason}`,
    }),
};
