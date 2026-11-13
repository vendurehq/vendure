/* eslint-disable */
// OSS-1007 timezone harness: one "cell" = one Node process with a fixed TZ.
// Usage: TZ=... node cell.cjs '<json config>'
// config: { db, mode: 'write'|'read', ids?, typeormPath?, connection: {...extra DataSource options}, table }
// Writes known instants through TypeORM using the same column definitions Vendure uses,
// then reads them back raw (as stored), through TypeORM (what Vendure/GraphQL sees),
// and through the SQL that Vendure uses for list filters and dashboard metrics.
const cfg = JSON.parse(process.argv[2]);
const typeorm = require(cfg.typeormPath || 'typeorm');
const { DataSource, EntitySchema } = typeorm;
const DateUtils = require((cfg.typeormPath || 'typeorm') + '/util/DateUtils').DateUtils;

const INSTANTS = {
    winter: '2026-01-15T12:00:00.000Z',
    summer: '2026-07-15T12:00:00.000Z',
    viennaSpringGap: '2026-03-29T01:30:00.000Z', // Vienna 03:30 CEST, just after the 02:00->03:00 gap
    utcInViennaGap: '2026-03-29T02:30:00.000Z', // wall time 02:30 doesn't exist in Vienna that day
    viennaFallBack1: '2026-10-25T00:30:00.000Z', // Vienna 02:30 CEST (first)
    viennaFallBack2: '2026-10-25T01:30:00.000Z', // Vienna 02:30 CET (second)
    laSpring: '2026-03-08T10:30:00.000Z', // LA 03:30 PDT after the gap
    laFallBack1: '2026-11-01T08:30:00.000Z', // LA 01:30 PDT
    laFallBack2: '2026-11-01T09:30:00.000Z', // LA 01:30 PST
    kolkataMidnight: '2026-05-10T18:45:00.000Z', // 00:15 IST on 11 May; still 10 May in UTC
};

const db = cfg.db; // postgres | mysql | mariadb | better-sqlite3 | sqljs
const isPg = db === 'postgres';
const isMy = db === 'mysql' || db === 'mariadb';

function columns() {
    // Mirrors Vendure's column definitions (see report): base entity createdAt/updatedAt,
    // `@Column({ type: Date })` (deletedAt etc.), `@Column({ nullable: true })` Date (orderPlacedAt),
    // `precision: 6` (pricingUpdatedAt/job startedAt), custom field datetime (pg 'timestamp', others 'datetime', precision 6)
    const c = {
        id: { type: Number, primary: true, generated: true },
        label: { type: String, nullable: true },
        instantKey: { type: String, nullable: true },
        createdAt: { type: Date, createDate: true },
        updatedAt: { type: Date, updateDate: true },
        placedAt: { type: Date, nullable: true },
        pricedAt: { type: Date, nullable: true, precision: isPg || isMy ? 6 : undefined },
        cfDatetime: {
            type: isPg ? 'timestamp' : 'datetime',
            nullable: true,
            precision: isPg || isMy ? 6 : undefined,
        },
    };
    if (isPg) {
        c.tzCol = { type: 'timestamptz', nullable: true };
        c.createdTz = { type: 'timestamptz', createDate: true };
        c.updatedTz = { type: 'timestamptz', updateDate: true };
    }
    if (isMy) {
        c.tzCol = { type: 'timestamp', nullable: true, precision: 6 };
        c.createdTz = { type: 'timestamp', createDate: true, precision: 6 };
        c.updatedTz = { type: 'timestamp', updateDate: true, precision: 6 };
    }
    return c;
}
const EXPLICIT = ['placedAt', 'pricedAt', 'cfDatetime', ...(isPg || isMy ? ['tzCol'] : [])];
const AUTO = [
    ['createdAt', 'insert'],
    ['updatedAt', 'update'],
    ...(isPg || isMy ? [['createdTz', 'insert'], ['updatedTz', 'update']] : []),
];

const Probe = new EntitySchema({ name: 'Probe', tableName: cfg.table || 'tz_probe', columns: columns() });

function connOptions() {
    const base = { entities: [Probe], synchronize: cfg.mode === 'write' && cfg.sync, logging: false };
    if (isPg)
        return { ...base, type: 'postgres', host: '127.0.0.1', port: 17432, username: 'vendure', password: 'password', database: 'tz', ...cfg.connection };
    if (db === 'mysql')
        return { ...base, type: 'mysql', host: '127.0.0.1', port: 17306, username: 'root', password: 'password', database: 'tz', ...cfg.connection };
    if (db === 'mariadb')
        return { ...base, type: 'mariadb', host: '127.0.0.1', port: 17307, username: 'root', password: 'password', database: 'tz', ...cfg.connection };
    if (db === 'better-sqlite3') return { ...base, type: 'better-sqlite3', database: cfg.file, ...cfg.connection };
    if (db === 'sqljs') return { ...base, type: 'sqljs', location: cfg.file, autoSave: true, useLocalForage: false, ...cfg.connection, ...(require('fs').existsSync(cfg.file) ? { database: require('fs').readFileSync(cfg.file) } : {}) };
}

const q = n => (isMy ? '`' + n + '`' : '"' + n + '"');
const round = h => Math.round(h * 4) / 4;
const hours = ms => round(ms / 3600000);

function rawExpr(col) {
    if (isPg) return `${q(col)}::text`;
    if (isMy) return `CAST(${q(col)} AS CHAR)`;
    return q(col);
}
function dayExpr(col) {
    // what the dashboard MetricsService groups by (packages/dashboard/plugin/service/metrics.service.ts)
    if (isPg) return `TO_CHAR(${q(col)}, 'YYYY-MM-DD')`;
    if (isMy) return `DATE_FORMAT(${q(col)}, '%Y-%m-%d')`;
    return `STRFTIME('%Y-%m-%d', ${q(col)})`;
}

