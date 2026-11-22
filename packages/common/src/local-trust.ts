/*
 * The local-trust contract between `vendure dev` and the server it starts.
 *
 * Each `vendure dev` run generates one secret. It passes the secret to the server child
 * in the {@link LOCAL_TRUST_SECRET_ENV_VAR} environment variable, and writes it to the
 * {@link LOCAL_TRUST_STATE_FILE} in the project directory with mode 0600. The server
 * accepts the secret only when the file exists and holds the same secret.
 *
 * This file holds constants and types only, so it is safe to import in the browser.
 */

/**
 * The path of the state file which `vendure dev` writes, relative to the project directory.
 */
export const LOCAL_TRUST_STATE_FILE = '.vendure/devserver.json';

/**
 * The name of the environment variable in which `vendure dev` passes the secret of the
 * current run to the server child.
 */
export const LOCAL_TRUST_SECRET_ENV_VAR = 'VENDURE_LOCAL_TRUST_SECRET';

/**
 * The part of the state file which the server reads to check a local-trust secret. The
 * file holds more fields, which are written and read by `@vendure/cli`.
 */
export interface LocalTrustState {
    /**
     * The secret of the current `vendure dev` run.
     */
    secret: string;
}

/**
 * The start of the line which the McpPlugin logs when the server starts, followed by the URL of
 * its admin endpoint, for example `Store MCP admin endpoint: http://localhost:3000/mcp/admin`.
 * `vendure dev` reads the URL from this line.
 */
export const MCP_ADMIN_ENDPOINT_LOG_PREFIX = 'Store MCP admin endpoint: ';
