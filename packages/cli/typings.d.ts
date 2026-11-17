// This file is for any 3rd party JS libs which don't have a corresponding @types/ package.

declare module 'opn' {
    declare const opn: (path: string) => Promise<any>;
    export default opn;
}

declare module 'i18next-icu' {
    // default
}

declare module 'i18next-fs-backend' {
    // default
}

// Only used by e2e/migrate-command.e2e-spec.ts. A stub avoids adding @types/better-sqlite3
// as a dependency for one test call site.
declare module 'better-sqlite3' {
    class Database {
        constructor(filename: string);
        exec(sql: string): this;
        close(): this;
    }
    export default Database;
}
