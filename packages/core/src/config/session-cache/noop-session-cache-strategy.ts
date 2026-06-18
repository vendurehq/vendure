import { CachedSession, SessionCacheStrategy } from './session-cache-strategy';

/**
 * @description
 * A cache that doesn't cache. The cache lookup will miss every time
 * so the session will always be taken from the database.
 *
 * @docsCategory auth
 */
export class NoopSessionCacheStrategy implements SessionCacheStrategy {
    clear() {
        return undefined;
    }

    delete(sessionToken: string) {
        return undefined;
    }

    get(sessionToken: string) {
        return undefined;
    }

    set(session: CachedSession) {
        return undefined;
    }
}
