import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    addCliPluginToProjectConfig,
    detectJsonIndent,
    removeCliPluginFromProjectConfig,
} from './cli-plugin-project-config';

describe('cli-plugin-project-config', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    it('detects space and tab indentation', () => {
        expect(detectJsonIndent('{\n  "name": "x"\n}\n')).toBe(2);
        expect(detectJsonIndent('{\n    "name": "x"\n}\n')).toBe(4);
        expect(detectJsonIndent('{\n\t"name": "x"\n}\n')).toBe('\t');
    });

    it('adds and removes plugins while preserving formatting', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-plugin-config-'));
        tempDirs.push(root);
        const packageJsonPath = path.join(root, 'package.json');
        fs.writeFileSync(
            packageJsonPath,
            `{
\t"name": "demo",
\t"dependencies": {
\t\t"@vendure/cli": "3.0.0",
\t\t"@vendure/cloud": "1.0.0"
\t}
}
`,
            'utf8',
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
        expect(removed.exclude).toEqual(['@vendure/cloud']);

        const rawAfterRemove = fs.readFileSync(packageJsonPath, 'utf8');
        const parsed = JSON.parse(rawAfterRemove);
        expect(parsed.vendure.cli.plugins).toEqual([]);
        expect(parsed.vendure.cli.exclude).toEqual(['@vendure/cloud']);
    });
});
