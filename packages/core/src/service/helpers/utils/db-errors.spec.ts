import { describe, expect, it } from 'vitest';

import { isForeignKeyViolationError, isUniqueConstraintViolationError } from './db-errors';

describe('isUniqueConstraintViolationError()', () => {
    it('recognises a Postgres unique violation by code', () => {
        expect(isUniqueConstraintViolationError({ code: '23505', message: 'anything' })).toBe(true);
    });

    it('recognises a Postgres unique violation by message', () => {
        expect(
            isUniqueConstraintViolationError({
                message: 'duplicate key value violates unique constraint "UQ_dcc35f0d2b8d422634e878b813c"',
            }),
        ).toBe(true);
    });

    it('recognises a MySQL/MariaDB duplicate entry by code, errno, and nested driverError', () => {
        expect(
            isUniqueConstraintViolationError({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'de-21'" }),
        ).toBe(true);
        expect(isUniqueConstraintViolationError({ errno: 1062, message: "Duplicate entry 'de-21'" })).toBe(
            true,
        );
        expect(
            isUniqueConstraintViolationError({
                message: 'query failed',
                driverError: { code: 'ER_DUP_ENTRY', errno: 1062 },
            }),
        ).toBe(true);
    });

    it('recognises a better-sqlite3 unique violation by code', () => {
        expect(
            isUniqueConstraintViolationError({
                code: 'SQLITE_CONSTRAINT_UNIQUE',
                message:
                    'UNIQUE constraint failed: product_translation.languageCode, product_translation.baseId',
            }),
        ).toBe(true);
    });

    it('recognises sqlite3 and sql.js unique violations by message', () => {
        // sqlite3 reports the generic constraint code plus the specific message
        expect(
            isUniqueConstraintViolationError({
                code: 'SQLITE_CONSTRAINT',
                errno: 19,
                message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: product_translation.languageCode',
            }),
        ).toBe(true);
        // sql.js reports no code at all
        expect(
            isUniqueConstraintViolationError({
                message:
                    'UNIQUE constraint failed: product_translation.languageCode, product_translation.baseId',
            }),
        ).toBe(true);
    });

    it('does not treat a bare SQLITE_CONSTRAINT code as a unique violation', () => {
        expect(
            isUniqueConstraintViolationError({
                code: 'SQLITE_CONSTRAINT',
                errno: 19,
                message: 'SQLITE_CONSTRAINT: FOREIGN KEY constraint failed',
            }),
        ).toBe(false);
        expect(
            isUniqueConstraintViolationError({
                code: 'SQLITE_CONSTRAINT',
                message: 'SQLITE_CONSTRAINT: NOT NULL constraint failed: product_translation.name',
            }),
        ).toBe(false);
    });

    it('does not treat other constraint violations as unique violations', () => {
        expect(
            isUniqueConstraintViolationError({ code: '23503', message: 'violates foreign key constraint' }),
        ).toBe(false);
        expect(
            isUniqueConstraintViolationError({ code: 1452, message: 'Cannot add or update a child row' }),
        ).toBe(false);
    });

    it('does not match on the word "unique" alone', () => {
        expect(isUniqueConstraintViolationError({ message: 'column "unique_slug" does not exist' })).toBe(
            false,
        );
        expect(
            isUniqueConstraintViolationError({ message: 'Unique index IDX_foo could not be created' }),
        ).toBe(false);
    });

    it('handles non-error inputs', () => {
        expect(isUniqueConstraintViolationError(undefined)).toBe(false);
        expect(isUniqueConstraintViolationError(null)).toBe(false);
        expect(isUniqueConstraintViolationError(new Error('connection lost'))).toBe(false);
    });
});

describe('isForeignKeyViolationError()', () => {
    it('recognises foreign key violations across drivers', () => {
        expect(isForeignKeyViolationError({ code: '23503', message: 'x' })).toBe(true);
        expect(isForeignKeyViolationError({ code: 1451, message: 'x' })).toBe(true);
        expect(isForeignKeyViolationError({ errno: 1452, message: 'x' })).toBe(true);
        expect(isForeignKeyViolationError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY', message: 'x' })).toBe(true);
        expect(
            isForeignKeyViolationError({ message: 'SQLITE_CONSTRAINT: FOREIGN KEY constraint failed' }),
        ).toBe(true);
    });

    it('does not treat unique violations as foreign key violations', () => {
        expect(isForeignKeyViolationError({ code: '23505', message: 'violates unique constraint' })).toBe(
            false,
        );
        expect(isForeignKeyViolationError({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry' })).toBe(false);
        expect(isForeignKeyViolationError({ message: 'UNIQUE constraint failed: t.col' })).toBe(false);
    });
});
