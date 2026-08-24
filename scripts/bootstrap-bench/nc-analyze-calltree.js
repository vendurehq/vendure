/**
 * Call-tree analyzer for a .cpuprofile captured alongside nc-phases-entry.js.
 * Unlike analyze-profile.js (self-time only, grouped by npm package), this:
 *  - slices samples to a [--from, --to] window in performance.now() ms
 *    (calibrated against profile.startTime, see nc-phases-entry.js output),
 *  - computes INCLUSIVE (total) time per call-tree node by propagating each
 *    sample's time delta up through its ancestor chain,
 *  - reports top call paths by inclusive time, top functions by inclusive
 *    time (deduplicated across call paths), top leaves by self time, and a
 *    category rollup (typeorm-metadata, typeorm-connect, nestjs-core,
 *    reflect-metadata, graphql, other) based on url/functionName regexes.
 *
 * Usage:
 *   node nc-analyze-calltree.js <profile.cpuprofile> --from=<ms> --to=<ms> [--top=30] [--paths=20]
 *
 * If --from/--to are omitted, the whole profile is analyzed.
 */
const fs = require('fs');

const file = process.argv[2];
const from = Number((process.argv.find(a => a.startsWith('--from=')) || '').split('=')[1] || '-Infinity');
const to = Number((process.argv.find(a => a.startsWith('--to=')) || '').split('=')[1] || 'Infinity');
const top = Number((process.argv.find(a => a.startsWith('--top=')) || '').split('=')[1] || 30);
const pathsN = Number((process.argv.find(a => a.startsWith('--paths=')) || '').split('=')[1] || 20);

const profile = JSON.parse(fs.readFileSync(file, 'utf-8'));
const { nodes, samples, timeDeltas, startTime } = profile;

const windowStartUs = from === -Infinity ? -Infinity : startTime + from * 1000;
const windowEndUs = to === Infinity ? Infinity : startTime + to * 1000;

const nodeById = new Map(nodes.map(n => [n.id, n]));
const parentOf = new Map();
for (const n of nodes) {
    for (const c of n.children || []) parentOf.set(c, n.id);
}

// Walk samples, accumulating each sample's time delta into a running clock,
// and — for samples inside the window — into self-time (leaf) and inclusive
// time (leaf + every ancestor up to root).
const selfTimeUs = new Map();
const inclTimeUs = new Map();
const sampleCountUs = new Map(); // inclusive sample count per node, for call counts approximation
let clock = startTime;
let sampledUs = 0;
let sampleCount = 0;
for (let i = 0; i < samples.length; i++) {
    const delta = timeDeltas[i] || 0;
    const sampleMid = clock + delta / 2;
    clock += delta;
    if (sampleMid < windowStartUs || sampleMid > windowEndUs) continue;
    sampledUs += delta;
    sampleCount++;
    const leaf = samples[i];
    selfTimeUs.set(leaf, (selfTimeUs.get(leaf) || 0) + delta);
    let cur = leaf;
    const seen = new Set();
    while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        inclTimeUs.set(cur, (inclTimeUs.get(cur) || 0) + delta);
        sampleCountUs.set(cur, (sampleCountUs.get(cur) || 0) + 1);
        cur = parentOf.get(cur);
    }
}

function frameLabel(node) {
    const { functionName, url, lineNumber } = node.callFrame;
    const name = functionName || '(anonymous)';
    if (!url) return name;
    const nm = url.lastIndexOf('node_modules/');
    let shortUrl;
    if (nm >= 0) {
        shortUrl = url.slice(nm + 'node_modules/'.length);
    } else {
        shortUrl = url.replace(/^.*just-fly\//, '');
    }
    return `${name} (${shortUrl}:${lineNumber + 1})`;
}

function pathToRoot(id) {
    const parts = [];
    let cur = id;
    const seen = new Set();
    while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        const n = nodeById.get(cur);
        if (n && n.callFrame.functionName !== '(root)') parts.push(frameLabel(n));
        cur = parentOf.get(cur);
    }
    return parts.reverse();
}

console.log(`=== ${file} ===`);
console.log(`window: [${from}ms, ${to}ms] -> sampled ${(sampledUs / 1000).toFixed(1)}ms across ${sampleCount} samples\n`);

