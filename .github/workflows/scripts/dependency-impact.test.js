const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const classifierPath = path.join(__dirname, 'dependency-impact.js');
const workflowPath = path.join(__dirname, '..', 'dependency_impact.yml');

test('does not override the protected pull_request_target checkout', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const checkoutStep = workflow.match(/- name: Check out trusted workflow code[\s\S]*?(?=\n\s+- name:)/);

    assert.ok(checkoutStep, 'trusted checkout step is missing');
    assert.doesNotMatch(checkoutStep[0], /^\s+(?:ref|repository|allow-unsafe-pr-checkout):/m);
    assert.match(checkoutStep[0], /^\s+persist-credentials: false$/m);
});

function runClassifier({ files, manifests = {}, comments = [], failures = {} }) {
    assert.ok(
        fs.existsSync(classifierPath),
        'dependency impact classifier is missing, so dependency pull requests cannot be categorized',
    );

    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-impact-test-'));
    const callsPath = path.join(temporaryDirectory, 'calls.jsonl');
    const ghPath = path.join(temporaryDirectory, 'gh');
    fs.writeFileSync(
        ghPath,
        `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_GH_CALLS_PATH, JSON.stringify(args) + '\\n');
const endpoint = args[1] || '';
const failures = JSON.parse(process.env.MOCK_FAILURES);
const configuredFailure = failures[endpoint];
const calls = fs.readFileSync(process.env.MOCK_GH_CALLS_PATH, 'utf8').trim().split('\\n').map(line => JSON.parse(line));
const endpointCallCount = calls.filter(call => call[1] === endpoint).length;
const failure = Array.isArray(configuredFailure)
    ? configuredFailure[endpointCallCount - 1]
    : configuredFailure;
if (failure) {
    process.stderr.write('gh: mock failure (HTTP ' + failure + ')\\n');
    process.exit(1);
} else if (endpoint.includes('/pulls/') && endpoint.endsWith('/files')) {
    process.stdout.write(JSON.parse(process.env.MOCK_CHANGED_FILES).join('\\n'));
} else if (endpoint.includes('/compare/')) {
    process.stdout.write('merge-base');
} else if (endpoint.includes('/contents/')) {
    const value = JSON.parse(process.env.MOCK_MANIFESTS)[endpoint];
    if (value === undefined) {
        process.stderr.write('gh: Not Found (HTTP 404)\\n');
        process.exit(1);
    }
    process.stdout.write(JSON.stringify(value));
} else if (endpoint.includes('/comments') && args.includes('--paginate')) {
    const comments = JSON.parse(process.env.MOCK_COMMENTS);
    const botComment = comments.find(comment => comment.user.login === 'github-actions[bot]' && comment.body.includes('<!-- dependency-impact -->'));
    process.stdout.write(botComment ? String(botComment.id) : '');
} else {
    process.stdout.write('{}');
}
`,
        { mode: 0o755 },
    );

    const eventPath = path.join(temporaryDirectory, 'event.json');
    fs.writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { number: 42, base: { sha: 'base' }, head: { sha: 'head' } } }),
    );

    try {
        const result = spawnSync(process.execPath, [classifierPath], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH}`,
                GITHUB_EVENT_PATH: eventPath,
                GITHUB_REPOSITORY: 'vendurehq/vendure',
                MOCK_CHANGED_FILES: JSON.stringify(files),
                MOCK_MANIFESTS: JSON.stringify(manifests),
                MOCK_COMMENTS: JSON.stringify(comments),
                MOCK_FAILURES: JSON.stringify(failures),
                MOCK_GH_CALLS_PATH: callsPath,
            },
        });
        if (result.status !== 0) {
            const error = new Error(
                `classifier failed with status ${result.status}: ${result.stderr.trim()}`,
            );
            error.stdout = result.stdout;
            error.stderr = result.stderr;
            throw error;
        }
        const calls = fs
            .readFileSync(callsPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
        return { output: result.stdout, calls };
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function manifestEndpoint(filePath, ref) {
    return `repos/vendurehq/vendure/contents/${filePath}?ref=${ref}`;
}

function appliedLabels(calls) {
    return calls
        .filter(args => args[1] === 'repos/vendurehq/vendure/issues/42/labels' && args.includes('POST'))
        .flatMap(args => args.filter(arg => arg.startsWith('labels[]=')))
        .map(arg => arg.slice('labels[]='.length));
}

test('labels a published dependency range edit as a contract change', () => {
    const filePath = 'packages/core/package.json';
    const { output, calls } = runClassifier({
        files: [filePath, 'bun.lock'],
        manifests: {
            [manifestEndpoint(filePath, 'merge-base')]: {
                name: '@vendure/core',
                dependencies: { graphql: '^16.0.0' },
            },
            [manifestEndpoint(filePath, 'head')]: {
                name: '@vendure/core',
                dependencies: { graphql: '^17.0.0' },
            },
        },
    });

    assert.deepEqual(appliedLabels(calls), ['deps: contract change']);
    assert.match(output, /1 contract, 0 other/);
});

test('labels lockfile and private manifest edits as having no contract change', () => {
    const filePath = 'packages/dev-server/package.json';
    const { output, calls } = runClassifier({
        files: [filePath, 'bun.lock'],
        manifests: {
            [manifestEndpoint(filePath, 'merge-base')]: {
                name: '@vendure/dev-server',
                private: true,
                devDependencies: { vite: '^6.0.0' },
            },
            [manifestEndpoint(filePath, 'head')]: {
                name: '@vendure/dev-server',
                private: true,
                devDependencies: { vite: '^7.0.0' },
            },
        },
    });

    assert.deepEqual(appliedLabels(calls), ['deps: lockfile only']);
    assert.match(output, /0 contract, 1 other/);
});

test('compares a stale pull request head with its merge base', () => {
    const filePath = 'packages/core/package.json';
    const { output, calls } = runClassifier({
        files: [filePath],
        manifests: {
            [manifestEndpoint(filePath, 'merge-base')]: {
                name: '@vendure/core',
                dependencies: { graphql: '^16.0.0' },
                devDependencies: { vitest: '^3.0.0' },
            },
            [manifestEndpoint(filePath, 'head')]: {
                name: '@vendure/core',
                dependencies: { graphql: '^16.0.0' },
                devDependencies: { vitest: '^4.0.0' },
            },
        },
    });

    assert.deepEqual(appliedLabels(calls), ['deps: lockfile only']);
    assert.match(output, /0 contract, 1 other/);
});

test('clears both labels and the bot report when no dependency files remain', () => {
    const { output, calls } = runClassifier({
        files: ['README.md'],
        comments: [
            { id: 12, user: { login: 'contributor' }, body: '<!-- dependency-impact -->' },
            { id: 34, user: { login: 'github-actions[bot]' }, body: '<!-- dependency-impact -->' },
        ],
    });

    const deletedEndpoints = calls.filter(args => args.includes('DELETE')).map(args => args[1]);
    assert.deepEqual(deletedEndpoints, [
        'repos/vendurehq/vendure/issues/42/labels/deps%3A%20contract%20change',
        'repos/vendurehq/vendure/issues/42/labels/deps%3A%20lockfile%20only',
        'repos/vendurehq/vendure/issues/comments/34',
    ]);
    assert.match(output, /cleared dependency impact classification/);
});

test('does not suppress a failure while removing the opposite label', () => {
    assert.throws(
        () =>
            runClassifier({
                files: ['bun.lock'],
                failures: {
                    'repos/vendurehq/vendure/issues/42/labels/deps%3A%20contract%20change': 500,
                },
            }),
        /classifier failed with status 1/,
    );
});

test('accepts a concurrent label creation only after confirming the label exists', () => {
    const labelEndpoint = 'repos/vendurehq/vendure/labels/deps%3A%20contract%20change';
    const { calls } = runClassifier({
        files: ['bun.lock'],
        failures: {
            [labelEndpoint]: [404, null],
            'repos/vendurehq/vendure/labels': [422],
        },
    });

    assert.equal(calls.filter(args => args[1] === labelEndpoint).length, 2);
    assert.equal(calls.filter(args => args[1] === 'repos/vendurehq/vendure/labels').length, 1);
});

test('updates only a report owned by github-actions', () => {
    const { calls } = runClassifier({
        files: ['bun.lock'],
        comments: [
            { id: 12, user: { login: 'contributor' }, body: '<!-- dependency-impact -->' },
            { id: 34, user: { login: 'github-actions[bot]' }, body: '<!-- dependency-impact -->' },
        ],
    });

    assert.ok(calls.some(args => args[1] === 'repos/vendurehq/vendure/issues/comments/34'));
    assert.ok(!calls.some(args => args[1] === 'repos/vendurehq/vendure/issues/comments/12'));
});

test('escapes untrusted dependency names and ranges in the report table', () => {
    const filePath = 'packages/core/package.json';
    const { calls } = runClassifier({
        files: [filePath],
        manifests: {
            [manifestEndpoint(filePath, 'merge-base')]: {
                name: '@vendure/core',
                dependencies: { 'unsafe|`name': '^1.0.0' },
            },
            [manifestEndpoint(filePath, 'head')]: {
                name: '@vendure/core',
                dependencies: { 'unsafe|`name': '^2.0.0\n| forged | row |' },
            },
        },
    });
    const commentCall = calls.find(
        args => args[1] === 'repos/vendurehq/vendure/issues/42/comments' && args.includes('POST'),
    );
    const body = commentCall.find(arg => arg.startsWith('body='));

    assert.match(body, /unsafe&#124;&#96;name/);
    assert.match(body, /\^2\.0\.0<br>&#124; forged &#124; row &#124;/);
    assert.doesNotMatch(body, /\n\| forged \| row \|/);
});

