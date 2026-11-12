const assert = require('node:assert/strict');
const test = require('node:test');

const { CORE_SHARDS, planE2e } = require('./plan-e2e');

test('runs core in shards and the other packages in one job for each database', () => {
    const plan = planE2e(['@vendure/core', '@vendure/harden-plugin']);
    assert.deepEqual(Object.keys(plan), ['sqljs', 'mariadb', 'postgres', 'mysql']);
    for (const [db, jobs] of Object.entries(plan)) {
        const count = CORE_SHARDS[db];
        assert.deepEqual(jobs, [
            { id: 'plugins' },
            ...Array.from({ length: count }, (_, i) => ({ id: `core-${i + 1}`, shard: `${i + 1}/${count}` })),
        ]);
    }
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
        Array.from({ length: CORE_SHARDS.mysql }, (_, i) => `core-${i + 1}`),
    );
});

test('starts no jobs when no project with an e2e target is affected', () => {
    for (const jobs of Object.values(planE2e([]))) {
        assert.deepEqual(jobs, []);
    }
});
