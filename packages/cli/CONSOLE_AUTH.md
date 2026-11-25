# Console authentication

How the Vendure CLI signs in to Vendure Console, and the API that `@vendure/cli`
exports for it. Importing the package does not run a command, open a browser,
bind a port, or load a private package.

## The login

The CLI signs in with the WorkOS device flow. The WorkOS client is the one the
selected Vendure Console publishes at `GET /v1`, so Console always accepts the
tokens. The login is stored in `auth.json` in the CLI configuration directory,
readable only by the user. That directory is `VENDURE_CLI_CONFIG_DIR` when it is
set, else `$XDG_CONFIG_HOME/vendure`, else `%APPDATA%\vendure` on Windows, else
`~/.config/vendure`. `vendure auth login`, `vendure console link` and Vendure
Cloud share this one login.

The refresh token is single-use and rotates on every renewal. Every renewal of
the stored login and every write of `auth.json` takes a file lock
(`auth.lock`), so two `vendure` processes do not spend the same refresh token.
A copy of `auth.json` on another machine does not survive: whichever copy
renews second is refused, and its login is removed. A sandbox or CI job
therefore needs its own credential: see [`VENDURE_CLOUD_TOKEN`](#vendure_cloud_token).

`VENDURE_CONSOLE_API_URL` selects the Console: production
(`https://api.vendure.io`, the default), staging
(`https://staging.api.vendure.io`) or a loopback Console for local development.
Any other value is refused, so the access token is never sent anywhere else.

## Signing in at a terminal

With a person at the terminal, `vendure auth login` shows a one-time code,
opens the browser, and waits until the person approves it. When the person
belongs to more than one organization, the CLI then asks which one to use.
`--organization <Account identifier or name>` chooses it on the command line.

A person is at the terminal when stdin and stdout are both TTYs, the run is not
under `--json` or `vendure mcp`, and neither `CI` nor
`VENDURE_CLI_NON_INTERACTIVE` is set to a true value. The command host
(every command declared with `defineCommand`), `vendure auth login` and
`vendure console link` use this rule to decide whether to ask or sign in.

## Signing in without a terminal

Otherwise no command waits for a person. The login takes two commands, with a
person's approval between them:

1. `vendure auth login --json` starts the device login and returns at once. Its
   result has the pending login in `output`:

    ```json
    {
        "schemaVersion": 1,
        "status": "ok",
        "output": {
            "status": "pending",
            "url": "https://…?user_code=ABCD-EFGH",
            "code": "ABCD-EFGH",
            "expiresAt": "2026-11-24T18:05:00.000Z"
        },
        "notices": [
            {
                "level": "info",
                "message": "Ask a person to open the URL and confirm the code, then run `vendure auth wait` to finish the login."
            }
        ]
    }
    ```

    The device code is saved in `auth-pending.json` next to `auth.json`, mode
    0600, and never appears in the output. A new `auth login --json` replaces it.
    A stored login stays until the new one is approved.

2. Give the URL and code to a person, who opens the URL on any device and
   confirms the code.

3. `vendure auth wait --json` finishes the login. Once the code is approved,
   its `output` is the login, without any token:

    ```json
    {
        "loggedIn": true,
        "consoleApiUrl": "https://api.vendure.io",
        "user": { "id": "user_01…", "email": "ada@example.com", "firstName": "Ada", "lastName": null },
        "organization": {
            "workosOrganizationId": "org_01…",
            "customerAccountId": "79e629da-…",
            "name": "Acme"
        }
    }
    ```

    With `--timeout <seconds>` it returns the pending login in `output` again
    when the time passes first, so the caller can wait again. Without
    `--timeout` it waits for the rest of the code lifetime, or 30 seconds as an
    MCP tool.

Without a terminal nobody is asked which organization to use. The login keeps
the organization chosen in the browser, and `auth wait` adds a notice when the
person belongs to several. To choose one, pass `--organization` to
`vendure auth login --json`: it is saved in `auth-pending.json` and applied
when `auth wait` finishes the login.

Over `vendure mcp` the two commands are the tools `auth_login` and `auth_wait`.

Only one `auth wait` polls at a time, under `auth-pending.lock`. Another one
waits for it, up to its own `--timeout`, and then reports the same outcome: the
login, a denial, an expired code, or a failure after the code was approved. A
failure before approval, such as a network error, ends nothing, and the queued
wait then polls the code itself. When its timeout passes first,
it returns the pending login. The outcome is kept in
`auth-pending-outcome.json`, which records the device code by its hash.

| Result                                       | Code                       | What to do                                |
| -------------------------------------------- | -------------------------- | ----------------------------------------- |
| No login is pending, or its code expired     | `auth.no-pending-login`    | `vendure auth login --json`               |
| The person denied the code                   | `auth.login-denied`        | `vendure auth login --json`               |
| The code expired while waiting               | `auth.login-expired`       | `vendure auth login --json`               |
| Console or the authentication service failed | `auth.login-failed`        | Read the message                          |
| `VENDURE_CONSOLE_API_URL` is not a Console   | `auth.console-api-invalid` | Use production, staging or a loopback URL |

`vendure auth logout` removes any pending login, asks Console to end the
session, and removes the login from this machine. Ending the session is best
effort: when Console cannot be reached, the login is still removed, and a copy
of it keeps working until it expires.

## A missing login

A command that needs a credential looks for one in this order
(`requireCredential` in `@vendure/cli`):

1. the stored login, unless the authentication service refused to renew it;
2. `VENDURE_CLOUD_TOKEN`, when it is set;
3. a device login, only when a person is at the terminal.

A renewal that cannot finish, for example without a network, does not fall
through to `VENDURE_CLOUD_TOKEN`: the command fails with
`auth.credential-failed`, and the stored login is kept.

Without a credential and without a person at the terminal, no command starts a
device flow. It returns an `incomplete` result with exit code 3 and one `input`
need:

```json
{
    "schemaVersion": 1,
    "status": "incomplete",
    "needs": [
        {
            "kind": "input",
            "field": "token",
            "description": "A Vendure Cloud credential: sign in with `vendure auth login`, or set VENDURE_CLOUD_TOKEN to a delegated agent key",
            "secret": true,
            "fix": {
                "path": ["auth", "login"],
                "input": { "json": true },
                "description": "Start a login, and give the person the URL and code it returns"
            }
        }
    ],
    "notices": []
}
```

A command declared with `defineCommand` gets this from the host with
`requires: { auth: 'cloud' }`. `vendure console link` keeps its own JSON result,
with the same need in its `needs` and exit code 1.

## `VENDURE_CLOUD_TOKEN`

A sandbox, an agent or a CI job cannot share a person's login, so it uses its
own credential in `VENDURE_CLOUD_TOKEN`: a delegated agent key that a person
mints with `vendure cloud key delegate`, a command of the Vendure Cloud CLI
plugin. The stored login wins when both are there. The CLI never renews the
token, never prints it, and never gives it to a `vendure console link` plugin
hook that asks for a session: such a hook gets
`sessionUnavailable: 'environment-credential'` instead.

`vendure auth status` reports which credential commands use, `stored-login`,
`environment` or `none`, and never prints the token.

## Steps that need a person

Some steps only a person may take, such as requesting production. Vendure Cloud
and Vendure Console refuse a delegated key there with a `PERSON_REQUIRED` body
that names the step's `action`. `personNeedFromApiError` in `@vendure/cli` turns
that refusal into a `person` need:

```json
{
    "kind": "person",
    "action": "production-request",
    "summary": "Request production for the project in Vendure Console",
    "url": "https://console.vendure.io/…"
}
```

On a terminal the CLI prints the link. The caller runs the same command again
once the person has acted. Nothing is stored in between.

## API

```ts
import {
    loginWithDevice,
    startDeviceLogin,
    completeDeviceLogin,
    getAccessToken,
    refreshAccessToken,
    readAuthStatus,
    checkAuthStatus,
    listOrganizations,
    logout,
    requireCredential,
    personNeedFromApiError,
} from '@vendure/cli';
```

- `loginWithDevice(options)` signs in and stores the login. It is
  `startDeviceLogin`, then `onDeviceAuthorization(device)`, then
  `completeDeviceLogin`. Pass `onDeviceAuthorization` to show the person
  `device.verificationUriComplete` and `device.userCode`: without it, nobody
  sees the code. `organization` (an Account identifier or a name) scopes the
  session to that organization. Without it, `chooseOrganization(organizations,
current)` is called when the person belongs to several, and resolves to the
  one to use, or `undefined` to keep the browser's choice.
- `startDeviceLogin(options)` returns the code to approve without waiting.
  `completeDeviceLogin(login, options)` waits for approval, scopes the session
  to the organization, and stores it. Its `until` option stops waiting at a
  time and throws `DeviceLoginPendingError`. A denied code throws
  `DeviceLoginDeniedError`, an expired one `DeviceLoginExpiredError`.
- `getAccessToken()` returns the stored login's access token, renewed first
  when it is about to expire. Send it as `Authorization: Bearer <token>`. When
  the server still answers 401, call `refreshAccessToken(failedToken)` and
  retry once.
- `readAuthStatus()` describes the stored login without tokens, and makes no
  request. `checkAuthStatus()` does the same after renewing the login, so it
  reports a login the authentication service no longer renews, and removes a
  login whose refresh token it refused.
- `listOrganizations()` lists the Console organizations the signed-in person
  is an active member of.
- `logout()` asks Console to end the session, then removes the login. Ending the
  session is best effort, and the result says whether it happened.
- `requireCredential({ mayPrompt, signIn?, organization? })` applies the order
  above and returns `{ source, token }` or the `incomplete` result. With
  `organization`, a stored login scoped to another organization is skipped.

## Project-link sessions for plugins

A CLI plugin that sets up something after `vendure console link` registers an
`afterConsoleLink` hook. With `requiresSession: true`, the hook's context has
`session`: the stored login's access token and its expiry, without the refresh
token, which stays in the login because it is single-use. Do not store the
token. Call `getAccessToken()` with `VENDURE_CONSOLE_API_URL` set to
`context.endpoints.apiUrl` each time a token is needed, so the CLI renews it.

When the hook gets no session, `context.sessionUnavailable` says why:

- `not-signed-in`: no login for the linked account is stored, and this run
  does not sign in.
- `account-inaccessible`: the signed-in person is not a member of the linked
  account. Do not fall back to `getAccessToken()`.
- `sign-in-failed`: the sign-in failed, and the CLI has said why.
- `environment-credential`: the run uses `VENDURE_CLOUD_TOKEN`, which is never
  given to a hook. Do not fall back to `getAccessToken()`.
