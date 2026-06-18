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
