import { randomBytes } from 'node:crypto';

import { RequestContext } from '../../api';
import { BcryptPasswordHashingStrategy } from '../auth/bcrypt-password-hashing-strategy';
import { PasswordHashingStrategy } from '../auth/password-hashing-strategy';

import { ApiKeyStrategy, BaseApiKeyStrategy } from './api-key-strategy';

export const DEFAULT_SIZE_RANDOM_BYTES_SECRET = 32;
export const DEFAULT_SIZE_RANDOM_BYTES_LOOKUP = 12;
export const DEFAULT_LAST_USED_AT_UPDATE_INTERVAL = 0;

/**
 * @see {@link RandomBytesApiKeyStrategy}
 * @since 3.6.0
 */
export interface RandomBytesApiKeyStrategyOptions {
    /**
     * @description
     * The number of bytes to generate. The size must not be larger than 2**31 - 1.
     * This is the input size for `crypto.randomBytes`
     *
     * @default 32
     * @see {@link DEFAULT_SIZE_RANDOM_BYTES_SECRET}
     */
    secretSize?: number;
    /**
     * @description
     * The number of bytes to generate. The size must not be larger than 2**31 - 1.
     * This is the input size for `crypto.randomBytes`
     *
     * @default 12
     * @see {@link DEFAULT_SIZE_RANDOM_BYTES_LOOKUP}
     */
    lookupSize?: number;
    /**
     * @description
     * Defines a custom strategy for how API-Keys get hashed and checked.
     * Performance considerations should be kept in mind, for more info see {@link ApiKeyStrategy}.
     *
     * @default {BcryptPasswordHashingStrategy}
     */
    hashingStrategy?: PasswordHashingStrategy;
    /**
     * @description
     * The main use of the `lastUsedAt`-field is enabling the detection and invalidation of unused API-Keys.
     * By default, every request which gets authorized by an API-Key persists the usage date. This might not
     * be desirable for larger instances, due to the cost of frequent database writes.
     *
     * Defining a longer duration, for example 15 minutes, means that the `lastUsedAt` field will only be
     * written to in 15 minute intervals, resulting in considerably fewer database writes. This technically
     * reduces the accuracy of the `lastUsedAt`-field but keep in mind that when looking for unused keys,
     * what often matters is that a key has been used at all in the last days or weeks and not the specific second.
     *
     * If passed as a number should represent milliseconds and if passed as a string describes a time span per
     * [zeit/ms](https://github.com/zeit/ms.js).  Eg: `5m`, `'1 hour'`, `'10h'`
     *
     * @default 0
     * @see {@link DEFAULT_LAST_USED_AT_UPDATE_INTERVAL}
     */
    lastUsedAtUpdateInterval?: string | number;
}

/**
 * @description
 * A generation strategy that uses `node:crypto` to generate random hex strings for API-Keys via `randomBytes`.
 *
 * This strategy defines API-Keys where both parts are the aforementioned random bytes like so:
 *
 * ```text
 * <lookupId>:<apiKey>
 * ```
 *
 * Note the colon `':'` delimiter between the lookup ID and the api key.
 *
 * @docsCategory auth
 * @docsPage ApiKeyStrategy
 * @since 3.6.0
 */
export class RandomBytesApiKeyStrategy extends BaseApiKeyStrategy {
    readonly secretSize: number;
    readonly lookupSize: number;
    readonly hashingStrategy: PasswordHashingStrategy;

    constructor(input?: RandomBytesApiKeyStrategyOptions) {
        super();
        this.secretSize = input?.secretSize ?? DEFAULT_SIZE_RANDOM_BYTES_SECRET;
        this.lookupSize = input?.lookupSize ?? DEFAULT_SIZE_RANDOM_BYTES_LOOKUP;
        this.lastUsedAtUpdateInterval =
            input?.lastUsedAtUpdateInterval ?? DEFAULT_LAST_USED_AT_UPDATE_INTERVAL;
        this.hashingStrategy = input?.hashingStrategy ?? new BcryptPasswordHashingStrategy();
    }

    generateSecret(ctx: RequestContext): Promise<string> {
        return this.promisifyRandomBytes(this.secretSize);
    }

    generateLookupId(ctx: RequestContext): Promise<string> {
        return this.promisifyRandomBytes(this.lookupSize);
    }

    private promisifyRandomBytes(size: number): Promise<string> {
        return new Promise((resolve, reject) => {
            randomBytes(size, (err, buf) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(buf.toString('hex'));
                }
            });
        });
    }
}
