import { AssetType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { lastValueFrom, Observable, Observer } from 'rxjs';
import { FindOptionsRelations } from 'typeorm/find-options/FindOptionsRelations';

import { RelationPaths } from '../api/decorators/relations.decorator';
import { VendureEntity } from '../entity/base/base.entity';

/**
 * Takes a predicate function and returns a negated version.
 */
export function not(predicate: (...args: any[]) => boolean) {
    return (...args: any[]) => !predicate(...args);
}

/**
 * Returns a predicate function which returns true if the item is found in the set,
 * as determined by a === equality check on the given compareBy property.
 */
export function foundIn<T>(set: T[], compareBy: keyof T) {
    return (item: T) => set.some(t => t[compareBy] === item[compareBy]);
}

/**
 * Identity function which asserts to the type system that a promise which can resolve to T or undefined
 * does in fact resolve to T.
 * Used when performing a "find" operation on an entity which we are sure exists, as in the case that we
 * just successfully created or updated it.
 */
export function assertFound<T>(promise: Promise<T | undefined | null>): Promise<T> {
    return promise as Promise<T>;
}

/**
 * Compare ID values for equality, taking into account the fact that they may not be of matching types
 * (string or number).
 */
export function idsAreEqual(id1?: ID | null, id2?: ID | null): boolean {
    if (id1 == null || id2 == null) {
        return false;
    }
    return id1.toString() === id2.toString();
}

/**
 * Returns the AssetType based on the mime type.
 */
export function getAssetType(mimeType: string): AssetType {
    const type = mimeType.split('/')[0];
    switch (type) {
        case 'image':
            return AssetType.IMAGE;
        case 'video':
            return AssetType.VIDEO;
        default:
            return AssetType.BINARY;
    }
}

/**
 * A simple normalization for email addresses. Lowercases the whole address,
 * even though technically the local part (before the '@') is case-sensitive
 * per the spec. In practice, however, it seems safe to treat emails as
 * case-insensitive to allow for users who might vary the usage of
 * upper/lower case. See more discussion here: https://ux.stackexchange.com/a/16849
 */
export function normalizeEmailAddress(input: string): string {
    return isEmailAddressLike(input) ? input.trim().toLowerCase() : input.trim();
}

/**
 * This is a "good enough" check for whether the input is an email address.
 * From https://stackoverflow.com/a/32686261
 * It is used to determine whether to apply normalization (lower-casing)
 * when comparing identifiers in user lookups. This allows case-sensitive
 * identifiers for other authentication methods.
 */
export function isEmailAddressLike(input: string): boolean {
    if (input.length > 1000) {
        // This limit is in place to prevent abuse via a polynomial-time regex attack
        // See https://github.com/vendurehq/vendure/security/code-scanning/43
        throw new Error('Input too long');
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

/**
 * Converts a value that may be wrapped into a Promise or Observable into a Promise-wrapped
 * value.
 */
export async function awaitPromiseOrObservable<T>(value: T | Promise<T> | Observable<T>): Promise<T> {
    let result = await value;
    if (result instanceof Observable) {
        result = await lastValueFrom(result);
    }
    return result;
}

/**
 * @description
 * Returns an observable which executes the given async work function and completes with
 * the returned value. This is useful in methods which need to return
 * an Observable but also want to work with async (Promise-returning) code.
 *
 * @example
 * ```ts
 * \@Controller()
 * export class MyWorkerController {
 *
 *     \@MessagePattern('test')
 *     handleTest() {
 *         return asyncObservable(async observer => {
 *             const value = await this.connection.fetchSomething();
 *             return value;
 *         });
 *     }
 * }
 * ```
 */
export function asyncObservable<T>(work: (observer: Observer<T>) => Promise<T | void>): Observable<T> {
    return new Observable<T>(subscriber => {
        void (async () => {
            try {
                const result = await work(subscriber);
                if (result) {
                    subscriber.next(result);
                }
                subscriber.complete();
            } catch (e: any) {
                subscriber.error(e);
            }
        })();
    });
}

export function convertRelationPaths<T extends VendureEntity>(
    relationPaths?: RelationPaths<T> | null,
): FindOptionsRelations<T> | undefined {
    const result: FindOptionsRelations<T> = {};
    if (relationPaths == null) {
        return undefined;
    }
    for (const path of relationPaths) {
        const parts = (path as string).split('.');
        let current: any = result;
        for (const [i, part] of Object.entries(parts)) {
            if (!current[part]) {
                current[part] = +i === parts.length - 1 ? true : {};
            }
            current = current[part];
        }
    }
    return result;
}
