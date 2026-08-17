import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    addCliPluginToProjectConfig,
    detectJsonIndent,
    mergeEnabledPluginSelection,
    removeCliPluginFromProjectConfig,
} from './cli-plugin-project-config';

describe('cli-plugin-project-config', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeProject(rawPackageJson: string): { root: string; packageJsonPath: string } {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-plugin-config-'));
        tempDirs.push(root);
        const packageJsonPath = path.join(root, 'package.json');
        fs.writeFileSync(packageJsonPath, rawPackageJson, 'utf8');
        return { root, packageJsonPath };
    }

    it('detects space and tab indentation', () => {
        expect(detectJsonIndent('{\n  "name": "x"\n}\n')).toBe(2);
        expect(detectJsonIndent('{\n    "name": "x"\n}\n')).toBe(4);
        expect(detectJsonIndent('{\n\t"name": "x"\n}\n')).toBe('\t');
    });

    it('adds and removes plugins while preserving formatting', () => {
        const { root, packageJsonPath } = makeProject(
            `{
\t"name": "demo",
\t"dependencies": {
\t\t"@vendure/cli": "3.0.0",
\t\t"@vendure/cloud": "1.0.0"
\t}
}
`,
        );

        const added = addCliPluginToProjectConfig('@vendure/cloud', root);
        expect(added.packageJsonPath).toBe(packageJsonPath);
        expect(added.plugins).toEqual(['@vendure/cloud']);

        const rawAfterAdd = fs.readFileSync(packageJsonPath, 'utf8');
        expect(rawAfterAdd.startsWith('{\n\t"name"')).toBe(true);
        expect(rawAfterAdd.endsWith('\n')).toBe(true);
        expect(JSON.parse(rawAfterAdd).vendure.cli.plugins).toEqual(['@vendure/cloud']);

        const removed = removeCliPluginFromProjectConfig('@vendure/cloud', root);
        expect(removed.plugins).toEqual([]);

        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        expect(parsed.vendure.cli.plugins).toEqual([]);
        // Explicit activation: disabling is not being listed, no exclude list.
        expect(parsed.vendure.cli.exclude).toBeUndefined();
    });

    it('preserves CRLF line endings', () => {
        const { root, packageJsonPath } = makeProject(
            '{\r\n  "name": "demo",\r\n  "dependencies": {\r\n    "@vendure/cli": "3.0.0"\r\n  }\r\n}\r\n',
        );

        addCliPluginToProjectConfig('@vendure/cloud', root);

        const raw = fs.readFileSync(packageJsonPath, 'utf8');
        expect(raw.endsWith('\r\n')).toBe(true);
        expect(raw.includes('\n')).toBe(true);
        // Every newline is CRLF — no bare LF remains.
        expect(raw.replace(/\r\n/g, '').includes('\n')).toBe(false);
        expect(JSON.parse(raw).vendure.cli.plugins).toEqual(['@vendure/cloud']);
    });

    describe('mergeEnabledPluginSelection()', () => {
        it('keeps entries that were not offered for toggling (e.g. failed plugins)', () => {
            expect(
                mergeEnabledPluginSelection(
                    ['@example/failed', '@example/a'],
                    ['@example/a', '@example/b'],
                    ['@example/a', '@example/b'],
                ),
            ).toEqual(['@example/failed', '@example/a', '@example/b']);
        });

        it('removes unselected toggleable entries and preserves order', () => {
            expect(
                mergeEnabledPluginSelection(
                    ['@example/c', '@example/a'],
                    ['@example/a', '@example/b', '@example/c'],
                    ['@example/c', '@example/b'],
                ),
            ).toEqual(['@example/c', '@example/b']);
        });

        it('appends newly selected plugins at the end', () => {
            expect(mergeEnabledPluginSelection([], ['@example/a'], ['@example/a'])).toEqual([
                '@example/a',
            ]);
        });
    });
});
