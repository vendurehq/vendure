const assert = require('node:assert/strict');
const test = require('node:test');

const { planE2e } = require('./plan-e2e');

test('runs core in shards and the other packages in one job for each database', () => {
    const plan = planE2e(['@vendure/core', '@vendure/harden-plugin']);
    assert.deepEqual(Object.keys(plan), ['sqljs', 'mariadb', 'postgres', 'mysql']);
    assert.deepEqual(plan.sqljs, [
        { id: 'plugins' },
        { id: 'core-1', shard: '1/3' },
        { id: 'core-2', shard: '2/3' },
        { id: 'core-3', shard: '3/3' },
    ]);
    assert.equal(plan.mariadb.length, 4);
    assert.equal(plan.postgres.length, 5);
    assert.equal(plan.mysql.length, 6);
});

test('starts no core shards when core is not affected', () => {
    const plan = planE2e(['@vendure/harden-plugin']);
    for (const jobs of Object.values(plan)) {
        assert.deepEqual(jobs, [{ id: 'plugins' }]);
    }
});

test('starts no plugins job when only core is affected', () => {
    const plan = planE2e(['@vendure/core']);
    assert.deepEqual(
        plan.mysql.map(job => job.id),
        ['core-1', 'core-2', 'core-3', 'core-4', 'core-5'],
    );
});

test('starts no jobs when no project with an e2e target is affected', () => {
    for (const jobs of Object.values(planE2e([]))) {
        assert.deepEqual(jobs, []);
    }
});