// --- Top call paths by inclusive time, restricted to leaf nodes (nodes that
// are themselves sample leaves at least once) so we see concrete hot paths. ---
console.log(`--- top ${pathsN} leaf call paths by self time ---`);
const leafSelf = [...selfTimeUs.entries()].sort((a, b) => b[1] - a[1]).slice(0, pathsN);
for (const [id, us] of leafSelf) {
    const pct = ((us / sampledUs) * 100).toFixed(1);
    console.log(`${(us / 1000).toFixed(2).padStart(8)}ms  ${pct.padStart(5)}%  ${pathToRoot(id).join(' > ')}`);
}

// --- Top functions by inclusive time, deduplicated by function label
// (summing across all call-tree node ids that share the same label, i.e.
// the same function reached via different call paths / recursion). ---
console.log(`\n--- top ${top} functions by INCLUSIVE time (deduped by function identity) ---`);
const inclByLabel = new Map();
const selfByLabel = new Map();
const callsByLabel = new Map();
for (const [id, us] of inclTimeUs) {
    const n = nodeById.get(id);
    if (!n) continue;
    const label = frameLabel(n);
    inclByLabel.set(label, (inclByLabel.get(label) || 0) + us);
}
for (const [id, us] of selfTimeUs) {
    const n = nodeById.get(id);
    if (!n) continue;
    const label = frameLabel(n);
    selfByLabel.set(label, (selfByLabel.get(label) || 0) + us);
}
// NOTE: inclByLabel double-counts recursive/re-entrant call paths that share
// a label (e.g. helper called from many sites) since each ancestor chain
// independently contributes. Treat as an upper bound, cross-check with self.
const sortedIncl = [...inclByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
for (const [label, us] of sortedIncl) {
    const selfUs = selfByLabel.get(label) || 0;
    console.log(
        `${(us / 1000).toFixed(2).padStart(8)}ms incl  ${(selfUs / 1000).toFixed(2).padStart(8)}ms self  ${label}`,
    );
}

// --- Category rollup ---
const categories = [
    { name: 'typeorm: entity-metadata build', re: /typeorm\/.*(metadata|Metadata|EntityMetadataBuilder|EntityMetadataValidator|MetadataArgsStorage|decorators)/ },
    { name: 'typeorm: connection/driver/connect', re: /typeorm\/.*(Connection|Driver|driver|DataSource)/ },
    { name: 'typeorm: other', re: /[\\/]typeorm[\\/]/ },
    { name: 'better-sqlite3', re: /better-sqlite3/ },
    { name: '@nestjs/core: scanner', re: /@nestjs\/core\/.*scanner/i },
    { name: '@nestjs/core: injector/instance-loader', re: /@nestjs\/core\/.*(injector|instance-loader|instance-wrapper)/i },
    { name: '@nestjs/core: module-ref/compiler', re: /@nestjs\/core\/.*(module|nest-factory|nest-application)/i },
    { name: '@nestjs/core: other', re: /@nestjs\/core/ },
    { name: '@nestjs/common', re: /@nestjs\/common/ },
    { name: '@nestjs/typeorm', re: /@nestjs\/typeorm/ },
    { name: '@nestjs/graphql', re: /@nestjs\/graphql/ },
    { name: 'graphql / @graphql-tools', re: /(^|\/)graphql\/|@graphql-tools/ },
    { name: 'reflect-metadata', re: /reflect-metadata/ },
    { name: 'vendure/core (workspace)', re: /packages\/core\/dist/ },
    { name: '(program) / gc / other native', re: /^$/ },
];
function categorize(node) {
    const url = node.callFrame.url || '';
    if (node.callFrame.functionName === '(program)') return '(program) / gc / other native';
    if (node.callFrame.functionName === '(garbage collector)') return '(program) / gc / other native';
    for (const c of categories) {
        if (c.re.test(url)) return c.name;
    }
    if (url.startsWith('node:')) return 'node internals';
    if (!url) return '(anonymous/native)';
    return 'other';
}
const catSelf = new Map();
for (const [id, us] of selfTimeUs) {
    const n = nodeById.get(id);
    if (!n) continue;
    const cat = categorize(n);
    catSelf.set(cat, (catSelf.get(cat) || 0) + us);
}
console.log(`\n--- category rollup (self time, mutually exclusive, sums to window total) ---`);
const sortedCat = [...catSelf.entries()].sort((a, b) => b[1] - a[1]);
for (const [cat, us] of sortedCat) {
    const pct = ((us / sampledUs) * 100).toFixed(1);
    console.log(`${(us / 1000).toFixed(2).padStart(8)}ms  ${pct.padStart(5)}%  ${cat}`);
}
