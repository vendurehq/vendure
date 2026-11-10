const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname, 'detect-changes.sh');

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
            ...process.env,
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
            ...process.env,
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
            ...process.env,
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

test('workflow and composite-action changes enable package and dashboard jobs', () => {
    assert.deepEqual(runClassifier('.github/workflows/build_and_test.yml'), {
        packages: 'true',
        dashboard: 'true',
    });
    assert.deepEqual(runClassifier('.github/actions/setup/action.yml'), {
        packages: 'true',
        dashboard: 'true',
    });
});

test('dashboard changes enable both classifiers', () => {
    assert.deepEqual(runClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
    });
});

test('unrelated documentation changes do not enable package jobs', () => {
    assert.deepEqual(runClassifier('docs/README.md'), {
        packages: 'false',
        dashboard: 'false',
    });
});

test('workflow dispatch enables both classifiers without a diff', () => {
    assert.deepEqual(runClassifier('docs/README.md', 'workflow_dispatch'), {
        packages: 'true',
        dashboard: 'true',
    });
});

test('push events use event.before across multiple commits', () => {
    assert.deepEqual(runPushClassifier('packages/core/src/index.ts'), {
        packages: 'true',
        dashboard: 'false',
    });
    assert.deepEqual(runPushClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
    });
});

test('a long changed-path list still detects the package change listed first', () => {
    assert.deepEqual(runLongDiffClassifier('packages/core/src/index.ts'), {
        packages: 'true',
        dashboard: 'false',
    });
    assert.deepEqual(runLongDiffClassifier('packages/dashboard/src/index.ts'), {
        packages: 'true',
        dashboard: 'true',
    });
});
