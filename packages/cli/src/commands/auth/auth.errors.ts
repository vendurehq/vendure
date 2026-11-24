import { CommandFix, defineError } from '@vendure/common/lib/command';

/** The fix for every login that has to start again. Under `--json` it returns the code at once. */
export const LOGIN_FIX: CommandFix = {
    path: ['auth', 'login'],
    input: { json: true },
    description: 'Start a new login, and give the person the URL and code it returns',
};

export const authErrors = {
    consoleApiInvalid: defineError<{ message: string }>({
        code: 'auth.console-api-invalid',
        exit: 1,
        message: ({ message }) => message,
    }),
    loginFailed: defineError<{ message: string }>({
        code: 'auth.login-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
    loginDenied: defineError<Record<string, never>>({
        code: 'auth.login-denied',
        exit: 1,
        message: () => 'The login was denied in the browser. Nothing was stored.',
        fix: () => [LOGIN_FIX],
    }),
    loginExpired: defineError<Record<string, never>>({
        code: 'auth.login-expired',
        exit: 1,
        message: () => 'The login code expired before it was approved. Nothing was stored.',
        fix: () => [LOGIN_FIX],
    }),
    noPendingLogin: defineError<{ reason: 'missing' | 'expired' }>({
        code: 'auth.no-pending-login',
        exit: 1,
        message: ({ reason }) =>
            reason === 'expired'
                ? 'The pending login code expired before it was approved. Start a new login.'
                : 'No login is waiting for approval. Start one first.',
        fix: () => [LOGIN_FIX],
    }),
    logoutFailed: defineError<{ message: string }>({
        code: 'auth.logout-failed',
        exit: 1,
        message: ({ message }) => message,
    }),
};
