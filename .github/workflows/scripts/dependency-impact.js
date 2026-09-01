const { execFileSync } = require('child_process');
const fs = require('fs');

/**
 * Classifies a pull request that touches a package.json or bun.lock, and reports what it does to
 * the published dependency contract.
 *
 * A pull request changes the contract when it edits a `dependencies`, `peerDependencies` or
 * `optionalDependencies` range in the package.json of a published package. Everything else —
 * devDependencies, bun.lock, and the manifests of private packages — leaves the contract alone.
 * Both look the same in the pull request list, and they mean different things: a widened range is
 * a new promise to every consumer, whereas a lockfile edit only records what this repository
 * installs.
 *
 * A package counts as published when its path is packages/<name>/package.json and its manifest
 * does not set `"private": true`. The root manifest and docs/package.json both set it, so the
 * same test excludes them without naming them.
 *
 * SECURITY: this runs from a pull_request_target workflow with write access to the base
 * repository. It reads the pull request head's package.json files as data through the GitHub API
 * and parses them with JSON.parse. It never checks out, installs, resolves or executes anything
 * from the head. Do not add a step here that does.
 */

const MARKER = '<!-- dependency-impact -->';
const CONTRACT_LABEL = 'deps: contract change';
const LOCKFILE_LABEL = 'deps: lockfile only';
const CONTRACT_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const PUBLISHED_PATH = /^packages\/[^/]+\/package\.json$/;

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = event.pull_request.number;
const baseSha = event.pull_request.base.sha;
const headSha = event.pull_request.head.sha;

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});

async function main() {
    const changedFiles = gh([`repos/${repo}/pulls/${prNumber}/files`, '--paginate', '--jq', '.[].filename'])
        .split('\n')
        .filter(Boolean);

    const manifests = changedFiles.filter(f => f === 'package.json' || f.endsWith('/package.json'));
    const lockfileChanged = changedFiles.includes('bun.lock');

    const contractChanges = [];
    const otherChanges = [];

    for (const path of manifests) {
        const base = readManifest(path, baseSha);
        const head = readManifest(path, headSha);
        // A manifest present at neither ref cannot be compared. This happens when a pull request
        // adds and then removes the same file across pushes.
        if (!base && !head) {
            continue;
        }
        const published = isPublished(path, head || base);
        for (const section of [
            'dependencies',
            'peerDependencies',
            'optionalDependencies',
            'devDependencies',
        ]) {
            for (const change of diffSection(base, head, section)) {
                const entry = { ...change, path, section };
                const isContract = published && CONTRACT_SECTIONS.includes(section);
                (isContract ? contractChanges : otherChanges).push(entry);
            }
        }
    }

    const label = contractChanges.length ? CONTRACT_LABEL : LOCKFILE_LABEL;
    const remove = label === CONTRACT_LABEL ? LOCKFILE_LABEL : CONTRACT_LABEL;

    ensureLabels();
    applyLabel(label, remove);
    upsertComment(buildComment({ label, contractChanges, otherChanges, lockfileChanged, manifests }));

    console.log(`applied "${label}" (${contractChanges.length} contract, ${otherChanges.length} other)`);
}

/**
 * A package is published when it lives directly under packages/ and does not opt out with
 * `"private": true`. Deriving it this way means a new package is classified correctly without
 * anyone remembering to update a list here.
 */
function isPublished(path, manifest) {
    return PUBLISHED_PATH.test(path) && manifest.private !== true;
}

function diffSection(base, head, section) {
    const before = (base && base[section]) || {};
    const after = (head && head[section]) || {};
    const changes = [];
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[name] !== after[name]) {
            changes.push({ name, from: before[name], to: after[name] });
        }
    }
    return changes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads a manifest at a given commit and parses it. Returns null when the file does not exist at
 * that commit, which is the normal case for a manifest the pull request adds or deletes.
 */
function readManifest(path, ref) {
    let raw;
    try {
        // ref goes in the query string. Passing it with -f makes gh send it as a request body,
        // which the contents API ignores, and every lookup then resolves against the default
        // branch or 404s.
        raw = gh([`repos/${repo}/contents/${path}?ref=${ref}`, '-H', 'Accept: application/vnd.github.raw']);
    } catch (e) {
        const stderr = String(e.stderr || '');
        if (stderr.includes('HTTP 404')) {
            return null;
        }
        // Any other failure means the classification would be wrong rather than absent, so stop
        // instead of reporting a contract change as a lockfile refresh.
        throw new Error(`could not read ${path} at ${ref}: ${stderr.trim() || e.message}`);
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        // Returning null here would make diffSection read the manifest as empty and report every
        // dependency in it as removed. A manifest that does not parse is a broken pull request,
        // so say so instead of publishing a wrong report.
        throw new Error(`could not parse ${path} at ${ref}: ${e.message}`);
    }
}

