import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOCAL_APP_DATA_ENV_VAR, LocalAppDataNotSetError, localTrustStatePath } from './local-trust';

/**
 * The file name for `C:\Users\dev\shop`, written out, because the CLI and the server can load
 * different copies of this module and must agree on it.
 */
const SHOP_FILE = '71bba24849765385.json';

describe('localTrustStatePath() on macOS and Linux', () => {
    it('is .vendure/devserver.json in the project directory', () => {
        expect(localTrustStatePath('/home/dev/shop', { platform: 'linux' })).toBe(
            '/home/dev/shop/.vendure/devserver.json',
        );
        expect(localTrustStatePath('/Users/dev/shop', { platform: 'darwin' })).toBe(
            '/Users/dev/shop/.vendure/devserver.json',
        );
    });

    it('resolves a relative project directory against the working directory', () => {
        expect(localTrustStatePath('shop', { platform: 'linux' })).toBe(
            path.resolve('shop', '.vendure', 'devserver.json'),
        );
    });

    it('ignores LOCALAPPDATA', () => {
        expect(
            localTrustStatePath('/home/dev/shop', {
                platform: 'linux',
                env: { [LOCAL_APP_DATA_ENV_VAR]: '/tmp/appdata' },
            }),
        ).toBe('/home/dev/shop/.vendure/devserver.json');
    });
});

describe('localTrustStatePath() on Windows', () => {
    const env = { [LOCAL_APP_DATA_ENV_VAR]: 'C:\\Users\\dev\\AppData\\Local' };
    const realpath = (dir: string) => dir;

    it('is a file named by the hash of the project path in %LOCALAPPDATA%\\Vendure\\devserver', () => {
        const projectDir = 'C:\\Users\\dev\\shop';
        expect(localTrustStatePath(projectDir, { platform: 'win32', env, realpath })).toBe(
            `C:\\Users\\dev\\AppData\\Local\\Vendure\\devserver\\${SHOP_FILE}`,
        );
    });

    it('uses 16 hex characters of the hash', () => {
        const file = path.win32.basename(
            localTrustStatePath('C:\\Users\\dev\\shop', { platform: 'win32', env, realpath }),
        );
        expect(file).toMatch(/^[0-9a-f]{16}\.json$/);
    });

    it('gives each worktree its own file', () => {
        const first = localTrustStatePath('C:\\work\\shop', { platform: 'win32', env, realpath });
        const second = localTrustStatePath('C:\\work\\shop-feature', { platform: 'win32', env, realpath });
        expect(first).not.toBe(second);
    });

    it('gives two spellings of one directory the same file', () => {
        expect(localTrustStatePath('C:\\Work\\Shop', { platform: 'win32', env, realpath })).toBe(
            localTrustStatePath('c:\\work\\shop', { platform: 'win32', env, realpath }),
        );
    });

    it('hashes the real path, so a link to the project shares its file', () => {
        const links: Record<string, string> = { 'D:\\link-to-shop': 'C:\\work\\shop' };
        const resolve = (dir: string) => links[dir] ?? dir;
        expect(localTrustStatePath('D:\\link-to-shop', { platform: 'win32', env, realpath: resolve })).toBe(
            localTrustStatePath('C:\\work\\shop', { platform: 'win32', env, realpath: resolve }),
        );
    });

    it('uses the path as given when it cannot be resolved', () => {
        const fails = () => {
            throw new Error('ENOENT');
        };
        expect(
            localTrustStatePath('C:\\Users\\dev\\shop', { platform: 'win32', env, realpath: fails }),
        ).toBe(`C:\\Users\\dev\\AppData\\Local\\Vendure\\devserver\\${SHOP_FILE}`);
    });

    it('throws when LOCALAPPDATA is not set', () => {
        expect(() => localTrustStatePath('C:\\work\\shop', { platform: 'win32', env: {}, realpath })).toThrow(
            LocalAppDataNotSetError,
        );
        expect(() =>
            localTrustStatePath('C:\\work\\shop', {
                platform: 'win32',
                env: { [LOCAL_APP_DATA_ENV_VAR]: '' },
                realpath,
            }),
        ).toThrow(LocalAppDataNotSetError);
    });
});

// The default real path resolver, on the file system of the machine running the tests.
describe('localTrustStatePath() with the real file system', () => {
    let dir: string;

    beforeEach(() => {
        dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'local-trust-path-')));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('hashes the target of a symlinked project directory', () => {
        const project = path.join(dir, 'shop');
        mkdirSync(project);
        const link = path.join(dir, 'link');
        symlinkSync(project, link);
        const env = { [LOCAL_APP_DATA_ENV_VAR]: 'C:\\appdata' };
        expect(localTrustStatePath(link, { platform: 'win32', env })).toBe(
            localTrustStatePath(project, { platform: 'win32', env }),
        );
    });
});
