# Console authentication

How the Vendure CLI signs in to Vendure Console, and the API that `@vendure/cli`
exports for it. Importing the package does not run a command, open a browser,
bind a port, or load a private package.

## The login

The CLI signs in with the WorkOS device flow. The WorkOS client is the one the
selected Vendure Console publishes at `GET /v1`, so Console always accepts the
tokens. The login is stored in `auth.json` in the CLI configuration directory
(`~/.config/vendure` by default, or `VENDURE_CLI_CONFIG_DIR`), readable only by
the user. `vendure auth login`, `vendure console link` and Vendure Cloud share
this one login.

The refresh token is single-use and rotates on every renewal. Every renewal
and every write of `auth.json` happens under a file lock (`auth.lock`), so two
`vendure` processes never spend the same refresh token. A copy of `auth.json`
on another machine stops working at the first renewal of either copy, so a
sandbox or CI job needs its own credential: see
[`VENDURE_CLOUD_TOKEN`](#vendure_cloud_token).

`VENDURE_CONSOLE_API_URL` selects the staging Console
(`https://staging.api.vendure.io`) or a loopback Console for local development.
Any other value is refused, so the access token is never sent anywhere else.

## Signing in at a terminal

With a person at the terminal, `vendure auth login` shows a one-time code,
opens the browser, and waits until the person approves it. When the person
belongs to more than one organization, the CLI then asks which one to use.
`--organization <Account identifier or name>` chooses it on the command line.

A person is at the terminal when stdin and stdout are both TTYs, the run is not
under `--json` or `vendure mcp`, and neither `CI` nor
`VENDURE_CLI_NON_INTERACTIVE` is set. Every command uses this one rule.

## Signing in without a terminal

Otherwise no command waits for a person. The login is split in two steps:

1. `vendure auth login --json` starts the device login and returns at once:

    ```json
    {
        "status": "pending",
        "url": "https://…?user_code=ABCD-EFGH",
        "code": "ABCD-EFGH",
        "expiresAt": "2026-11-24T18:05:00.000Z"
    }
    ```

    The device code is saved in `auth-pending.json` next to `auth.json`, mode
    0600, and never appears in the output. A new `auth login --json` replaces it.
    A stored login stays until the new one is approved.

2. Give the URL and code to a person, who opens the URL on any device and
   confirms the code.

3. `vendure auth wait --json` finishes the login. It returns
   `{ "loggedIn": true, "consoleApiUrl", "user", "organization" }` once the code
   is approved, without any token. With `--timeout <seconds>` it returns the
   pending login again when the time passes first, so the caller can wait
   again. Without `--timeout` it waits for the rest of the code lifetime, or 30
   seconds as an MCP tool.

Over `vendure mcp` the two steps are the tools `auth_login` and `auth_wait`.

Only one `auth wait` polls at a time, under `auth-pending.lock`. Another one
waits for it and then reports the same outcome: the login, a denial or an
expired code. That outcome is kept in `auth-pending-outcome.json`, named by a
hash of the device code.

| Result                                       | Code                    | What to do                  |
| -------------------------------------------- | ----------------------- | --------------------------- |
| No login is pending, or its code expired     | `auth.no-pending-login` | `vendure auth login --json` |
| The person denied the code                   | `auth.login-denied`     | `vendure auth login --json` |
| The code expired while waiting               | `auth.login-expired`    | `vendure auth login --json` |
| Console or the authentication service failed | `auth.login-failed`     | Read the message            |

`vendure auth logout` asks Console to end the session, then removes the login
and any pending login from this machine.

## A missing login

A command that needs a credential looks for one in this order
(`requireCredential` in `@vendure/cli`):

1. the stored login, when the authentication service still renews it;
2. `VENDURE_CLOUD_TOKEN`, when it is set;
3. a device login, only when a person is at the terminal.

Otherwise it never starts a device flow. Under `--json` it returns an
`incomplete` result with exit code 3 and one `input` need:

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
mints with `vendure cloud key delegate`. The stored login wins when both are
there. The CLI never renews the token, never prints it, and never gives it to
a `vendure console link` plugin hook that asks for a session: such a hook gets
`sessionUnavailable: 'environment-credential'` instead.

`vendure auth status` reports which credential commands use, `stored-login`,
`environment` or `none`, and never prints the token.

## Steps that need a person

Some steps only a person may take, such as requesting production. Vendure Cloud
and Vendure Console refuse a delegated key there with 403 `PERSON_REQUIRED` and
the step's `action`. `personNeedFromApiError` in `@vendure/cli` turns that
refusal into a `person` need:

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
  `startDeviceLogin` followed by `completeDeviceLogin`.
- `startDeviceLogin(options)` returns the code to approve without waiting.
  `completeDeviceLogin(login, options)` waits for approval, scopes the session
  to the organization, and stores it. Its `until` option stops waiting at a
  time and throws `DeviceLoginPendingError`. A denied code throws
  `DeviceLoginDeniedError`, an expired one `DeviceLoginExpiredError`.
- `getAccessToken()` returns the stored login's access token, renewed first
  when it is about to expire. Send it as `Authorization: Bearer <token>`. When
  the server still answers 401, call `refreshAccessToken(failedToken)` and
  retry once.
- `requireCredential({ mayPrompt, signIn? })` applies the rule above and
  returns `{ source, token }` or the `incomplete` result.

### Deprecated: the PKCE browser login

`loginWithBrowser` and `refreshSession` signed in through Console's `/cli-auth`
page with a PKCE loopback callback. No command uses them since the device
login. They stay exported for callers from 3.8 and are removed in a later
major. Use `loginWithDevice` and `getAccessToken` instead.