function ensureLabels() {
    const wanted = [
        {
            name: CONTRACT_LABEL,
            color: 'B60205',
            description: 'Changes a dependency range in a published package',
        },
        {
            name: LOCKFILE_LABEL,
            color: '0E8A16',
            description: 'Leaves every published dependency range unchanged',
        },
    ];
    for (const label of wanted) {
        try {
            gh([`repos/${repo}/labels/${encodeURIComponent(label.name)}`]);
        } catch (e) {
            gh([
                `repos/${repo}/labels`,
                '-X',
                'POST',
                '-f',
                `name=${label.name}`,
                '-f',
                `color=${label.color}`,
                '-f',
                `description=${label.description}`,
            ]);
        }
    }
}

function applyLabel(add, remove) {
    gh([`repos/${repo}/issues/${prNumber}/labels`, '-X', 'POST', '-f', `labels[]=${add}`]);
    // Removing the opposite label matters when a push changes the classification. Without it a
    // pull request that drops a manifest edit keeps both labels and reads as ambiguous.
    try {
        gh([`repos/${repo}/issues/${prNumber}/labels/${encodeURIComponent(remove)}`, '-X', 'DELETE']);
    } catch (e) {
        // Not present, which is the common case.
    }
}

/**
 * Posts the report, or edits the report already on the pull request. Dependabot force-pushes this
 * branch on every rebase, so posting a new comment each time would bury the pull request.
 */
function upsertComment(body) {
    const existing = gh([
        `repos/${repo}/issues/${prNumber}/comments`,
        '--paginate',
        '--jq',
        `[.[] | select(.body | contains("${MARKER}")) | .id] | first // empty`,
    ]).trim();

    if (existing) {
        gh([`repos/${repo}/issues/comments/${existing}`, '-X', 'PATCH', '-f', `body=${body}`]);
    } else {
        gh([`repos/${repo}/issues/${prNumber}/comments`, '-X', 'POST', '-f', `body=${body}`]);
    }
}

function buildComment({ label, contractChanges, otherChanges, lockfileChanged, manifests }) {
    const lines = [MARKER, '', `### Dependency impact: ${label}`, ''];

    if (contractChanges.length) {
        lines.push(
            'This pull request changes a dependency range in a published package, so it changes what',
            'consumers resolve. Review the new range rather than the resolved version.',
            '',
            '| package | section | range |',
            '| --- | --- | --- |',
        );
        for (const c of contractChanges) {
            lines.push(`| \`${c.name}\` | ${packageOf(c.path)} / ${c.section} | ${formatRange(c)} |`);
        }
        lines.push('');
    } else {
        lines.push(
            'No published dependency range changes. Consumers resolve exactly what they did before.',
            '',
        );
    }

    if (otherChanges.length) {
        lines.push(
            `<details><summary>${otherChanges.length} change(s) that do not affect the contract</summary>`,
            '',
        );
        lines.push('| package | section | range |', '| --- | --- | --- |');
        for (const c of otherChanges) {
            lines.push(`| \`${c.name}\` | ${packageOf(c.path)} / ${c.section} | ${formatRange(c)} |`);
        }
        lines.push('', '</details>', '');
    }

    if (lockfileChanged) {
        lines.push(
            '`bun.lock` changed. The lockfile records what this repository installs, and CI verifies',
            'only that combination. It is not what a consumer installing the published packages gets.',
            '',
        );
    }
    if (!manifests.length && !lockfileChanged) {
        lines.push('No manifest or lockfile changes found.', '');
    }

    lines.push('<sub>Reported by `dependency_impact.yml`. Not a required check.</sub>');
    return lines.join('\n');
}

function packageOf(path) {
    return path === 'package.json' ? '(root)' : path.replace(/\/package\.json$/, '');
}

function formatRange({ from, to }) {
    if (from === undefined) {
        return `added \`${to}\``;
    }
    if (to === undefined) {
        return `removed \`${from}\``;
    }
    return `\`${from}\` -> \`${to}\``;
}

function gh(args) {
    return execFileSync('gh', ['api', ...args], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
