import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readLocalTrustActivation } from './local-trust-activation';
import { LOCAL_TRUST_SECRET_ENV_VAR, LOCAL_TRUST_STATE_FILE } from './local-trust-contract';

const SECRET = 'dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LW9mLTMyLWJ5dGVz';
const uid = process.getuid?.();

describe.skipIf(uid === undefined)('readLocalTrustActivation', () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(path.join(tmpdir(), 'mcp-local-trust-'));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    function writeStateFile(contents: unknown, mode = 0o600): string {
        const file = path.join(projectDir, LOCAL_TRUST_STATE_FILE);
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
        symlinkSync(target, path.join(projectDir, LOCAL_TRUST_STATE_FILE));
        expect(read({ [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET })).toMatchObject({ enabled: false });
    });

    it('stays off on a platform without uids', () => {
        writeStateFile({ secret: SECRET });
        const activation = readLocalTrustActivation({
            localTrust: true,
            env: { [LOCAL_TRUST_SECRET_ENV_VAR]: SECRET },
            projectDir,
            uid: undefined,
        });
        expect(activation).toMatchObject({ enabled: false, refusedReason: expect.stringMatching(/platform/) });
    });
});
