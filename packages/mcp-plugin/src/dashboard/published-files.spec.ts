import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dashboard sources are shipped as-is and compiled by the consumer's Vite build, so every
 * relative import they make must point at a file that the package.json `files` list publishes.
 */
describe('published dashboard sources', () => {
    const packageRoot = resolve(__dirname, '../..');
    const dashboardDir = join(packageRoot, 'src/dashboard');
    // Mirrors the `files` list in package.json: only these source folders reach the published package.
    const publishedSourceDirs = ['src/dashboard/', 'src/shared/'];

    function isPublished(relativePath: string): boolean {
        return publishedSourceDirs.some(dir => relativePath.startsWith(dir));
    }

    function sourceFiles(dir: string): string[] {
        return readdirSync(dir).flatMap(name => {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                return sourceFiles(full);
            }
            return /\.(ts|tsx)$/.test(name) && !name.endsWith('.spec.ts') ? [full] : [];
        });
    }

    function resolveImport(fromFile: string, specifier: string): string | undefined {
        const base = resolve(dirname(fromFile), specifier);
        for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
            if (existsSync(candidate) && statSync(candidate).isFile()) {
                return candidate;
            }
        }
        return undefined;
    }

    it('only imports files that the package publishes', () => {
        const unpublished: string[] = [];
        for (const file of sourceFiles(dashboardDir)) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
                const target = resolveImport(file, match[1]);
                expect(target, `${relative(packageRoot, file)} imports ${match[1]}`).toBeDefined();
                if (target && !isPublished(relative(packageRoot, target))) {
                    unpublished.push(`${relative(packageRoot, file)} -> ${relative(packageRoot, target)}`);
                }
            }
        }
        expect(unpublished).toEqual([]);
    });
});