test('reads a dependency section that is not an object as absent', () => {
    const filePath = 'packages/core/package.json';
    const { output, calls } = runClassifier({
        files: [filePath],
        manifests: {
            [manifestEndpoint(filePath, 'merge-base')]: {
                name: '@vendure/core',
                dependencies: { graphql: '^16.0.0' },
            },
            // Valid JSON, invalid npm. Object.keys on the string would report one change per
            // character and flip the label on nonsense.
            [manifestEndpoint(filePath, 'head')]: {
                name: '@vendure/core',
                dependencies: 'graphql',
            },
        },
    });

    assert.deepEqual(appliedLabels(calls), ['deps: contract change']);
    assert.match(output, /1 contract, 0 other/);
    const body = calls
        .find(args => args[1] === 'repos/vendurehq/vendure/issues/42/comments' && args.includes('POST'))
        .find(arg => arg.startsWith('body='));
    assert.match(body, /`graphql` \| packages\/core \/ dependencies \| removed `\^16\.0\.0`/);
    assert.doesNotMatch(body, /\| `0` \|/);
});

test('percent-encodes a manifest path before asking the contents API for it', () => {
    const filePath = 'packages/core/we?ref=master#/package.json';
    const encoded = 'packages/core/we%3Fref%3Dmaster%23/package.json';
    const { calls } = runClassifier({
        files: [filePath],
        manifests: {
            [manifestEndpoint(encoded, 'merge-base')]: { dependencies: { a: '^1.0.0' } },
            [manifestEndpoint(encoded, 'head')]: { dependencies: { a: '^2.0.0' } },
        },
    });

    assert.ok(calls.some(args => args[1] === manifestEndpoint(encoded, 'head')));
    assert.ok(!calls.some(args => args[1] === manifestEndpoint(filePath, 'head')));
});
