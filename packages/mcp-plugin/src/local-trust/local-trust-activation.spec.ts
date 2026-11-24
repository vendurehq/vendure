import { LOCAL_APP_DATA_ENV_VAR, LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readLocalTrustActivation } from './local-trust-activation';

const SECRET = 'dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LW9mLTMyLWJ5dGVz';
const uid = process.getuid?.();
/** The state file of a project on macOS and Linux. */
const STATE_FILE = path.join('.vendure', 'devserver.json');

describe.skipIf(uid === undefined)('readLocalTrustActivation', () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(path.join(tmpdir(), 'mcp-local-trust-'));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    function writeStateFile(contents: unknown, mode = 0o600): string {
        const file = path.join(projectDir, STATE_FILE);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents), { mode });
        // writeFileSync's mode is masked by the umask, so it is set again explicitly.
        chmodSync(file, mode);
        return file;
    }

    function read(env: NodeJS.ProcessEnv, options: { localTrust?: boolean; uid?: number } = {}) {
        return readLocalTrustActivation({
            localTrust: options.localTrust ?? true,
            env,
            projectDir,
            uid: options.uid ?? uid,
            platform: 'linux',
        });
    }

    it('turns local trust on when the environment and the state file hold the same secret', () => {
        const file = writeStateFile({ secret: SECRET, urls: {} });
        const activation = read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET });
        expect(activation).toMatchObject({ enabled: true, stateFile: file });
    });

    it('keeps only the hash of the secret', () => {
        writeStateFile({ secret: SECRET });
        const activation = read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET });
        expect(JSON.stringify(activation)).not.toContain(SECRET);
    });

    it('deletes the secret from the environment, whether or not local trust turns on', () => {
        const on = { [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET };
        writeStateFile({ secret: SECRET });
        read(on);
        expect(on).not.toHaveProperty(LOCAL_TRUST_SECRET_ENV_VAR);

        const off = { [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET };
        read(off, { localTrust: false });
        expect(off).not.toHaveProperty(LOCAL_TRUST_SECRET_ENV_VAR);
    });

    it('stays off, without a reason, when the CLI passed no secret', () => {
        writeStateFile({ secret: SECRET });
        expect(read({})).toEqual({ enabled: false });
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: '' })).toEqual({ enabled: false });
    });

    // A static environment variable, as on a deployed server, is not enough on its own.
    it('stays off for a secret in the environment with no state file', () => {
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/does not exist/),
        });
    });

    it('stays off when the localTrust option is false', () => {
        writeStateFile({ secret: SECRET });
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET }, { localTrust: false })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/localTrust option is false/),
        });
    });

    it.each([0o644, 0o640, 0o604, 0o700, 0o400])('stays off for a state file with mode %s', mode => {
        writeStateFile({ secret: SECRET }, mode);
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/not 0600/),
        });
    });

    it('stays off for a state file owned by another uid', () => {
        writeStateFile({ secret: SECRET });
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET }, { uid: (uid ?? 0) + 1 })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/is owned by uid/),
        });
    });

    it('stays off for a state file holding another secret', () => {
        writeStateFile({ secret: `${SECRET}-older-run` });
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/different secret/),
        });
    });

    it.each([
        ['not JSON', 'secret=abc', /not valid JSON/],
        ['no secret', { urls: {} }, /holds no secret/],
        ['an empty secret', { secret: '' }, /holds no secret/],
        ['a non-string secret', { secret: 42 }, /holds no secret/],
    ])('stays off for a state file with %s', (_label, contents, reason) => {
        writeStateFile(contents);
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(reason),
        });
    });

    it('stays off when the state file is a symlink', () => {
        const target = path.join(projectDir, 'elsewhere.json');
        writeFileSync(target, JSON.stringify({ secret: SECRET }), { mode: 0o600 });
        chmodSync(target, 0o600);
        mkdirSync(path.join(projectDir, '.vendure'));
        symlinkSync(target, path.join(projectDir, STATE_FILE));
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({ enabled: false });
    });

    it('stays off on a platform without uids', () => {
        writeStateFile({ secret: SECRET });
        const activation = readLocalTrustActivation({
            localTrust: true,
            env: { [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET },
            projectDir,
            uid: undefined,
            platform: 'linux',
        });
        expect(activation).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/platform/),
        });
    });
});

