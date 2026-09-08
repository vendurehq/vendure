/**
 * Aggregates a .cpuprofile by self-time, grouped by npm package (or file for
 * workspace code). Usage: node analyze-profile.js <file.cpuprofile> [--top=30] [--files]
 */
const fs = require('node:fs');
const { resolveInRepo } = require('./resolve-in-repo');

const file = resolveInRepo(process.argv[2], 'profile path');
const top = Number((process.argv.find(a => a.startsWith('--top=')) || '').split('=')[1] || 30);
const byFile = process.argv.includes('--files');
const profile = JSON.parse(fs.readFileSync(file, 'utf-8'));

const { nodes, samples, timeDeltas } = profile;
const nodeById = new Map(nodes.map(n => [n.id, n]));
const selfTime = new Map();
for (let i = 0; i < samples.length; i++) {
    const delta = timeDeltas[i] || 0;
    selfTime.set(samples[i], (selfTime.get(samples[i]) || 0) + delta);
}

function groupKey(url) {
    if (!url?.includes('/')) return url || '(program)';
    const nm = url.lastIndexOf('node_modules/');
    if (nm >= 0) {
        const rest = url.slice(nm + 'node_modules/'.length);
        const parts = rest.split('/');
        const pkg = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
        if (byFile) return pkg + ':' + parts.slice(pkg.startsWith('@') ? 2 : 1).join('/');
        return pkg;
    }
    if (url.startsWith('node:')) return byFile ? url : '(node internals)';
    return url.replace(/^.*just-fly\//, '');
}

const byGroup = new Map();
for (const [id, us] of selfTime) {
    const node = nodeById.get(id);
    if (!node) continue;
    const key = groupKey(node.callFrame.url);
    byGroup.set(key, (byGroup.get(key) || 0) + us);
}

const total = [...selfTime.values()].reduce((a, b) => a + b, 0);
const sorted = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
console.log(`total sampled: ${(total / 1000).toFixed(1)}ms`);
for (const [key, us] of sorted) {
    console.log(`${(us / 1000).toFixed(1).padStart(9)}ms  ${((us / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}
