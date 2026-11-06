import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    compilesWithTypeScript7,
    getBuildTypeScriptVersion,
    getInstalledTypeScriptVersion,
} from './project-typescript';

describe('project-typescript', () => {
    describe('compilesWithTypeScript7()', () => {
        it.each(['5.4.5', '5.8.2', '6.0.3'])('is false for TypeScript %s', version => {
            expect(compilesWithTypeScript7(version)).toBe(false);
        });

        it.each(['7.0.2', '7.1.0-beta', '7.1.0-dev.20261105.1', '7.1.3', '8.0.0'])(
            'is true for TypeScript %s',
            version => {
                expect(compilesWithTypeScript7(version)).toBe(true);
            },
        );

        it('is true when the version is unknown, which keeps the checks', () => {
            expect(compilesWithTypeScript7(undefined)).toBe(true);
        });
    });

    describe('TypeScript version resolution', () => {
        let projectDir: string;

        beforeEach(() => {
            projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-project-ts-'));
            writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'project' }));
        });

        afterEach(() => {
            rmSync(projectDir, { recursive: true, force: true });
        });

        it("reads the project's own TypeScript version from its package.json", () => {
            const packageDir = path.join(projectDir, 'node_modules', 'typescript');
            mkdirSync(packageDir, { recursive: true });
            writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ version: '5.8.2' }));

            expect(getInstalledTypeScriptVersion(projectDir)).toBe('5.8.2');
            expect(getBuildTypeScriptVersion(projectDir)).toBe('5.8.2');
        });

        it("falls back to the CLI's own TypeScript for the build, like the build's tsc resolution", () => {
            expect(getInstalledTypeScriptVersion(projectDir)).toBeUndefined();
            expect(getBuildTypeScriptVersion(projectDir)).toMatch(/^7\./);
        });
    });
});
