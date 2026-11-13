/* eslint-disable */
// Turns results.jsonl from run.cjs into a markdown discrepancy matrix.
// Usage: node summarize.cjs results.jsonl [more.jsonl] > matrix.md
const fs = require('fs');
const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
const DST_KEYS = ['viennaFallBack2', 'laFallBack2', 'utcInViennaGap'];
const INSTANTS = {
    winter: '2026-01-15T12:00:00.000Z', summer: '2026-07-15T12:00:00.000Z', viennaSpringGap: '2026-03-29T01:30:00.000Z',
    utcInViennaGap: '2026-03-29T02:30:00.000Z', viennaFallBack1: '2026-10-25T00:30:00.000Z', viennaFallBack2: '2026-10-25T01:30:00.000Z',
    laSpring: '2026-03-08T10:30:00.000Z', laFallBack1: '2026-11-01T08:30:00.000Z', laFallBack2: '2026-11-01T09:30:00.000Z', kolkataMidnight: '2026-05-10T18:45:00.000Z',
};
const fmtH = h => (h > 0 ? '+' : '') + h + 'h';

function offsets(rec, col, field = 'readOffsetH') {
    const by = {};
    for (const [k, r] of Object.entries(rec.rows)) {
        const c = r[col];
        if (!c) continue;
        if (c.writeError) { by[k] = 'ERR'; continue; }
        by[k] = c[field];
    }
    return by;
}
function describe(by) {
    const entries = Object.entries(by);
    if (!entries.length) return 'n/a';
    const errs = entries.filter(([, v]) => v === 'ERR').map(([k]) => k);
    const bad = entries.filter(([, v]) => v !== 'ERR' && v !== 0);
    if (!bad.length && !errs.length) return '✅';
    const vals = [...new Set(bad.map(([, v]) => v))];
    const allDst = bad.every(([k]) => DST_KEYS.includes(k));
    let s = '';
    if (bad.length) {
        s = allDst ? `❌ DST only: ${bad.map(([k, v]) => `${fmtH(v)} (${k})`).join(', ')}` : `❌ ${vals.map(fmtH).join(' / ')}${bad.length < entries.length - errs.length ? ` (${bad.length}/${entries.length})` : ''}`;
    }
    if (errs.length) s += (s ? '; ' : '') + `💥 insert fails (${errs.join(', ')})`;
    return s;
}
function localDay(iso, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function filterCol(rec, col, field) {
    const miss = Object.entries(rec.rows).filter(([, r]) => r[col] && !r[col].writeError && r[col][field] === false).map(([k]) => k);
    const total = Object.values(rec.rows).filter(r => r[col] && !r[col].writeError).length;
    return miss.length ? `❌ misses ${miss.length}/${total}` : '✅';
}
function metrics(rec, col) {
    // what day the dashboard metrics SQL buckets the order into, compared with UTC day / node-local day
    const kinds = new Set();
    for (const [k, r] of Object.entries(rec.rows)) {
        const c = r[col];
        if (!c || c.writeError) continue;
        const iso = INSTANTS[k];
        const utc = iso.slice(0, 10);
        const node = localDay(iso, rec.readTz);
        if (c.metricsDay === utc && c.metricsDay === node) continue;
        if (c.metricsDay === node) kinds.add('Node-local day');
        else if (c.metricsDay === utc) kinds.add('UTC day');
        else kinds.add('other: ' + c.metricsDay + ' for ' + k);
    }
    return kinds.size ? [...kinds].join(', ') : 'same';
}

const groups = {};
for (const r of recs) (groups[r.typeorm + ' / ' + r.db] ||= []).push(r);
for (const [g, list] of Object.entries(groups)) {
    console.log(`\n### ${g}\n`);
    const isPg = list[0].db === 'postgres';
    const isMy = list[0].db === 'mysql' || list[0].db === 'mariadb';
    const head = ['Scenario', 'createdAt (DB default)', 'updatedAt', 'Date cols (orderPlacedAt etc.)', 'custom field datetime'];
    if (isPg) head.push('timestamptz col', 'createdAt as timestamptz');
    if (isMy) head.push('TIMESTAMP col', 'createdAt as TIMESTAMP');
    head.push('raw stored vs UTC (Date cols)', 'list filter (Date cols)', isPg ? 'list filter (timestamptz)' : isMy ? 'list filter (TIMESTAMP)' : null, 'metrics day bucket');
    const h = head.filter(Boolean);
    console.log('| ' + h.join(' | ') + ' |');
    console.log('|' + h.map(() => '---').join('|') + '|');
    for (const rec of list) {
        const scen = [
            rec.writeTz === rec.readTz ? `TZ=${rec.writeTz}` : `TZ ${rec.writeTz} → ${rec.readTz}`,
            rec.pgServerTz ? `pg server ${rec.pgServerTz}` : null,
            rec.pgSession ? `session: ${rec.pgSession}` : null,
            rec.mysqlGlobalTz ? `time_zone ${rec.mysqlGlobalTz}` : null,
            rec.typeormTimezone ? `typeorm tz '${rec.typeormTimezone}'` : null,
        ].filter(Boolean).join(', ');
        const cells = [scen, describe(offsets(rec, 'createdAt')), describe(offsets(rec, 'updatedAt')), describe(offsets(rec, 'placedAt')), describe(offsets(rec, 'cfDatetime'))];
        if (isPg || isMy) cells.push(describe(offsets(rec, 'tzCol')), describe(offsets(rec, 'createdTz')));
        cells.push(describe(offsets(rec, 'placedAt', 'rawAsUtcOffsetH')), filterCol(rec, 'placedAt', 'listFilterHit'));
        if (isPg || isMy) cells.push(filterCol(rec, 'tzCol', 'listFilterHit'));
        cells.push(metrics(rec, 'placedAt'));
        console.log('| ' + cells.join(' | ') + ' |');
    }
}
