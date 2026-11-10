// Runs the CLA check for one pull request. Called by actions/github-script
// from `.github/workflows/cla_check.yml`. The rules live in `cla.mjs`.
import {
    COMMENT_MARKER,
    RECHECK_PHRASE,
    createSignature,
    getRequiredSigners,
    getUnsigned,
    isBackMerge,
    isSignComment,
    renderComment,
} from './cla.mjs';

const MAX_WRITE_ATTEMPTS = 5;

/**
 * @param {{ github: any, context: any, core: any, options: {
 *   signaturesRepo: string, signaturesPath: string, signaturesBranch: string,
 *   documentUrl: string, statusContext: string, postComment: boolean, botLogin: string } }} args
 */
export async function run({ github, context, core, options }) {
    const { owner, repo } = context.repo;
    const comment = context.eventName === 'issue_comment' ? context.payload.comment : undefined;
    // Every comment that the workflow lets through runs the whole check, not
    // only the sign phrase. GitHub keeps only the newest queued run, so this
    // run may have replaced the run for an earlier sign comment.
    if (comment && !context.payload.issue.pull_request) {
        core.info('The comment is on an issue, not a pull request.');
        return;
    }

    const pullNumber = context.payload.pull_request?.number ?? context.payload.issue.number;
    const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
    const store = signatureStore(github, options);

    let signatures;
    let signers;
    let comments;
    if (pull.state === 'open') {
        signers = await getSignersForPull(github, { owner, repo, pull });
        comments = await github.paginate(github.rest.issues.listComments, {
            owner,
            repo,
            issue_number: pullNumber,
            per_page: 100,
        });
        try {
            signatures = await recordSignatures(store, {
                signers,
                comments,
                core,
                repoId: context.payload.repository.id,
                pullNumber,
                pullRef: `${owner}/${repo}#${pullNumber}`,
            });
        } catch (error) {
            // Without this, the status would keep its previous result.
            await github.rest.repos.createCommitStatus({
                owner,
                repo,
                sha: pull.head.sha,
                context: options.statusContext,
                state: 'error',
                description: `Could not record a signature. Comment "${RECHECK_PHRASE}" to try again.`,
                target_url: options.documentUrl,
            });
            throw error;
        }
    } else {
        ({ signatures } = await store.read());
    }

    // The commits whose status this event can change: the PR's head commit,
    // and on a push, the commit that was its head before.
    const shas = new Set([pull.head.sha]);
    if (context.payload.action === 'synchronize' && context.payload.before) {
        shas.add(context.payload.before);
    }
    const openPulls = await github.paginate(github.rest.pulls.list, {
        owner,
        repo,
        state: 'open',
        per_page: 100,
    });
    const knownSigners = signers ? new Map([[pull.number, signers]]) : new Map();
    for (const sha of shas) {
        await refreshStatus(github, { owner, repo, sha, openPulls, knownSigners, signatures, options, core });
    }

    if (pull.state === 'open' && options.postComment) {
        await upsertComment(github, {
            owner,
            repo,
            pullNumber,
            comments,
            unsigned: getUnsigned(signers, signatures),
            documentUrl: options.documentUrl,
            botLogin: options.botLogin,
        });
    }
}

async function getSignersForPull(github, { owner, repo, pull }) {
    const commits = await listPullCommits(github, { owner, repo, pull });
    return getRequiredSigners({
        prAuthor: toUser(pull.user),
        commits: commits.map(c => ({ sha: c.sha, author: c.author ? toUser(c.author) : null })),
        backMerge: isBackMerge({
            headRef: pull.head.ref,
            headRepo: pull.head.repo?.full_name,
            baseRepo: pull.base.repo.full_name,
        }),
    });
}

/**
 * Sets the `cla` status of a commit. A commit status belongs to a commit, not
 * to a pull request, so every open pull request with this head commit shows
 * it. The status therefore lists who has to sign for any of them. Otherwise a
 * success for one would hide someone who has not signed for another. With no
 * open pull request at this commit, nobody sees the status, and it is left
 * as it is.
 */
async function refreshStatus(
    github,
    { owner, repo, sha, openPulls, knownSigners, signatures, options, core },
) {
    const pullsAtSha = openPulls.filter(p => p.head.sha === sha);
    if (pullsAtSha.length === 0) {
        core.info(`No open pull request has ${sha} as its head commit.`);
        return;
    }
    const unsigned = new Map();
    for (const { number } of pullsAtSha) {
        let signers = knownSigners.get(number);
        if (!signers) {
            // The list omits the commit count, which listPullCommits needs.
            const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: number });
            signers = await getSignersForPull(github, { owner, repo, pull });
        }
        for (const signer of getUnsigned(signers, signatures)) {
            if (!unsigned.has(signer.id)) {
                unsigned.set(signer.id, signer);
            }
        }
    }
    await reportStatus(github, { owner, repo, sha, unsigned: [...unsigned.values()], options, core });
}

