// Runs the CLA check for one pull request. Called by actions/github-script
// from `.github/workflows/cla_check.yml`. The rules live in `cla.mjs`.
import {
    COMMENT_MARKER,
    createSignature,
    getRequiredSigners,
    getUnsigned,
    isBackMerge,
    isRecheckComment,
    isSignComment,
    renderComment,
} from './cla.mjs';

const MAX_WRITE_ATTEMPTS = 5;

/**
 * @param {{ github: any, context: any, core: any, options: {
 *   signaturesRepo: string, signaturesPath: string, signaturesBranch: string,
 *   documentUrl: string, statusContext: string, postComment: boolean } }} args
 */
export async function run({ github, context, core, options }) {
    const { owner, repo } = context.repo;
    const comment = context.eventName === 'issue_comment' ? context.payload.comment : undefined;
    if (comment && !isRelevantComment(context, comment, core)) {
        return;
    }

    const pullNumber = context.payload.pull_request?.number ?? context.payload.issue.number;
    const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
    if (pull.state !== 'open') {
        core.info(`Pull request #${pullNumber} is ${pull.state}.`);
        return;
    }

    const signers = await getSignersForPull(github, { owner, repo, pull });
    const store = signatureStore(github, options);
    let { signatures } = await store.read();

    if (comment && isSignComment(comment.body)) {
        signatures = await recordSignature(store, {
            signers,
            signatures,
            comment,
            core,
            repoId: context.payload.repository.id,
            pullNumber,
            pullRef: `${owner}/${repo}#${pullNumber}`,
        });
    }

    const unsigned = getUnsigned(signers, signatures);
    await reportStatus(github, { owner, repo, sha: pull.head.sha, unsigned, options, core });
    if (options.postComment) {
        await upsertComment(github, { owner, repo, pullNumber, unsigned, documentUrl: options.documentUrl });
    }
}

function isRelevantComment(context, comment, core) {
    if (!context.payload.issue.pull_request) {
        core.info('The comment is on an issue, not a pull request.');
        return false;
    }
    if (!isSignComment(comment.body) && !isRecheckComment(comment.body)) {
        core.info('The comment is neither a signature nor a recheck.');
        return false;
    }
    return true;
}

async function getSignersForPull(github, { owner, repo, pull }) {
    const commits = await github.paginate(github.rest.pulls.listCommits, {
        owner,
        repo,
        pull_number: pull.number,
        per_page: 100,
    });
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
 * Adds the commenter's signature when they still have to sign for this
 * pull request, and returns the signatures afterwards.
 */
async function recordSignature(store, { signers, signatures, comment, core, repoId, pullNumber, pullRef }) {
    const signer = getUnsigned(signers, signatures).find(s => s.id === comment.user.id);
    if (!signer) {
        core.info(
            `@${comment.user.login} does not need to sign for this pull request, or has already signed.`,
        );
        return signatures;
    }
    const signature = createSignature({
        user: toUser(comment.user),
        commentId: comment.id,
        createdAt: comment.created_at,
        repoId,
        pullRequestNo: pullNumber,
    });
    const updated = await store.add(signature, `@${signer.login} has signed the CLA in ${pullRef}`);
    core.info(`Recorded the signature of @${signer.login}.`);
    return updated;
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
        const file = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
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
async function upsertComment(github, { owner, repo, pullNumber, unsigned, documentUrl }) {
    const comments = await github.paginate(github.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
    });
    const existing = comments.find(c => c.user?.type === 'Bot' && c.body?.includes(COMMENT_MARKER));
    const body = renderComment({ unsigned, documentUrl });

    if (existing) {
        if (existing.body !== body) {
            await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
        }
    } else if (unsigned.length > 0) {
        await github.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body });
    }
}
