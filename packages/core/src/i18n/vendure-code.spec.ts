import { ErrorCode as ShopErrorCode } from '@vendure/common/lib/generated-shop-types';
import { ErrorCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { EntityNotFoundError, ForbiddenError, InternalServerError } from '../common/error/errors';

import { I18nError } from './i18n-error';
import en from './messages/en.json';
import { getErrorResultVendureCode, toVendureCode, UNEXPECTED_VENDURE_CODE } from './vendure-code';
import snapshot from './vendure-codes.snapshot.json';

describe('toVendureCode()', () => {
    it('namespaces an error key', () => {
        expect(toVendureCode('error.entity-with-id-not-found')).toBe('core.entity-with-id-not-found');
    });

    it('kebab-cases an ErrorResult key', () => {
        expect(toVendureCode('errorResult.COUPON_CODE_EXPIRED_ERROR')).toBe('core.coupon-code-expired-error');
    });

    it('uses the given namespace', () => {
        expect(toVendureCode('error.review-not-found', 'reviews')).toBe('reviews.review-not-found');
    });

    it('returns the unexpected code for text which is not an error key', () => {
        expect(toVendureCode('Something went wrong')).toBe(UNEXPECTED_VENDURE_CODE);
        expect(toVendureCode('message.asset-to-be-deleted-is-featured')).toBe(UNEXPECTED_VENDURE_CODE);
        expect(toVendureCode('error.')).toBe(UNEXPECTED_VENDURE_CODE);
    });

    it('derives an ErrorResult code from its errorCode', () => {
        expect(getErrorResultVendureCode({ errorCode: 'INSUFFICIENT_STOCK_ERROR' })).toBe(
            'core.insufficient-stock-error',
        );
    });
});

describe('I18nError.vendureCode', () => {
    it('is built from the message key', () => {
        expect(new EntityNotFoundError('Product', 1).vendureCode).toBe('core.entity-with-id-not-found');
        expect(new ForbiddenError().vendureCode).toBe('core.forbidden');
    });

    it('is the unexpected code for a plain-text message', () => {
        expect(new InternalServerError('Plugin "Foo" failed').vendureCode).toBe(UNEXPECTED_VENDURE_CODE);
    });

    it("uses the static namespace of a plugin's error class", () => {
        class ReviewNotFoundError extends I18nError {
            static namespace = 'reviews';
            constructor() {
                super('error.review-not-found', {}, 'ENTITY_NOT_FOUND');
            }
        }
        class ReviewLockedError extends ReviewNotFoundError {}

        expect(new ReviewNotFoundError().vendureCode).toBe('reviews.review-not-found');
        expect(new ReviewLockedError().vendureCode).toBe('reviews.review-not-found');
    });
});

/**
 * Codes are stable across releases: a client or an agent may act on them. This test compares the codes
 * of the core error keys and ErrorResults with `vendure-codes.snapshot.json`.
 *
 * - A new key: add its code to `codes` in the snapshot.
 * - A renamed or removed key: keep the old code in `codes`, and add it to `aliases`, mapping it to the
 *   code that replaces it. Never remove a code from `codes`.
 */
describe('core Vendure codes', () => {
    const i18nErrorCodes = Object.keys(en.error).map(key => toVendureCode(`error.${key}`));
    const errorResultCodes = [...new Set([...Object.values(ErrorCode), ...Object.values(ShopErrorCode)])].map(
        errorCode => getErrorResultVendureCode({ errorCode }),
    );
    const currentCodes = new Set([UNEXPECTED_VENDURE_CODE, ...i18nErrorCodes, ...errorResultCodes]);
    const snapshotCodes = new Set<string>(snapshot.codes);
    const aliases: Record<string, string> = snapshot.aliases;

    it('every error key gives a valid code', () => {
        for (const code of i18nErrorCodes) {
            expect(code).not.toBe(UNEXPECTED_VENDURE_CODE);
            expect(code).toMatch(/^core\.[a-z0-9]+(-[a-z0-9]+)*$/);
        }
    });

    it('no I18nError code clashes with an ErrorResult code', () => {
        const clashes = i18nErrorCodes.filter(code => errorResultCodes.includes(code));
        expect(clashes).toEqual([]);
    });

    it('every current code is in the snapshot', () => {
        const missing = [...currentCodes].filter(code => !snapshotCodes.has(code));
        expect(missing, 'Add these codes to vendure-codes.snapshot.json').toEqual([]);
    });

    it('every code in the snapshot is still produced, or has an alias', () => {
        const removed = [...snapshotCodes].filter(code => !currentCodes.has(code) && !aliases[code]);
        expect(
            removed,
            'These codes are no longer produced. Add each one to "aliases" in vendure-codes.snapshot.json, ' +
                'mapped to the code that replaces it',
        ).toEqual([]);
    });

    it('every alias maps a code from the snapshot to a current code', () => {
        for (const [oldCode, newCode] of Object.entries(aliases)) {
            expect(snapshotCodes.has(oldCode), `${oldCode} is not in "codes"`).toBe(true);
            expect(currentCodes.has(oldCode), `${oldCode} is still produced, so it needs no alias`).toBe(
                false,
            );
            expect(currentCodes.has(newCode), `${newCode} is not a current code`).toBe(true);
        }
    });

    it('lists the codes in sorted order', () => {
        expect(snapshot.codes).toEqual([...snapshot.codes].sort());
    });
});
