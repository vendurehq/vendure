import { Storage } from '@graphiql/toolkit';

/**
 * A storage implementation that does nothing,
 * because in embedded mode we don't want to
 * persist anything.
 */
export const embeddedModeStorage: Storage = {
    clear(): void {
        /* empty */
    },
    getItem(key: string): string | null {
        return null;
    },
    length: 0,
    removeItem(key: string): void {
        return;
    },
    setItem(key: string, value: string) {
        return;
    },
};
