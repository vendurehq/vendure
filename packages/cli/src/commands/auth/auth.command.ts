import { defineCommand } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import { authErrors } from './auth.errors.js';

const keywords = ['login', 'sign in', 'account', 'console', 'credential', 'session'];

export const authLoginDefinition = defineCommand({
    path: ['auth', 'login'],
    description:
        'Sign in to your Vendure account. Without a terminal, or with --json, returns the URL and code to approve at once; `auth wait` finishes the login',
    keywords: [...keywords, 'device', 'code', 'browser'],
    behavior: 'mutating',
    schemas: async () => (await import('./auth.schema.js')).login,
    errors: [
        authErrors.consoleApiInvalid,
        authErrors.loginFailed,
        authErrors.loginDenied,
        authErrors.loginExpired,
        hostErrors.cancelled,
    ],
    examples: [
        'vendure auth login',
        'vendure auth login --organization "Bromley Art Supplies"',
        'vendure auth login --json',
    ],
    run: () => import('./login.js'),
    render: () => import('./login.js'),
});

export const authWaitDefinition = defineCommand({
    path: ['auth', 'wait'],
    description:
        'Wait until the login that `auth login --json` started is approved. Returns the pending login again when the timeout passes first',
    keywords: [...keywords, 'device', 'code', 'approve'],
    behavior: 'mutating',
    schemas: async () => (await import('./auth.schema.js')).wait,
    errors: [
        authErrors.consoleApiInvalid,
        authErrors.noPendingLogin,
        authErrors.loginFailed,
        authErrors.loginDenied,
        authErrors.loginExpired,
        hostErrors.cancelled,
    ],
    examples: ['vendure auth wait', 'vendure auth wait --timeout 60 --json'],
    run: () => import('./wait.js'),
    render: () => import('./wait.js'),
});

export const authStatusDefinition = defineCommand({
    path: ['auth', 'status'],
    description:
        'Show who is signed in, after checking that the login can still be renewed. Never shows a token',
    keywords: [...keywords, 'whoami'],
    // It renews the login to check it, which rotates the stored tokens and drops a login the
    // authentication service refused. Neither changes who is signed in, so it counts as reading.
    behavior: 'readonly',
    schemas: async () => (await import('./auth.schema.js')).status,
    errors: [authErrors.consoleApiInvalid],
    examples: ['vendure auth status', 'vendure auth status --json'],
    run: () => import('./status.js'),
    render: () => import('./status.js'),
});

export const authLogoutDefinition = defineCommand({
    path: ['auth', 'logout'],
    description: 'End the session and remove the login from this machine',
    keywords: [...keywords, 'sign out'],
    behavior: 'mutating',
    schemas: async () => (await import('./auth.schema.js')).logout,
    errors: [authErrors.logoutFailed],
    examples: ['vendure auth logout'],
    run: () => import('./logout.js'),
    render: () => import('./logout.js'),
});

/** The `vendure auth` commands, in the order they are listed. */
export const authDefinitions = [
    authLoginDefinition,
    authWaitDefinition,
    authStatusDefinition,
    authLogoutDefinition,
];
