/**
 * The local-trust contract shared with the Vendure CLI, which writes the state file and starts the
 * dev server with the secret in its environment. This is the one place the plugin reads it from.
 *
 * TODO: import these from `@vendure/common/lib/local-trust` once that module is on this branch's
 * base, and delete the local copies.
 */

/** The dev server's state file, relative to the project directory the server runs in. */
export const LOCAL_TRUST_STATE_FILE = '.vendure/devserver.json';

/** The environment variable the CLI passes the per-run secret in. */
export const LOCAL_TRUST_SECRET_ENV_VAR = 'VENDURE_LOCAL_TRUST_SECRET';

/** The one field of the state file that the plugin reads. */
export interface LocalTrustState {
    secret: string;
}
