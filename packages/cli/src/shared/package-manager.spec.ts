import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addDevDependencyCommand, detectProjectPackageManager } from './package-manager';

describe('package manager detection', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeTempDir(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-package-manager-'));
        tempDirs.push(dir);
        return dir;
    }

    it.each([
        ['bun.lock', 'bun add -D @vendure/cloud'],
        ['bun.lockb', 'bun add -D @vendure/cloud'],
        ['pnpm-lock.yaml', 'pnpm add -D @vendure/cloud'],
        ['yarn.lock', 'yarn add -D @vendure/cloud'],
        ['package-lock.json', 'npm install -D @vendure/cloud'],
    ])('uses the package manager that owns %s', (lockfile, command) => {
        const dir = makeTempDir();
        fs.writeFileSync(path.join(dir, lockfile), '');

        expect(addDevDependencyCommand(dir, '@vendure/cloud')).toBe(command);
    });

    it('finds the lockfile at a workspace root above the project', () => {
        const root = makeTempDir();
        fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
        const server = path.join(root, 'apps', 'server');
        fs.ensureDirSync(server);

        expect(detectProjectPackageManager(server)).toBe('pnpm');
    });
});
