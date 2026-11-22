import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';

/**
 * Returns a copy of the environment without the local-trust secret. The processes of a
 * `vendure dev` run (which passes the server its own secret), of `vendure start`, and every process
 * a command starts through `ctx.spawn` get their environment from this, so a secret inherited from
 * the shell does not reach them.
 */
export function withoutLocalTrustSecret(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const copy = { ...env };
    delete copy[LOCAL_TRUST_SECRET_ENV_VAR];
    return copy;
}