// pulls.listCommits returns at most 250 commits.
const MAX_LISTED_PULL_COMMITS = 250;

/**
 * Lists every commit of the pull request. For a larger pull request, the
 * commits come from comparing its base and head, which has no such limit.
 * Both list the commits on the head that are not on the base.
 */
async function listPullCommits(github, { owner, repo, pull }) {
    if (pull.commits <= MAX_LISTED_PULL_COMMITS) {
        return github.paginate(github.rest.pulls.listCommits, {
            owner,
            repo,
            pull_number: pull.number,
            per_page: 100,
        });
    }
    return github.paginate(
        github.rest.repos.compareCommitsWithBasehead,
        { owner, repo, basehead: `${pull.base.sha}...${pull.head.sha}`, per_page: 100 },
        response => response.data.commits,
    );
}

/**
 * Records a signature for everyone who still has to sign and has posted the
 * sign phrase on the pull request, and returns the signatures afterwards.
 * Every run reads all comments, because GitHub drops a queued run when a
 * newer one for the same pull request is queued behind it. The comment that
 * triggered the dropped run is then picked up by the newer run.
 */
async function recordSignatures(store, { signers, comments, core, repoId, pullNumber, pullRef }) {
    let { signatures } = await store.read();
    for (const signer of getUnsigned(signers, signatures)) {
        const comment = comments.find(c => c.user?.id === signer.id && isSignComment(c.body));
        if (!comment) {
            continue;
        }
        const signature = createSignature({
            user: toUser(comment.user),
            commentId: comment.id,
            createdAt: comment.created_at,
            repoId,
            pullRequestNo: pullNumber,
        });
        signatures = await store.add(signature, `@${signer.login} has signed the CLA in ${pullRef}`);
        core.info(`Recorded the signature of @${signer.login}.`);
    }
    return signatures;
}

async function reportStatus(github, { owner, repo, sha, unsigned, options, core }) {
    const mentions = unsigned.map(s => '@' + s.login).join(', ');
    const description =
        unsigned.length === 0 ? 'Everyone has signed the CLA' : `Waiting for ${mentions} to sign the CLA`;
    await github.rest.repos.createCommitStatus({
        owner,
        repo,
        sha,
        context: options.statusContext,
        state: unsigned.length === 0 ? 'success' : 'failure',
        // GitHub rejects status descriptions longer than 140 characters.
        description: description.slice(0, 140),
        target_url: options.documentUrl,
    });
    core.info(description);
}

function toUser(user) {
    return { login: user.login, id: user.id, type: user.type };
}

/**
 * Reads and appends to the signatures file through the contents API. GitHub
 * rejects a write whose `sha` is no longer the file's latest version, which
 * happens when another run (from this or another repository) wrote first.
 * The write is then retried on top of the newer version.
 */
function signatureStore(github, { signaturesRepo, signaturesPath, signaturesBranch }) {
    const [owner, repo] = signaturesRepo.split('/');

    async function read() {
        const { data } = await github.rest.repos.getContent({
            owner,
            repo,
            path: signaturesPath,
            ref: signaturesBranch,
        });
        // For a file over 1 MB, the contents API returns no content and the
        // encoding "none". The git blob API returns files up to 100 MB.
        const content =
            data.encoding === 'base64'
                ? data.content
                : (await github.rest.git.getBlob({ owner, repo, file_sha: data.sha })).data.content;
        const file = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
        return { file, signatures: file.signedContributors, sha: data.sha };
    }

    async function add(signature, message) {
        for (let attempt = 1; ; attempt++) {
            const { file, signatures, sha } = await read();
            if (signatures.some(s => s.id === signature.id)) {
                return signatures;
            }
            file.signedContributors = [...signatures, signature];
            try {
                await github.rest.repos.createOrUpdateFileContents({
                    owner,
                    repo,
                    path: signaturesPath,
                    branch: signaturesBranch,
                    sha,
                    message,
                    content: Buffer.from(JSON.stringify(file, null, 2)).toString('base64'),
                });
                return file.signedContributors;
            } catch (error) {
                const isStaleSha = error.status === 409 || error.status === 422;
                if (!isStaleSha || attempt === MAX_WRITE_ATTEMPTS) {
                    throw error;
                }
            }
        }
    }

    return { read, add };
}

/**
 * Keeps one comment per pull request and edits it in place. A new comment
 * is only posted when someone still has to sign, so pull requests from
 * people who signed earlier get no comment at all.
 */
async function upsertComment(github, { owner, repo, pullNumber, comments, unsigned, documentUrl, botLogin }) {
    // Only the CI bot's own comment. Another bot could quote the marker.
    const existing = comments.find(c => c.user?.login === botLogin && c.body?.includes(COMMENT_MARKER));
    const body = renderComment({ unsigned, documentUrl });

    if (existing) {
        if (existing.body !== body) {
            await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
        }
    } else if (unsigned.length > 0) {
        await github.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body });
    }
}