/**
 * The Windows guard, run on the file system of the test machine. The state file stands in a
 * directory that plays `%LOCALAPPDATA%`, and links play the part of Windows junctions.
 */
describe('readLocalTrustActivation on Windows', () => {
    let root: string;
    let localAppData: string;
    let stateFile: string;

    beforeEach(() => {
        root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mcp-local-trust-win-')));
        localAppData = path.join(root, 'AppData', 'Local');
        stateFile = path.join(localAppData, 'Vendure', 'devserver', '0123456789abcdef.json');
        mkdirSync(path.dirname(stateFile), { recursive: true });
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    function read(env: NodeJS.ProcessEnv, file = stateFile) {
        return readLocalTrustActivation({
            localTrust: true,
            env: { [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET, ...env },
            projectDir: path.join(root, 'shop'),
            uid: undefined,
            platform: 'win32',
            statePath: () => file,
        });
    }

    function writeSecret(file: string, secret = SECRET) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ secret }));
    }

    it('turns local trust on for a state file under %LOCALAPPDATA% with the same secret', () => {
        writeSecret(stateFile);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({
            enabled: true,
            stateFile,
        });
    });

    // Windows has no file modes, so the mode is not checked.
    it('does not check the mode of the file', () => {
        writeSecret(stateFile);
        chmodSync(stateFile, 0o644);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({ enabled: true });
    });

    it('stays off when LOCALAPPDATA is not set', () => {
        writeSecret(stateFile);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: undefined })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/LOCALAPPDATA is not set/),
        });
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: '' })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/LOCALAPPDATA is not set/),
        });
    });

    it('stays off for a state file outside %LOCALAPPDATA%', () => {
        const outside = path.join(root, 'shop', '.vendure', 'devserver.json');
        writeSecret(outside);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData }, outside)).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/is not under the current user's LOCALAPPDATA/),
        });
    });

    it('stays off when the file is a link to a file outside %LOCALAPPDATA%', () => {
        const outside = path.join(root, 'elsewhere.json');
        writeSecret(outside);
        symlinkSync(outside, stateFile);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/is not under the current user's LOCALAPPDATA/),
        });
    });

    it('stays off when a directory on the way is a junction out of %LOCALAPPDATA%', () => {
        const outsideDir = path.join(root, 'elsewhere');
        writeSecret(path.join(outsideDir, path.basename(stateFile)));
        rmSync(path.dirname(stateFile), { recursive: true });
        symlinkSync(outsideDir, path.dirname(stateFile), 'junction');
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/is not under the current user's LOCALAPPDATA/),
        });
    });

    it('stays off when %LOCALAPPDATA% names another directory than the one the file is in', () => {
        writeSecret(stateFile);
        const otherProfile = path.join(root, 'OtherUser', 'AppData', 'Local');
        mkdirSync(otherProfile, { recursive: true });
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: otherProfile })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/is not under/),
        });
    });

    it('stays off when the state file does not exist', () => {
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/does not exist/),
        });
    });

    it('stays off for a state file with another secret', () => {
        writeSecret(stateFile, `${SECRET}-older-run`);
        expect(read({ [LOCAL_APP_DATA_ENV_VAR]: localAppData })).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(/different secret/),
        });
    });

    it('finds the state file with localTrustStatePath by default', () => {
        const activation = readLocalTrustActivation({
            localTrust: true,
            env: {
                [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET,
                [LOCAL_APP_DATA_ENV_VAR]: 'C:\\Users\\dev\\AppData\\Local',
            },
            projectDir: 'C:\\work\\shop',
            uid: undefined,
            platform: 'win32',
        });
        expect(activation).toMatchObject({
            enabled: false,
            refusedReason: expect.stringMatching(
                /C:\\Users\\dev\\AppData\\Local\\Vendure\\devserver\\[0-9a-f]{16}\.json does not exist/,
            ),
        });
    });
});
