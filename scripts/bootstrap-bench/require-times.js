/**
 * Preload hook that measures per-package require cost (exclusive time per module
 * file, summed by package) and module counts.
 * Usage: node -r ./scripts/bootstrap-bench/require-times.js <entry> [BENCH_REQUIRE_REPORT=stderr]
 */
const Module = require('node:module');

const stack = [];
const byGroup = new Map();
let totalModules = 0;

function groupKey(filename) {
    const nm = filename.lastIndexOf('node_modules/');
    if (nm >= 0) {
        const rest = filename.slice(nm + 'node_modules/'.length);
        const parts = rest.split('/');
        return parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
    }
    return filename.replace(/^.*just-fly\//, '').split('/').slice(0, 3).join('/');
}

const origCompile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
    const start = performance.now();
    stack.push(0); // accumulator for child time
    let result;
    try {
        result = origCompile.call(this, content, filename);
    } finally {
        const childTime = stack.pop();
        const elapsed = performance.now() - start;
        const selfTime = elapsed - childTime;
        if (stack.length > 0) stack[stack.length - 1] += elapsed;
        const key = groupKey(filename);
        const entry = byGroup.get(key) || { ms: 0, count: 0 };
        entry.ms += selfTime;
        entry.count += 1;
        byGroup.set(key, entry);
        totalModules++;
    }
    return result;
};

process.on('exit', () => {
    const sorted = [...byGroup.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 40);
    const total = [...byGroup.values()].reduce((a, b) => a + b.ms, 0);
    process.stderr.write(`\n=== require cost by package (${totalModules} modules, ${total.toFixed(0)}ms total) ===\n`);
    for (const [key, { ms, count }] of sorted) {
        process.stderr.write(`${ms.toFixed(1).padStart(9)}ms  ${String(count).padStart(5)} modules  ${key}\n`);
    }
});
