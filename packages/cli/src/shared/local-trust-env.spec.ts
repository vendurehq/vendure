import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { describe, expect, it } from 'vitest';

import { withoutLocalTrustSecret } from './local-trust-env.js';

describe('withoutLocalTrustSecret()', () => {
    it('removes the secret and keeps the rest of the environment', () => {
        const env = { PATH: '/usr/bin', [LOCAL_TRUST_SECRET_ENV_VAR]: 'from-the-shell' };

        expect(withoutLocalTrustSecret(env)).toEqual({ PATH: '/usr/bin' });
        expect(env[LOCAL_TRUST_SECRET_ENV_VAR]).toBe('from-the-shell');
    });
});
