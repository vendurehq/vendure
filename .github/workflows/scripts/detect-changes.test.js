const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname, 'detect-changes.sh');

// Stands in for `bun run nx show projects --affected --base=<sha> --head=HEAD`.
// It reports one project when the diff touches `packages/` or `e2e-common/`, as
// Nx does for those inputs. The real Nx graph is out of scope for this test.
function makeFakeBin() {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-detect-changes-bin-'));
    fs.writeFileSync(
        path.join(bin, 'bun'),
        [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            '[[ "$*" == "run nx show projects --affected --base="*" --head=HEAD" ]] || exit 64',
            'base="${6#--base=}"',
            // A here-string, not a pipe: with `pipefail`, `grep -q` closes the pipe early on a
            // long diff and the failed `git diff` would hide the match.
            'changed=$(git diff --name-only "$base" HEAD)',
            'grep -qE "^(packages|e2e-common)/" <<< "$changed" && echo "@vendure/core" || true',
            '',
        ].join('\n'),
        { mode: 0o755 },
    );
    return bin;
}

const fakeBin = makeFakeBin();
const fakeEnv = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

function runClassifier(changedPath, eventName = 'pull_request') {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-detect-changes-'));
    const output = path.join(repo, 'github-output');
    execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'workflow-test'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'workflow-test@example.invalid'], { cwd: repo });
    fs.mkdirSync(path.join(repo, path.dirname(changedPath)), { recursive: true });
    fs.writeFileSync(path.join(repo, changedPath), 'changed\n');
    execFileSync('git', ['add', changedPath], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
    fs.writeFileSync(path.join(repo, changedPath), 'changed again\n');
    execFileSync('git', ['commit', '-qam', 'change'], { cwd: repo });
    const base = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: repo, encoding: 'utf8' }).trim();
    execFileSync('bash', [script], {
        cwd: repo,
        env: {
            ...fakeEnv,
            GITHUB_BASE_SHA: base,
            GITHUB_EVENT_NAME: eventName,
            GITHUB_OUTPUT: output,
        },
    });
    return Object.fromEntries(
        fs
            .readFileSync(output, 'utf8')
            .trim()
            .split('\n')
            .map(line => line.split('=')),
    );
}

function runPushClassifier(changedPath) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-detect-changes-push-'));
    const output = path.join(repo, 'github-output');
    execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'workflow-test'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'workflow-test@example.invalid'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/README.md'), 'base\n');
    execFileSync('git', ['add', 'docs/README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
    const eventBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
    }).trim();

    fs.mkdirSync(path.join(repo, path.dirname(changedPath)), { recursive: true });
    fs.writeFileSync(path.join(repo, changedPath), 'package change\n');
    execFileSync('git', ['add', changedPath], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'package change'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'docs/README.md'), 'documentation follow-up\n');
    execFileSync('git', ['commit', '-qam', 'docs follow-up'], { cwd: repo });

    execFileSync('bash', [script], {
        cwd: repo,
        env: {
            ...fakeEnv,
            GITHUB_EVENT_BEFORE: eventBefore,
            GITHUB_EVENT_NAME: 'push',
            GITHUB_OUTPUT: output,
        },
    });
    return Object.fromEntries(
        fs
            .readFileSync(output, 'utf8')
            .trim()
            .split('\n')
            .map(line => line.split('=')),
    );
}

function runLongDiffClassifier(changedPath) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-detect-changes-long-'));
    const output = path.join(repo, 'github-output');
    execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'workflow-test'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'workflow-test@example.invalid'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    // git lists changed paths in sorted order, so `changedPath` comes first and the
    // `site/` paths after it make the list larger than a pipe buffer.
    fs.mkdirSync(path.join(repo, path.dirname(changedPath)), { recursive: true });
    fs.writeFileSync(path.join(repo, changedPath), 'package change\n');
    const filler = path.join(repo, 'site', 'a-long-directory-name-to-make-each-changed-path-longer');
    fs.mkdirSync(filler, { recursive: true });
    for (let i = 0; i < 2000; i++) {
        fs.writeFileSync(path.join(filler, `page-${i}.md`), `${i}\n`);
    }
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'large change'], { cwd: repo });

    execFileSync('bash', [script], {
        cwd: repo,
        env: {
            ...fakeEnv,
            GITHUB_BASE_SHA: base,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_OUTPUT: output,
        },
    });
    return Object.fromEntries(
        fs
            .readFileSync(output, 'utf8')
            .trim()
            .split('\n')
            .map(line => line.split('=')),
    );
}

test('workflow and composite-action changes enable package and dashboard jobs for all projects', () => {
    assert.deepEqual(runClassifier('.github/workflows/build_and_test.yml'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'run-many',
    });
    assert.deepEqual(runClassifier('.github/actions/setup/action.yml'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'run-many',
    });
});

test('dashboard changes enable both classifiers', () => {
    assert.deepEqual(runClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'affected',
    });
});

test('unrelated documentation changes do not enable package jobs', () => {
    assert.deepEqual(runClassifier('docs/README.md'), {
        packages: 'false',
        dashboard: 'false',
        nx: 'affected',
    });
});

test('changes that Nx maps to a project enable package jobs', () => {
    assert.equal(runClassifier('e2e-common/test-config.ts').packages, 'true');
});

test('root scripts and ESLint config enable package jobs without an affected project', () => {
    assert.equal(runClassifier('package.json').packages, 'true');
    assert.equal(runClassifier('.eslintrc.boundaries.js').packages, 'true');
});

test('workflow dispatch enables both classifiers for all projects without a diff', () => {
    assert.deepEqual(runClassifier('docs/README.md', 'workflow_dispatch'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'run-many',
    });
});

test('push events use event.before across multiple commits', () => {
    assert.deepEqual(runPushClassifier('packages/core/src/index.ts'), {
        packages: 'true',
        dashboard: 'false',
        nx: 'affected',
    });
    assert.deepEqual(runPushClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'affected',
    });
});

test('a long changed-path list still detects the package change listed first', () => {
    assert.deepEqual(runLongDiffClassifier('packages/core/src/index.ts'), {
        packages: 'true',
        dashboard: 'false',
        nx: 'affected',
    });
    assert.deepEqual(runLongDiffClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
        nx: 'affected',
    });
});
