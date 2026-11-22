import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';

/**
 * Returns a copy of the environment without the local-trust secret. Every process the CLI starts,
 * apart from the server of a `vendure dev` run, gets its environment from this, so a secret
 * inherited from the shell never reaches it.
 */
export function withoutLocalTrustSecret(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const copy = { ...env };
    delete copy[LOCAL_TRUST_SECRET_ENV_VAR];
    return copy;
}
