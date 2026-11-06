import { TYPESCRIPT_VERSION_RANGE } from '@vendure/common/lib/shared-constants';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { TYPESCRIPT_VERSION } from '../../../create/src/constants';

function getTypeScriptDependency(packageName: string): string | undefined {
    const packageJsonPath = path.join(__dirname, '../../..', packageName, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
    };
    return packageJson.dependencies?.typescript;
}

/**
 * The TypeScript range must be the same everywhere, so that projects only install one copy of
 * TypeScript, and so that `vendure doctor` checks against what @vendure/cli actually requires.
 */
describe('TYPESCRIPT_VERSION_RANGE', () => {
    it('is the typescript dependency range of @vendure/cli', () => {
        expect(getTypeScriptDependency('cli')).toBe(TYPESCRIPT_VERSION_RANGE);
    });

    it('is the typescript dependency range of @vendure/dashboard', () => {
        expect(getTypeScriptDependency('dashboard')).toBe(TYPESCRIPT_VERSION_RANGE);
    });

    it('is the TypeScript version installed by @vendure/create', () => {
        expect(TYPESCRIPT_VERSION).toBe(TYPESCRIPT_VERSION_RANGE);
    });
});
