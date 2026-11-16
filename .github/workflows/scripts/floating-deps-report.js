const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Support script for floating_deps_check.yml.
 *
 * `node floating-deps-report.js resolved` prints a table of every dependency range the published
 * packages declare, next to the version a fresh resolve picked for it.
 *
 * `node floating-deps-report.js report` opens an issue describing a failed run, or edits the
 * issue an earlier failed run already opened. `node floating-deps-report.js resolve-issue` closes
 * that issue once a run passes again.
 *
 * A package counts as published when its path is packages/<name>/package.json and its manifest
 * does not set `"private": true`, which is the same test dependency-impact.js uses.
 */

const MARKER = '<!-- floating-deps-check -->';
const LABEL = 'ci: floating deps';
const TITLE = 'Scheduled floating dependency check is failing';
const CONTRACT_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
// GitHub rejects an issue body over 65536 characters, and the body carries both the resolved
// versions and the build output. These two caps leave headroom for the surrounding text. The
// workflow also uploads both files whole as a run artifact, so truncation here loses nothing.
const MAX_RESOLVED_CHARS = 20000;
const MAX_LOG_CHARS = 20000;

const repo = process.env.GITHUB_REPOSITORY;
const mode = process.argv[2];

if (mode === 'resolved') {
    process.stdout.write(resolvedTable());
} else if (mode === 'report') {
    report();
} else if (mode === 'resolve-issue') {
    resolveIssue();
} else {
    console.error(`unknown mode "${mode}", expected resolved, report or resolve-issue`);
    process.exit(1);
}

function publishedPackages() {
    return fs
        .readdirSync('packages', { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join('packages', entry.name, 'package.json'))
        .filter(manifestPath => fs.existsSync(manifestPath))
        .map(manifestPath => ({ manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }))
        .filter(({ manifest }) => manifest.private !== true);
}

/**
 * Finds the version actually installed for a dependency of a given package. bun hoists most
 * packages to the root node_modules but can nest one under the package that needs it, so check
 * the nested location first.
 */
function installedVersion(packageDir, name) {
    const candidates = [
        path.join(packageDir, 'node_modules', name, 'package.json'),
        path.join('node_modules', name, 'package.json'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            try {
                return JSON.parse(fs.readFileSync(candidate, 'utf8')).version;
            } catch (e) {
                return `unreadable (${e.message})`;
            }
        }
    }
    return null;
}

function resolvedTable() {
    const rows = [];
    for (const { manifestPath, manifest } of publishedPackages()) {
        const packageDir = path.dirname(manifestPath);
        for (const section of CONTRACT_SECTIONS) {
            for (const [name, range] of Object.entries(manifest[section] || {})) {
                // Workspace packages resolve to the checkout, so their version says nothing about
                // what a consumer would get.
                if (typeof range === 'string' && range.startsWith('workspace:')) {
                    continue;
                }
                rows.push({
                    pkg: manifest.name,
                    section,
                    name,
                    range,
                    resolved: installedVersion(packageDir, name),
                });
            }
        }
    }
    rows.sort((a, b) => a.pkg.localeCompare(b.pkg) || a.name.localeCompare(b.name));

    const lines = ['| package | dependency | declared range | resolved |', '| --- | --- | --- | --- |'];
    for (const row of rows) {
        const section = row.section === 'dependencies' ? '' : ` _(${row.section})_`;
        lines.push(
            `| \`${row.pkg}\` | \`${row.name}\`${section} | \`${row.range}\` | ${
                row.resolved ? `\`${row.resolved}\`` : 'not installed'
            } |`,
        );
    }
    return lines.join('\n') + '\n';
}

/**
 * Reads a file, keeping the end when it is too long. The end of a build log holds the error that
 * stopped it, which is the part worth reading.
 */
function readTail(file, limit) {
    if (!file || !fs.existsSync(file)) {
        return '(no output captured)';
    }
    const text = fs.readFileSync(file, 'utf8');
    if (text.length <= limit) {
        return text || '(empty)';
    }
    return `... truncated to the last ${limit} characters, see the run artifact for the whole file ...\n${text.slice(
        -limit,
    )}`;
}

function buildBody() {
    const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    return [
        MARKER,
        '',
        'The scheduled floating dependency check failed. This job resolves the published packages',
        'declared dependency ranges with no lockfile and builds the result, so it reports what a',
        'consumer installing these packages today would get. It is not a required check and blocks',
        'nothing.',
        '',
        'A failure here usually means a third party shipped a release that is inside a declared',
        'range and does not compile against this source. The fix is either to correct the range or',
        'to update the code that uses it. Failing on its own is not a reason to revert anything.',
        '',
        `Run: ${runUrl}`,
        `Commit: \`${process.env.GITHUB_SHA}\``,
        '',
        '## Resolved versions',
        '',
        '<details><summary>Every declared range and what it resolved to</summary>',
        '',
        readTail(process.env.RESOLVED_FILE, MAX_RESOLVED_CHARS),
        '',
        '</details>',
        '',
        '## Output',
        '',
        '```',
        readTail(process.env.LOG_FILE, MAX_LOG_CHARS),
        '```',
        '',
        `<sub>Updated automatically by \`floating_deps_check.yml\`. Edits to this body are overwritten on the next failure.</sub>`,
    ].join('\n');
}

function ensureLabel() {
    try {
        gh([`repos/${repo}/labels/${encodeURIComponent(LABEL)}`]);
    } catch (e) {
        gh([
            `repos/${repo}/labels`,
            '-X',
            'POST',
            '-f',
            `name=${LABEL}`,
            '-f',
            'color=D93F0B',
            '-f',
            'description=Raised by the scheduled floating dependency check',
        ]);
    }
}

function findOpenIssue() {
    // The filters go in the query string. Passing them with -f makes gh send a request body,
    // which turns this GET into a write attempt against the issues endpoint.
    const query = `state=open&labels=${encodeURIComponent(LABEL)}`;
    const found = gh([
        `repos/${repo}/issues?${query}`,
        '--paginate',
        '--jq',
        `[.[] | select(.pull_request == null) | select(.body | contains("${MARKER}")) | .number] | first // empty`,
    ]).trim();
    return found || null;
}

function report() {
    ensureLabel();
    const body = buildBody();
    const existing = findOpenIssue();
    if (existing) {
        gh([`repos/${repo}/issues/${existing}`, '-X', 'PATCH', '-f', `body=${body}`]);
        console.log(`updated issue #${existing}`);
    } else {
        const created = gh([
            `repos/${repo}/issues`,
            '-X',
            'POST',
            '-f',
            `title=${TITLE}`,
            '-f',
            `body=${body}`,
            '-f',
            `labels[]=${LABEL}`,
            '--jq',
            '.number',
        ]).trim();
        console.log(`opened issue #${created}`);
    }
}

/**
 * Closes the issue a previous failure opened. Only an issue carrying this workflow's marker is
 * touched, so a run passing can never close something a person filed.
 */
function resolveIssue() {
    const existing = findOpenIssue();
    if (!existing) {
        console.log('no open issue to close');
        return;
    }
    const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    gh([
        `repos/${repo}/issues/${existing}/comments`,
        '-X',
        'POST',
        '-f',
        `body=The floating dependency check passed on \`${process.env.GITHUB_SHA}\`. Closing.\n\nRun: ${runUrl}`,
    ]);
    gh([`repos/${repo}/issues/${existing}`, '-X', 'PATCH', '-f', 'state=closed']);
    console.log(`closed issue #${existing}`);
}

function gh(args) {
    return execFileSync('gh', ['api', ...args], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
