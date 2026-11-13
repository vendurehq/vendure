/**
 * Returns true if the given error represents a foreign key constraint violation
 * across supported drivers (Postgres, MySQL/MariaDB, SQLite).
 */
export function isForeignKeyViolationError(e: unknown): boolean {
    const err: any = e || {};
    const code = err.code ?? err.driverError?.code ?? err.errno ?? err.driverError?.errno;

    // Postgres: 23503, MySQL/MariaDB: 1451/1452, SQLite: SQLITE_CONSTRAINT_FOREIGNKEY,
    if (code === '23503' || code === 1451 || code === 1452 || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return true;
    }
    const msg = String(err.message ?? err.driverError?.message ?? '');
    return /\bforeign key\b/i.test(msg);
}

/**
 * Returns true if the given error represents a unique constraint violation
 * across supported drivers (Postgres, MySQL/MariaDB, SQLite).
 */
export function isUniqueConstraintViolationError(e: unknown): boolean {
    const err: any = e || {};
    const code = err.code ?? err.driverError?.code ?? err.errno ?? err.driverError?.errno;

    // Postgres: 23505, MySQL/MariaDB: ER_DUP_ENTRY/1062, better-sqlite3: SQLITE_CONSTRAINT_UNIQUE.
    // The sqlite3 and sql.js drivers only report a generic constraint code (or none at all), so
    // they are recognised by their "UNIQUE constraint failed" message below. A bare
    // SQLITE_CONSTRAINT code is deliberately not matched: it also covers foreign key, not-null and
    // check constraint failures.
    if (code === '23505' || code === 'ER_DUP_ENTRY' || code === 1062 || code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return true;
    }
    // Postgres: "duplicate key value violates unique constraint", SQLite: "UNIQUE constraint failed"
    const msg = String(err.message ?? err.driverError?.message ?? '');
    return /\bunique constraint\b/i.test(msg);
}
