import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    formatTsDiagnostics,
    getTsConfigProgramErrors,
    parseTsConfigFile,
    shouldUseColor,
} from './typescript-api';

describe('typescript-api', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-ts-api-'));
        mkdirSync(path.join(tempDir, 'src'));
        writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const value = 1;\n');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function writeTsConfig(compilerOptions: Record<string, unknown>) {
        const tsconfigPath = path.join(tempDir, 'tsconfig.json');
        writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions, include: ['src/**/*.ts'] }));
        return tsconfigPath;
    }

    describe('getTsConfigProgramErrors()', () => {
        it('returns no errors for a TypeScript 7 compatible tsconfig', () => {
            const tsconfigPath = writeTsConfig({
                module: 'nodenext',
                moduleResolution: 'nodenext',
                outDir: './dist',
                rootDir: './src',
            });

            expect(getTsConfigProgramErrors(tsconfigPath)).toEqual([]);
        });

        it('reports options removed in TypeScript 7 which parseTsConfigFile() accepts', () => {
            const tsconfigPath = writeTsConfig({
                module: 'commonjs',
                moduleResolution: 'node',
                baseUrl: './',
                outDir: './dist',
            });

            // parseConfigFile does not report these, which is why the program check is needed
            expect(() => parseTsConfigFile(tsconfigPath)).not.toThrow();

            const codes = getTsConfigProgramErrors(tsconfigPath).map(d => d.code);
            expect(codes).toContain(5102); // baseUrl has been removed
            expect(codes).toContain(5108); // moduleResolution=node10 has been removed
            expect(codes).toContain(5011); // rootDir must be set explicitly
        });
    });

    describe('shouldUseColor()', () => {
        it('uses colours for a TTY', () => {
            expect(shouldUseColor({ isTTY: true }, {})).toBe(true);
        });

        it('does not use colours when the stream is not a TTY', () => {
            expect(shouldUseColor({ isTTY: false }, {})).toBe(false);
        });

        it.each([{ NO_COLOR: '1' }, { NO_COLOR: '' }, { NODE_DISABLE_COLORS: '1' }])(
            'does not use colours for a TTY when %o is set',
            env => {
                expect(shouldUseColor({ isTTY: true }, env)).toBe(false);
            },
        );

        it.each(['1', 'true', '3'])('forces colours when FORCE_COLOR=%s, even with NO_COLOR', value => {
            expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: value, NO_COLOR: '1' })).toBe(true);
        });

        it.each(['0', 'false'])('turns colours off when FORCE_COLOR=%s', value => {
            expect(shouldUseColor({ isTTY: true }, { FORCE_COLOR: value })).toBe(false);
        });
    });

    describe('formatTsDiagnostics()', () => {
        it('does not emit ANSI colour codes when color is false', () => {
            const tsconfigPath = writeTsConfig({ baseUrl: './' });
            const errors = getTsConfigProgramErrors(tsconfigPath);

            const output = formatTsDiagnostics(errors, { color: false });

            expect(output).toContain('TS5102');
            // eslint-disable-next-line no-control-regex
            expect(output).not.toMatch(/\u001b\[/);
        });

        it('emits colours when color is true', () => {
            const tsconfigPath = writeTsConfig({ baseUrl: './' });
            const errors = getTsConfigProgramErrors(tsconfigPath);

            const output = formatTsDiagnostics(errors, { color: true });

            // eslint-disable-next-line no-control-regex
            expect(output).toMatch(/\u001b\[/);
        });
    });
});
