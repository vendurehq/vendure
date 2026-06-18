import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { findConfigExport } from './ast-utils.js';

describe('findConfigExport', () => {
    it('should return undefined when no VendureConfig export is found', { timeout: 30_000 }, () => {
        const sourceText = `
            export const notConfig = {
                some: 'value'
            };
        `;
        const sourceFile = ts.createSourceFile('path/to/test.ts', sourceText, ts.ScriptTarget.Latest, true);
        const result = findConfigExport(sourceFile);
        expect(result).toBeUndefined();
    });

    it('should find exported variable with VendureConfig type', { timeout: 30_000 }, () => {
        const sourceText = `
            import { VendureConfig } from '@vendure/core';

            export const config: VendureConfig = {
                authOptions: {
                    tokenMethod: 'bearer'
                }
            };
        `;
        const sourceFile = ts.createSourceFile('path/to/test.ts', sourceText, ts.ScriptTarget.Latest, true);
        const result = findConfigExport(sourceFile);
        expect(result).toBe('config');
    });

    it(
        'should find exported variable with VendureConfig type among other exports',
        { timeout: 30_000 },
        () => {
            const sourceText = `
            import { VendureConfig } from '@vendure/core';

            export const otherExport = 'value';
            export const config: VendureConfig = {
                authOptions: {
                    tokenMethod: 'bearer'
                }
            };
            export const anotherExport = 123;
        `;
            const sourceFile = ts.createSourceFile(
                'path/to/test.ts',
                sourceText,
                ts.ScriptTarget.Latest,
                true,
            );
            const result = findConfigExport(sourceFile);
            expect(result).toBe('config');
        },
    );
});
