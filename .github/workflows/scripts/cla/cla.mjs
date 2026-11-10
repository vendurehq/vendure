// Rules for the Vendure CLA check. This module makes no GitHub calls, so that
// `cla.test.mjs` can test every rule. `run.mjs` fetches the data and applies it.

export const SIGN_PHRASE = 'I have read the CLA Document and I hereby sign the CLA';
export const RECHECK_PHRASE = 'recheck';
export const COMMENT_MARKER = '<!-- vendure-cla-check -->';

// Accounts whose commits never need a signature. AI agents are listed because
// the person who opens the PR submits the agent's work, so the PR author's
// signature covers those commits. `web-flow` is GitHub's own committer for
// merges and edits made in the web UI. A PR opened by one of these accounts
// still needs its signature, so that some signature covers its commits.
export const SKIPPED_LOGINS = ['claude', 'copilot-swe-agent', 'cursoragent', 'web-flow'];

/**
 * @typedef {{ login: string, id: number, type?: string }} GitHubUser
 * @typedef {{ sha: string, author: GitHubUser | null }} PullRequestCommit
 *   `author` is the GitHub account linked to the commit's author email,
 *   or null when the email is linked to no account.
 * @typedef {{ name: string, id: number, comment_id: number, created_at: string, repoId: number, pullRequestNo: number }} Signature
 * @typedef {{ login: string, id: number, reasons: string[] }} Signer
 */

export function isBot(user) {
    return user.type === 'Bot' || user.login.endsWith('[bot]');
}

export function isSkippedCommitAuthor(user) {
    return isBot(user) || SKIPPED_LOGINS.includes(user.login.toLowerCase());
}

const RELEASE_BRANCHES = new Set(['master', 'minor', 'major']);

/**
 * A back-merge brings one release branch into another, e.g. master into
 * minor. Its head is a release branch, or a `merge/*` branch used to resolve
 * conflicts, in the same repository. Its commits already reached a release
 * branch through pull requests that were checked on their own.
 *
 * @param {{ headRef: string, headRepo: string | undefined, baseRepo: string }} pull
 */
export function isBackMerge({ headRef, headRepo, baseRepo }) {
    return headRepo === baseRepo && (RELEASE_BRANCHES.has(headRef) || headRef.startsWith('merge/'));
}

/**
 * Returns everyone who must sign for this pull request, signed or not.
 * The PR author must always sign, unless the PR author is a bot. Every other commit author with a GitHub
 * account must sign as well, except in a back-merge. Commits whose author
 * email is linked to no GitHub account are covered by the PR author's
 * signature.
 *
 * @param {{ prAuthor: GitHubUser, commits: PullRequestCommit[], backMerge?: boolean }} input
 * @returns {Signer[]}
 */
export function getRequiredSigners({ prAuthor, commits, backMerge = false }) {
    /** @type {Map<number, Signer>} */
    const signers = new Map();
    const add = (user, reason) => {
        const signer = signers.get(user.id) ?? { login: user.login, id: user.id, reasons: [] };
        if (!signer.reasons.includes(reason)) {
            signer.reasons.push(reason);
        }
        signers.set(user.id, signer);
    };

    if (!isBot(prAuthor)) {
        add(prAuthor, 'opened this pull request');
    }
    if (backMerge) {
        return [...signers.values()];
    }
    for (const commit of commits) {
        if (commit.author && !isSkippedCommitAuthor(commit.author)) {
            add(commit.author, 'authored commits');
        }
    }
    return [...signers.values()];
}

/**
 * @param {Signer[]} signers
 * @param {Signature[]} signatures
 */
export function getUnsigned(signers, signatures) {
    const signedIds = new Set(signatures.map(s => s.id));
    return signers.filter(s => !signedIds.has(s.id));
}

export function isSignComment(body) {
    return normalize(body) === normalize(SIGN_PHRASE);
}

function normalize(text) {
    return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds the entry that is appended to `signedContributors` in the
 * signatures file. The shape matches the entries that CLA Assistant
 * wrote, so that existing signatures keep counting.
 *
 * @returns {Signature}
 */
export function createSignature({ user, commentId, createdAt, repoId, pullRequestNo }) {
    return {
        name: user.login,
        id: user.id,
        comment_id: commentId,
        created_at: createdAt,
        repoId,
        pullRequestNo,
    };
}

/**
 * @param {{ unsigned: Signer[], documentUrl: string }} input
 */
export function renderComment({ unsigned, documentUrl }) {
    if (unsigned.length === 0) {
        return `${COMMENT_MARKER}\nEveryone who needs to sign the [Contributor License Agreement](${documentUrl}) has signed it. Thank you!`;
    }
    const list = unsigned.map(s => `- @${s.login} (${s.reasons.join(', ')})`).join('\n');
    return [
        COMMENT_MARKER,
        `Thank you for your contribution! Before we can merge it, the following people need to sign our [Contributor License Agreement](${documentUrl}):`,
        '',
        list,
        '',
        'To sign, post a comment on this pull request containing exactly:',
        '',
        '```',
        SIGN_PHRASE,
        '```',
        '',
        `You only need to sign once for all Vendure repositories. Comment \`${RECHECK_PHRASE}\` to run the check again.`,
    ].join('\n');
}
