import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    getRequiredSigners,
    getUnsigned,
    isBackMerge,
    isSignComment,
    renderComment,
    SIGN_PHRASE,
} from './cla.mjs';

const alice = { login: 'alice', id: 1, type: 'User' };
const bob = { login: 'bob', id: 2, type: 'User' };
const claude = { login: 'claude', id: 81847, type: 'User' };
const cursor = { login: 'cursoragent', id: 199161495, type: 'User' };
const copilot = { login: 'copilot-swe-agent', id: 203248971, type: 'User' };
const webFlow = { login: 'web-flow', id: 19864447, type: 'User' };
const renovate = { login: 'renovate[bot]', id: 29139614, type: 'Bot' };

const commit = (author, sha = 'abc') => ({ sha, author });
const logins = signers => signers.map(s => s.login);

describe('getRequiredSigners', () => {
    it('requires the PR author even when an AI agent authored every commit', () => {
        const signers = getRequiredSigners({ prAuthor: alice, commits: [commit(claude), commit(cursor)] });
        assert.deepEqual(signers, [{ login: 'alice', id: 1, reasons: ['opened this pull request'] }]);
    });

    it('requires every human commit author as well as the PR author', () => {
        const signers = getRequiredSigners({ prAuthor: alice, commits: [commit(alice), commit(bob)] });
        assert.deepEqual(signers, [
            { login: 'alice', id: 1, reasons: ['opened this pull request', 'authored commits'] },
            { login: 'bob', id: 2, reasons: ['authored commits'] },
        ]);
    });

    it('lists a person once, however many commits they authored', () => {
        const signers = getRequiredSigners({
            prAuthor: alice,
            commits: [commit(bob, 'a'), commit(bob, 'b')],
        });
        assert.deepEqual(logins(signers), ['alice', 'bob']);
    });

    it('covers commits with no linked GitHub account by the PR author', () => {
        const signers = getRequiredSigners({ prAuthor: alice, commits: [commit(null)] });
        assert.deepEqual(logins(signers), ['alice']);
    });

    it('skips AI agents, bots and GitHub web-flow as commit authors', () => {
        const signers = getRequiredSigners({
            prAuthor: alice,
            commits: [commit(claude), commit(cursor), commit(copilot), commit(webFlow), commit(renovate)],
        });
        assert.deepEqual(logins(signers), ['alice']);
    });

    it('requires an AI agent account that opens a PR itself', () => {
        const signers = getRequiredSigners({ prAuthor: claude, commits: [commit(claude)] });
        assert.deepEqual(logins(signers), ['claude']);
    });

    it('requires no one for a PR opened by a bot', () => {
        assert.deepEqual(getRequiredSigners({ prAuthor: renovate, commits: [commit(renovate)] }), []);
    });

    it('still requires a human who commits to a PR that a bot opened', () => {
        const signers = getRequiredSigners({ prAuthor: renovate, commits: [commit(renovate), commit(bob)] });
        assert.deepEqual(logins(signers), ['bob']);
    });

    it('matches skipped logins case-insensitively', () => {
        const signers = getRequiredSigners({
            prAuthor: alice,
            commits: [commit({ ...claude, login: 'Claude' })],
        });
        assert.deepEqual(logins(signers), ['alice']);
    });
});

describe('isBackMerge', () => {
    const repo = 'vendurehq/vendure';

    it('recognises release and merge/* branches in the same repository', () => {
        assert.equal(isBackMerge({ headRef: 'master', headRepo: repo, baseRepo: repo }), true);
        assert.equal(
            isBackMerge({ headRef: 'merge/minor-into-major', headRepo: repo, baseRepo: repo }),
            true,
        );
    });

    it('does not treat a fork branch named master as a back-merge', () => {
        assert.equal(isBackMerge({ headRef: 'master', headRepo: 'someone/vendure', baseRepo: repo }), false);
    });

    it('does not treat other branches as back-merges', () => {
        assert.equal(isBackMerge({ headRef: 'fix/merge-orders', headRepo: repo, baseRepo: repo }), false);
    });

    it('requires only the PR author in a back-merge', () => {
        const signers = getRequiredSigners({ prAuthor: alice, commits: [commit(bob)], backMerge: true });
        assert.deepEqual(logins(signers), ['alice']);
    });
});

describe('getUnsigned', () => {
    it('matches signatures by account id, so a renamed account stays signed', () => {
        const signers = getRequiredSigners({ prAuthor: alice, commits: [commit(bob)] });
        const unsigned = getUnsigned(signers, [{ name: 'alice-old-name', id: 1 }]);
        assert.deepEqual(logins(unsigned), ['bob']);
    });
});

describe('comment matching', () => {
    it('accepts the sign phrase regardless of case and surrounding whitespace', () => {
        assert.equal(isSignComment(`  ${SIGN_PHRASE.toUpperCase()}\n`), true);
        assert.equal(isSignComment(SIGN_PHRASE.replace('hereby ', 'hereby\n')), true);
    });

    it('rejects a comment that only contains the sign phrase', () => {
        assert.equal(isSignComment(`Sure. ${SIGN_PHRASE}`), false);
        assert.equal(isSignComment(undefined), false);
    });
});

describe('renderComment', () => {
    it('names each unsigned person with the reason they have to sign', () => {
        const body = renderComment({
            unsigned: [{ login: 'alice', id: 1, reasons: ['opened this pull request'] }],
            documentUrl: 'https://example.com/CLA.md',
        });
        assert.match(body, /- @alice \(opened this pull request\)/);
        assert.match(body, new RegExp(SIGN_PHRASE));
    });
});
