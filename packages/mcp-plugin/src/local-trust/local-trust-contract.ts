/**
 * The local-trust contract shared with the Vendure CLI, which writes the state file, starts the dev
 * server with the secret in its environment, and reads the endpoint URL from the server's log. This
 * file holds every part of that contract the plugin uses.
 *
 * TODO: once `@vendure/common` exports them, import `LOCAL_TRUST_STATE_FILE`,
 * `LOCAL_TRUST_SECRET_ENV_VAR` and `LocalTrustState` from `@vendure/common/lib/local-trust`, and
 * `MCP_ADMIN_ENDPOINT_LOG_PREFIX` from `@vendure/common/lib/log`, then delete the copies here.
 */

/** The dev server's state file, relative to the project directory the server runs in. */
export const LOCAL_TRUST_STATE_FILE = '.vendure/devserver.json';

/** The environment variable the CLI passes the per-run secret in. */
export const LOCAL_TRUST_SECRET_ENV_VAR = 'VENDURE_LOCAL_TRUST_SECRET';

/** The one field of the state file that the plugin reads. */
export interface LocalTrustState {
    secret: string;
}

/**
 * The startup log line that names the admin MCP endpoint, followed by its URL. The Vendure CLI
 * parses it, so it must not change.
 */
export const MCP_ADMIN_ENDPOINT_LOG_PREFIX = 'Store MCP admin endpoint: ';
