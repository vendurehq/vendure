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

const carol = { login: 'carol', id: 3, type: 'User' };

/**
 * An in-memory stand-in for the parts of Octokit that `run` uses.
 * `conflicts` makes that many writes to the signatures file fail, as if
 * another run had added carol's signature first.
 */
function fakeGitHub({
    prAuthor,
    commitAuthors,
    signatures = [],
    comments = [],
    conflicts = 0,
    headRef = 'feature',
    commitCount = commitAuthors.length,
    otherPulls = [],
    largeFile = false,
}) {
    const state = {
        file: { signedContributors: signatures },
        fileVersion: 1,
        conflicts,
        statuses: [],
        comments: [...comments],
        writes: [],
    };
    const pull = (number, user, headSha, authors) => ({
        number,
        state: 'open',
        user,
        commits: authors.length > 0 ? commitCount : 0,
        authors,
        head: { sha: headSha, ref: headRef, repo: { full_name: 'vendurehq/vendure' } },
        base: { sha: 'base-sha', repo: { full_name: 'vendurehq/vendure' } },
    });
    // `otherPulls` are further open pull requests: { number, user, headSha, commitAuthors }.
    const pulls = [
        pull(7, prAuthor, 'head-sha', commitAuthors),
        ...otherPulls.map(p => pull(p.number, p.user, p.headSha, p.commitAuthors)),
    ];
    const rest = {
        pulls: {
            get: async ({ pull_number }) => ({ data: pulls.find(p => p.number === pull_number) }),
            list: 'list',
            listCommits: 'listCommits',
        },
        git: {
            getBlob: async () => ({
                data: { content: Buffer.from(JSON.stringify(state.file)).toString('base64') },
            }),
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
                data: largeFile
                    ? { sha: `v${state.fileVersion}`, encoding: 'none', content: '' }
                    : {
                          sha: `v${state.fileVersion}`,
                          encoding: 'base64',
                          content: Buffer.from(JSON.stringify(state.file)).toString('base64'),
                      },
            }),
            createOrUpdateFileContents: async ({ sha, content, message }) => {
                if (state.conflicts > 0) {
                    state.conflicts--;
                    state.file.signedContributors.push({ name: 'carol', id: carol.id });
                    state.fileVersion++;
                    throw Object.assign(new Error('conflict'), { status: 409 });
                }
                assert.equal(sha, `v${state.fileVersion}`);
                state.file = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
                state.fileVersion++;
                state.writes.push(message);
            },
            createCommitStatus: async status => state.statuses.push(status),
            compareCommitsWithBasehead: 'compareCommitsWithBasehead',
        },
    };
    const commitsOf = number =>
        pulls.find(p => p.number === number).authors.map((author, i) => ({ sha: `sha${i}`, author }));
    const paginate = async (method, params, mapFn) => {
        state.paginated = [...(state.paginated ?? []), method];
        if (method === 'list') {
            return pulls;
        }
        if (method === 'listCommits') {
            return commitsOf(params.pull_number);
        }
        if (method === 'compareCommitsWithBasehead') {
            assert.equal(params.basehead, 'base-sha...head-sha');
            return mapFn({ data: { commits: commitsOf(7) } });
        }
        return state.comments;
    };
    return { github: { rest, paginate }, state };
}

const logs = () => ({ info: () => {} });

const prEvent = {
    eventName: 'pull_request_target',
    payload: { pull_request: { number: 7 }, repository: { id: 136938012 } },
};
const userComment = (user, body, id = 555) => ({ id, user, body, created_at: '2026-11-06T10:00:00Z' });
const commentEvent = comment => ({
    eventName: 'issue_comment',
    payload: {
        issue: { number: 7, pull_request: {} },
        comment,
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
            comments: [
                { id: 1, user: ciBot, body: `${COMMENT_MARKER}\nold` },
                userComment(alice, SIGN_PHRASE),
            ],
        });
        await run({
            github,
            context: withRepo(commentEvent(userComment(alice, SIGN_PHRASE))),
            core: logs(),
            options,
        });

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
        const signComment = userComment(bob, SIGN_PHRASE);
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice],
            comments: [signComment],
        });
        await run({ github, context: withRepo(commentEvent(signComment)), core: logs(), options });

        assert.deepEqual(state.file.signedContributors, []);
        assert.equal(state.statuses[0].state, 'failure');
    });

    it('retries the write on top of signatures that another run added first', async () => {
        const signComment = userComment(alice, SIGN_PHRASE);
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice],
            comments: [signComment],
            conflicts: 2,
        });
        await run({ github, context: withRepo(commentEvent(signComment)), core: logs(), options });

        assert.deepEqual(
            state.file.signedContributors.map(s => s.name),
            ['carol', 'carol', 'alice'],
        );
        assert.equal(state.writes.length, 1);
    });

    it('records a sign comment whose own run was dropped, in a later run', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [claude],
            comments: [userComment(alice, SIGN_PHRASE)],
        });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.deepEqual(state.writes, ['@alice has signed the CLA in vendurehq/vendure#7']);
        assert.equal(state.statuses[0].state, 'success');
    });

    it('lists the commits of a pull request with more than 250 commits by comparing base and head', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice, bob],
            signatures: [{ name: 'alice', id: 1 }],
            commitCount: 300,
        });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.ok(state.paginated.includes('compareCommitsWithBasehead'));
        assert.ok(!state.paginated.includes('listCommits'));
        assert.match(state.statuses[0].description, /@bob/);
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
        await run({
            github,
            context: withRepo(commentEvent(userComment(alice, 'LGTM'))),
            core: logs(),
            options,
        });

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

    it('fails the status when another open PR with the same head commit has an unsigned author', async () => {
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice],
            signatures: [{ name: 'alice', id: 1 }],
            otherPulls: [
                { number: 8, user: bob, headSha: 'head-sha', commitAuthors: [alice] },
                { number: 9, user: carol, headSha: 'other-sha', commitAuthors: [carol] },
            ],
        });
        await run({ github, context: withRepo(prEvent), core: logs(), options });

        assert.equal(state.statuses[0].state, 'failure');
        assert.equal(state.statuses[0].description, 'Waiting for @bob to sign the CLA');
        // The comment on this PR only lists who has to sign for this PR.
        assert.equal(state.comments.length, 0);
    });

    it('reads a signatures file over 1 MB through the git blob API', async () => {
        const signComment = userComment(alice, SIGN_PHRASE);
        const { github, state } = fakeGitHub({
            prAuthor: alice,
            commitAuthors: [alice],
            signatures: [{ name: 'carol', id: carol.id }],
            comments: [signComment],
            largeFile: true,
        });
        await run({ github, context: withRepo(commentEvent(signComment)), core: logs(), options });

        assert.deepEqual(
            state.file.signedContributors.map(s => s.name),
            ['carol', 'alice'],
        );
        assert.equal(state.statuses[0].state, 'success');
    });
});
