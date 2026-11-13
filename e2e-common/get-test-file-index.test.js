const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { getTestFileIndex, listTestFiles } = require('./get-test-file-index');

/** @param {string[]} files */
function createPackage(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-test-file-index-'));
    for (const file of files) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), '');
    }
    return root;
}

test('gives each test file of core its own index in the port range', () => {
    const coreRoot = path.join(__dirname, '../packages/core');
    const files = listTestFiles(coreRoot);
    const indexes = files.map(file => getTestFileIndex(coreRoot, path.join(coreRoot, file)));
    assert.deepEqual(
        indexes,
        files.map((_, index) => index),
    );
    // The size of the core port range in test-config.ts.
    assert.ok(files.length <= 190, `core has ${files.length} test files`);
});

test('does not change the index when the __data__ folder exists', () => {
    const root = createPackage(['e2e/a.e2e-spec.ts', 'e2e/b.e2e-spec.ts', 'e2e/__snapshots__/a.snap']);
    const before = getTestFileIndex(root, path.join(root, 'e2e/b.e2e-spec.ts'));
    fs.mkdirSync(path.join(root, 'e2e/__data__'));
    fs.writeFileSync(path.join(root, 'e2e/__data__/a.e2e-spec.ts.sqlite'), '');
    assert.equal(getTestFileIndex(root, path.join(root, 'e2e/b.e2e-spec.ts')), before);
    assert.equal(before, 1);
});

test('counts the test files in sub-folders and outside the e2e folder', () => {
    const root = createPackage([
        'e2e/a.e2e-spec.ts',
        'e2e/search/a.e2e-spec.ts',
        'e2e/search/b.e2e-spec.ts',
        'e2e/search.bench.ts',
        'e2e/fixtures/data.csv',
        'plugin/service/metrics.e2e-spec.ts',
        'node_modules/dep/x.e2e-spec.ts',
    ]);
    assert.deepEqual(listTestFiles(root), [
        'e2e/a.e2e-spec.ts',
        'e2e/search.bench.ts',
        'e2e/search/a.e2e-spec.ts',
        'e2e/search/b.e2e-spec.ts',
        'plugin/service/metrics.e2e-spec.ts',
    ]);
    assert.equal(getTestFileIndex(root, path.join(root, 'e2e/search/a.e2e-spec.ts')), 2);
    assert.equal(getTestFileIndex(root, path.join(root, 'e2e/fixtures/data.csv')), -1);
});