async function main() {
    const ds = new DataSource(connOptions());
    await ds.initialize();
    const out = { tz: process.env.TZ, db };
    const repo = ds.getRepository('Probe');
    if (isPg) out.session = (await ds.query('SHOW timezone'))[0].TimeZone;
    if (isMy) out.session = (await ds.query('SELECT @@session.time_zone tz, @@global.time_zone g'))[0];
    if (cfg.mode === 'write') {
        const ids = {};
        const auto = {};
        for (const [key, iso] of Object.entries(INSTANTS)) {
            const d = new Date(iso);
            const t0 = Date.now();
            const row = await repo.save({ label: 'a', instantKey: key, placedAt: d, pricedAt: d, cfDatetime: d });
            const t1 = Date.now();
            if (isPg || isMy) {
                try {
                    await ds.createQueryBuilder().update('Probe').set({ tzCol: d, updatedAt: () => q('updatedAt'), updatedTz: () => q('updatedTz') }).where('id = :id', { id: row.id }).execute();
                    row.tzCol = d;
                } catch (e) {
                    delete row.tzCol;
                    (out.writeErrors = out.writeErrors || {})[key] = 'tzCol: ' + String(e.message).slice(0, 160);
                }
            }
            await new Promise(r => setTimeout(r, 5));
            row.label = 'b';
            const t2 = Date.now();
            await repo.save(row);
            const t3 = Date.now();
            ids[key] = row.id;
            auto[row.id] = { insert: (t0 + t1) / 2, update: (t2 + t3) / 2 };
        }
        out.ids = ids;
        out.auto = auto;
    } else {
        const rows = {};
        for (const [key, id] of Object.entries(cfg.ids)) {
            const iso = INSTANTS[key];
            const expected = new Date(iso).getTime();
            const entity = await repo.findOneBy({ id });
            const raw = (await ds.query(`SELECT ${[...EXPLICIT, ...AUTO.map(a => a[0])].map(c => `${rawExpr(c)} AS ${q(c)}`).join(', ')} FROM ${q(cfg.table || 'tz_probe')} WHERE id = ${id}`))[0];
            const r = {};
            for (const col of EXPLICIT) {
                const v = entity[col];
                if (v == null) { r[col] = { writeError: (cfg.writeErrors || {})[key] || 'null' }; continue; }
                // Vendure list filter: parse-filter-params.ts convertDate() -> DateUtils.mixedDateToUtcDatetimeString
                const lo = DateUtils.mixedDateToUtcDatetimeString(new Date(expected - 60000));
                const hi = DateUtils.mixedDateToUtcDatetimeString(new Date(expected + 60000));
                const filterHit = (await ds.query(`SELECT COUNT(*) AS c FROM ${q(cfg.table || 'tz_probe')} WHERE id = ${id} AND ${q(col)} >= ${isPg ? '$1' : '?'} AND ${q(col)} <= ${isPg ? '$2' : '?'}`, [lo, hi]))[0].c;
                // Same with a JS Date parameter (TypeORM / driver serialisation) - what most service code does
                const dateParamHit = !(isPg || isMy) ? filterHit : (await ds.query(`SELECT COUNT(*) AS c FROM ${q(cfg.table || 'tz_probe')} WHERE id = ${id} AND ${q(col)} >= ${isPg ? '$1' : '?'} AND ${q(col)} <= ${isPg ? '$2' : '?'}`, [new Date(expected - 60000), new Date(expected + 60000)]))[0].c;
                const day = (await ds.query(`SELECT ${dayExpr(col)} AS d FROM ${q(cfg.table || 'tz_probe')} WHERE id = ${id}`))[0].d;
                r[col] = {
                    raw: String(raw[col]),
                    readIso: v ? v.toISOString() : null,
                    readOffsetH: v ? hours(v.getTime() - expected) : null,
                    // what a UTC-assuming consumer (BI tool, another service, SQL report) sees
                    rawAsUtcOffsetH: hours(new Date(String(raw[col]).replace(' ', 'T').replace(/(\.\d+)?([+-]\d\d(:?\d\d)?)?$/, (m, f = '', z) => f + (z ? (z.length === 3 ? z + ':00' : z) : 'Z'))).getTime() - expected),
                    listFilterHit: Number(filterHit) === 1,
                    dateParamFilterHit: Number(dateParamHit) === 1,
                    metricsDay: day,
                    expectedUtcDay: iso.slice(0, 10),
                };
            }
            const a = cfg.auto[id];
            for (const [col, when] of AUTO) {
                const v = entity[col];
                r[col] = {
                    raw: String(raw[col]),
                    readIso: v.toISOString(),
                    readOffsetH: hours(v.getTime() - a[when]),
                    rawAsUtcOffsetH: hours(new Date(String(raw[col]).replace(' ', 'T').replace(/(\.\d+)?([+-]\d\d(:?\d\d)?)?$/, (m, f = '', z) => f + (z ? (z.length === 3 ? z + ':00' : z) : 'Z'))).getTime() - a[when]),
                };
            }
            rows[key] = r;
        }
        out.rows = rows;
    }
    await ds.destroy();
    process.stdout.write(JSON.stringify(out));
}
main().catch(e => {
    process.stdout.write(JSON.stringify({ error: String(e && e.stack || e) }));
    process.exit(1);
});
