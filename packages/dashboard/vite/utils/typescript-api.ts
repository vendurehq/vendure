import type { SourceFile } from 'typescript/ast';
import { API } from 'typescript/sync';

let sharedApi: API | undefined;

/**
 * Returns a lazily-created, shared instance of the TypeScript 7 API. Creating it spawns
 * the native `tsgo` process, which does not keep the Node.js process alive.
 */
export function getTypeScriptApi(): API {
    if (!sharedApi) {
        sharedApi = new API({ cwd: process.cwd() });
    }
    return sharedApi;
}

/**
 * Parses the given source text, passes the AST to `fn`, and then releases the
 * source file held by the TypeScript API.
 */
export async function withSourceFile<T>(
    fileName: string,
    sourceText: string,
    fn: (sourceFile: SourceFile) => T | Promise<T>,
): Promise<T> {
    const lease = getTypeScriptApi().createSourceFile(fileName, sourceText);
    try {
        return await fn(lease.sourceFile);
    } finally {
        lease.dispose();
    }
}

/**
 * Synchronous variant of {@link withSourceFile}.
 */
export function withSourceFileSync<T>(
    fileName: string,
    sourceText: string,
    fn: (sourceFile: SourceFile) => T,
): T {
    const lease = getTypeScriptApi().createSourceFile(fileName, sourceText);
    try {
        return fn(lease.sourceFile);
    } finally {
        lease.dispose();
    }
}
