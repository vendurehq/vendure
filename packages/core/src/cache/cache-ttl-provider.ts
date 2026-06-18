/**
 * @description
 * This interface is used to provide the current time in milliseconds.
 * The reason it is abstracted in this way is so that the cache
 * implementations can be more easily tested.
 *
 * In an actual application you would not need to change the default.
 */
export interface CacheTtlProvider {
    /**
     * @description
     * Returns the current timestamp in milliseconds.
     */
    getTime(): number;
}

/**
 * @description
 * The default implementation of the {@link CacheTtlProvider} which
 * simply returns the current time.
 */
export class DefaultCacheTtlProvider implements CacheTtlProvider {
    /**
     * @description
     * Returns the current timestamp in milliseconds.
     */
    getTime(): number {
        return new Date().getTime();
    }
}

/**
 * @description
 * A testing implementation of the {@link CacheTtlProvider} which
 * allows the time to be set manually.
 */
export class TestingCacheTtlProvider implements CacheTtlProvider {
    private time = 0;

    setTime(timestampInMs: number) {
        this.time = timestampInMs;
    }

    incrementTime(ms: number) {
        this.time += ms;
    }

    getTime(): number {
        return this.time;
    }
}
