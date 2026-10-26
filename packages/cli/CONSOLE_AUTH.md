# Console authentication API

Available from `@vendure/cli` in 3.8.0. Importing the package does not run a
command, open a browser, bind a port, or load a private package.

```ts
import { loginWithBrowser, refreshSession, ConsoleTokenGrantError } from '@vendure/cli';
import type { ConsoleBrowserLoginOptions, ConsoleRefreshOptions, ConsoleSession } from '@vendure/cli';

const session = await loginWithBrowser({ client: 'create' });
// session.expiresAt is epoch milliseconds.
if (session.refreshToken) {
    try {
        const renewed = await refreshSession(session.refreshToken);
        await saveSession(renewed);
    } catch (error) {
        if (error instanceof ConsoleTokenGrantError && error.refused) {
            await removeStoredSession();
        } else {
            // Retain the stored refresh token for a later retry.
            throw error;
        }
    }
}
```

The caller owns credential storage, refresh locking and recovery UI. Core does
not store the returned session. To preserve an existing ISO-8601 credential
format, convert expiry with `new Date(session.expiresAt).toISOString()` when
writing that format. No stored-credential migration is required.

## Browser login

`loginWithBrowser(options: ConsoleBrowserLoginOptions): Promise<ConsoleSession>`
starts a standalone login on Console's `/cli-auth` page. It binds a one-use
loopback callback on `127.0.0.1` and uses PKCE with S256. Tokens never appear in
the authorization URL.

| Option | Behavior |
| --- | --- |
| `client` | Required. `'cli'` or `'create'` identifies the caller on the approval page. |
| `appOrigin`, `apiOrigin` | Default to `https://console.vendure.io` and `https://api.vendure.io`. |
| `signal` | Cancels login and token exchange. Cancellation rejects with `AbortError`. |
| `timeoutMs` | Callback deadline in milliseconds. Default is `300_000`, or five minutes. Must be finite, greater than zero, and at most `2_147_483_647`. |
| `openBrowser(url)` | Optional function that returns `Promise<boolean>`. The default uses the OS browser opener. |
| `reportAuthorizationUrl(url)` | Receives the URL when opening fails or returns `false`. The default prints it to stdout. |
| `fetch` | Optional fetch implementation. Defaults to `globalThis.fetch`. |
| `now` | Optional `() => number` that returns epoch milliseconds. Defaults to `Date.now`. |

Both origins must form a trusted pair. Production and staging are supported.
Staging uses `https://staging.console.vendure.io` with
`https://staging.api.vendure.io`. Development and tests can use HTTP or HTTPS
origins on `localhost`, `127.0.0.1`, or `[::1]`, including explicit ports.
Mixed deployments, untrusted remote hosts, credentials, paths, queries and
fragments are rejected before a listener opens or a token is sent.

Denial, invalid callback state, timeout and cancellation reject the login.
Every exit closes the callback listener and removes timers and abort listeners.
A failed browser opener leaves login pending so the person can use the reported
URL. The callback deadline still applies if a custom browser opener stalls.

## Token refresh and failures

`refreshSession(refreshToken: string, options?: ConsoleRefreshOptions): Promise<ConsoleSession>`
accepts `apiOrigin`, `signal`, `fetch` and `now`. The API origin must be a trusted
production, staging or loopback origin. A rotated refresh token replaces the old
one in the result. If Console omits a replacement, the result retains the input
refresh token.

Both authorization-code exchange and refresh post to `/v1/auth/cli/token`.
They reject redirects, limit the reply to 64 KiB, and apply a ten-second deadline
to headers and the response body. Expiry uses the time before the request, so
transport delay cannot extend the session lifetime.

`ConsoleTokenGrantError` has a readonly `refused` boolean. It is `true` only for
a 4xx response with Console's `code: 'cli_session.invalid_grant'`. Network errors,
timeouts, service errors and malformed replies set it to `false`. A proxy's
4xx status alone does not prove grant refusal. Cancellation rejects with
`AbortError` and remains separate from grant refusal.

## Project linking

`vendure console link` uses the same internal PKCE, callback, token transport and
session parser. It keeps its single combined approval. Use the supported
`afterConsoleLink` hook with `requiresSession: true` to receive that session.
Linking still succeeds when the optional session cannot be obtained. It does
not start a second standalone login.

Protocol helpers remain internal. Existing `dist/commands/console/cli-auth`
exports are retained for compatibility, but new consumers must use the package
root. Core does not change `/v1/project-links` or the Console server contract.
