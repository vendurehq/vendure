import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMENT_MARKER, SIGN_PHRASE } from './cla.mjs';
import { run } from './run.mjs';

const alice = { login: 'alice', id: 1, type: 'User' };
const bob = { login: 'bob', id: 2, type: 'User' };
const claude = { login: 'claude', id: 81847, type: 'User' };
const ciBot = { login: 'vendure-ci-automation-bot[bot]', id: 99, type: 'Bot' };

const options = {
    signaturesRepo: 'vendurehq/vendure',
    signaturesPath: 'license/signatures/version1/cla.json',
    signaturesBranch: 'master',
    documentUrl: 'https://example.com/CLA.md',
    statusContext: 'cla',
    postComment: true,
};

/**
 * An in-memory stand-in for the parts of Octokit that `run` uses.
 * `conflicts` makes that many writes to the signatures file fail as if
 * another run had written first.
 */
function fakeGitHub({
    prAuthor,
    commitAuthors,
    signatures = [],
    comments = [],
    conflicts = 0,
    headRef = 'feature',
}) {
    const state = {
        file: { signedContributors: signatures },
        fileVersion: 1,
        conflicts,
        statuses: [],
        comments: [...comments],
        writes: [],
    };
    const rest = {
        pulls: {
            get: async () => ({
                data: {
                    number: 7,
                    state: 'open',
                    user: prAuthor,
                    head: { sha: 'head-sha', ref: headRef, repo: { full_name: 'vendurehq/vendure' } },
                    base: { repo: { full_name: 'vendurehq/vendure' } },
                },
            }),
            listCommits: 'listCommits',
        },
        issues: {
            listComments: 'listComments',
            createComment: async ({ body }) =>
                state.comments.push({ id: state.comments.length + 1, user: ciBot, body }),
            updateComment: async ({ comment_id, body }) => {
                state.comments.find(c => c.id === comment_id).body = body;
            },
        },
        repos: {
            getContent: async () => ({
                data: {
                    sha: `v${state.fileVersion}`,
                    content: Buffer.from(JSON.stringify(state.file)).toString('base64'),
                },
            }),
            createOrUpdateFileContents: async ({ sha, content, message }) => {
                if (state.conflicts > 0) {
                    state.conflicts--;
                    state.fileVersion++;
                    throw Object.assign(new Error('conflict'), { status: 409 });
                }
                assert.equal(sha, `v${state.fileVersion}`);
                state.file = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
                state.fileVersion++;
                state.writes.push(message);
            },
            createCommitStatus: async status => state.statuses.push(status),
        },
    };
    const paginate = async method => {
        if (method === 'listCommits') {
            return commitAuthors.map((author, i) => ({ sha: `sha${i}`, author }));
        }
        return state.comments;
    };
    return { github: { rest, paginate }, state };
}

const logs = () => ({ info: () => {} });

const prEvent = { eventName: 'pull_request_target', payload: { pull_request: { number: 7 } } };
const commentEvent = (user, body) => ({
    eventName: 'issue_comment',
    payload: {
        issue: { number: 7, pull_request: {} },
        comment: { id: 555, user, body, created_at: '2026-11-06T10:00:00Z' },
        repository: { id: 136938012 },
    },
});
const withRepo = event => ({ ...event, repo: { owner: 'vendurehq', repo: 'vendure' } });

describe('run', () => {
    it('fails the status and asks the PR author to sign when only Claude authored commits', async () => {
        const { github, state } = fakeGitHub({ prAuthor: alice, commitAuthors: [claude] });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.equal(state.statuses[0].state, 'failure');
        assert.equal(state.statuses[0].sha, 'head-sha');
        assert.match(state.comments[0].body, /@alice \(opened this pull request\)/);
    });

    it('records the PR author signature even though they authored no commits', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [claude],
            comments: [{ id: 1, user: ciBot, body: `${COMMENT_MARKER}\nold` }],
        });
        await run({ github, context: withRepo(commentEvent(alice, SIGN_PHRASE)), core: logs(), options });

        assert.deepEqual(state.file.signedContributors, [
            {
                name: 'alice',
                id: 1,
                comment_id: 555,
                created_at: '2026-11-06T10:00:00Z',
                repoId: 136938012,
                pullRequestNo: 7,
            },
        ]);
        assert.deepEqual(state.writes, ['@alice has signed the CLA in vendurehq/vendure#7']);
        assert.equal(state.statuses[0].state, 'success');
        assert.match(state.comments[0].body, /has signed it/);
    });

    it('ignores a sign comment from someone who does not need to sign', async () => {
        const { github, state } = fakeGitHub({ prAuthor: alice, commitAuthors: [alice] });
        await run({ github, context: withRepo(commentEvent(bob, SIGN_PHRASE)), core: logs(), options });

        assert.deepEqual(state.file.signedContributors, []);
        assert.equal(state.statuses[0].state, 'failure');
    });

    it('retries the write when another run updated the signatures file first', async () => {
        const { github, state } = fakeGitHub({ prAuthor: alice, commitAuthors: [alice], conflicts: 2 });
        await run({ github, context: withRepo(commentEvent(alice, SIGN_PHRASE)), core: logs(), options });

        assert.equal(state.file.signedContributors.length, 1);
        assert.equal(state.writes.length, 1);
    });

    it('posts no comment when everyone has already signed', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice, claude],
            signatures: [{ name: 'alice', id: 1 }],
        });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.equal(state.statuses[0].state, 'success');
        assert.equal(state.comments.length, 0);
    });

    it('posts no comment when postComment is off', async () => {
        const { github, state } = fakeGitHub({ prAuthor: alice, commitAuthors: [claude] });
        await run({
            github,
            context: withRepo(prEvent),
            core: logs(),
            options: { ...options, postComment: false },
        });

        assert.equal(state.statuses[0].state, 'failure');
        assert.equal(state.comments.length, 0);
    });

    it('does nothing for other comments', async () => {
        const { github, state } = fakeGitHub({ prAuthor: alice, commitAuthors: [alice] });
        await run({ github, context: withRepo(commentEvent(alice, 'LGTM')), core: logs(), options });

        assert.equal(state.statuses.length, 0);
    });

    it('checks only the PR author in a back-merge', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice, bob],
            signatures: [{ name: 'alice', id: 1 }],
            headRef: 'merge/minor-into-major',
        });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.equal(state.statuses[0].state, 'success');
    });
});
