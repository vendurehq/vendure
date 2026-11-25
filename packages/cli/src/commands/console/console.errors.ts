import { defineError } from '@vendure/common/lib/command';

export const consoleErrors = {
    projectIsDirectory: defineError<{ project: string; organization?: string }>({
        code: 'console.project-is-directory',
        exit: 1,
        message: ({ project }) =>
            `project names the Console Project to link, by its id or slug, but "${project}" is a Vendure project directory. ` +
            'Pass the project directory as dir, and the Console Project as project.',
        fix: ({ project, organization }) => [
            {
                description: 'Select the project directory',
                path: ['console', 'link'],
                input: { dir: project, ...(organization ? { organization } : {}) },
            },
        ],
    }),
    projectNotFound: defineError<{
        message: string;
        command: string[];
        candidates: string[];
        /** The rest of the caller's input, which each fix keeps. */
        input?: Record<string, unknown>;
    }>({
        code: 'console.project-not-found',
        exit: 1,
        message: ({ message }) => message,
        fix: ({ command, candidates, input }) =>
            candidates.map(candidate => ({
                description: `Select the Vendure project in ${candidate}`,
                path: command,
                input: { ...input, dir: candidate },
            })),
    }),
    linkFailed: defineError<{ message: string }>({
        code: 'console.link-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
    unlinkFailed: defineError<{ message: string }>({
        code: 'console.unlink-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
    manifestInvalid: defineError<{ manifestPath: string; reason: string; dir?: string }>({
        code: 'console.manifest-invalid',
        exit: 1,
        message: ({ manifestPath, reason }) => `Invalid Project Link Manifest at ${manifestPath}: ${reason}`,
        fix: ({ dir }) => [
            {
                description: 'Remove the manifest, then link the project again',
                path: ['console', 'unlink'],
                input: dir ? { dir } : {},
            },
        ],
    }),
    statusFailed: defineError<{ message: string }>({
        code: 'console.status-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
};
