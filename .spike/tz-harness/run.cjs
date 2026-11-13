/* eslint-disable */
// OSS-1007 timezone harness orchestrator.
// Needs the oss1007-pg (17432), oss1007-mysql (17306), oss1007-mariadb (17307) containers.
// Usage: node run.cjs [--typeorm /path/to/node_modules/typeorm] [--only postgres,mysql,...] > results.jsonl
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const typeormPath = args.includes('--typeorm') ? args[args.indexOf('--typeorm') + 1] : undefined;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const label = 'typeorm-' + JSON.parse(fs.readFileSync(path.join(typeormPath || path.join(__dirname, '../../node_modules/typeorm'), 'package.json'), 'utf8')).version;
const NODE_TZS = ['UTC', 'Europe/Vienna', 'America/Los_Angeles', 'Asia/Kolkata'];
let n = 0;

function cell(tz, cfg, env = {}) {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'cell.cjs'), JSON.stringify({ ...cfg, typeormPath })], {
        env: { ...process.env, TZ: tz, ...env },
        encoding: 'utf8',
    });
    return JSON.parse(out);
}

function scenario(meta, db, writeTz, readTz, writeConn = {}, readConn = writeConn, env = {}, extra = {}) {
    const table = 'p' + process.pid + '_' + n++;
    const w = cell(writeTz, { db, mode: 'write', sync: true, table, connection: writeConn, ...extra }, env);
    if (w.error) throw new Error(w.error);
    const r = cell(readTz, { db, mode: 'read', table, ids: w.ids, auto: w.auto, writeErrors: w.writeErrors, connection: readConn, ...extra }, env);
    if (r.error) throw new Error(r.error);
    const rec = { typeorm: label, db, ...meta, writeTz, readTz, session: r.session, writeErrors: w.writeErrors, rows: r.rows };
    process.stdout.write(JSON.stringify(rec) + '\n');
    process.stderr.write(`${db} ${JSON.stringify(meta)} ${writeTz}->${readTz} ok\n`);
}

function pgAdmin(sql) {
    execFileSync('docker', ['exec', 'oss1007-pg', 'psql', '-U', 'vendure', '-d', 'tz', '-c', sql], { stdio: 'pipe' });
}
function myAdmin(container, bin, sql) {
    execFileSync('docker', ['exec', container, bin, '-uroot', '-ppassword', '-e', sql], { stdio: 'pipe' });
}

if (!only || only.includes('postgres')) {
    for (const serverTz of ['UTC', 'Europe/Vienna', 'America/Los_Angeles']) {
        pgAdmin(`ALTER SYSTEM SET timezone = '${serverTz}'`);
        pgAdmin('SELECT pg_reload_conf()');
        for (const [session, conn] of [
            ['server default', {}],
            ['-c timezone=UTC', { extra: { options: '-c timezone=UTC' } }],
        ]) {
            for (const tz of NODE_TZS) scenario({ pgServerTz: serverTz, pgSession: session }, 'postgres', tz, tz, conn);
        }
    }
    pgAdmin(`ALTER SYSTEM SET timezone = 'UTC'`);
    pgAdmin('SELECT pg_reload_conf()');
    // Process TZ changes between write and read (dev laptop -> UTC container; API vs worker in different TZ)
    for (const [a, b] of [['Europe/Vienna', 'UTC'], ['UTC', 'Europe/Vienna'], ['UTC', 'America/Los_Angeles'], ['America/Los_Angeles', 'UTC'], ['Asia/Kolkata', 'UTC']])
        scenario({ pgServerTz: 'UTC', pgSession: 'server default', crossTz: true }, 'postgres', a, b);
    // PGTZ env: does node-postgres honour it? (libpq does; pg does not)
    scenario({ pgServerTz: 'UTC', pgSession: 'PGTZ=Europe/Vienna env' }, 'postgres', 'UTC', 'UTC', {}, {}, { PGTZ: 'Europe/Vienna' });
    // Fix candidate from #3409: parse/serialise naive timestamps as UTC in the pg driver
    // (exercised in the Vendure-level test, not here)
    pgAdmin(`ALTER SYSTEM RESET timezone`);
    pgAdmin('SELECT pg_reload_conf()');
}

for (const [db, container, bin] of [['mysql', 'oss1007-mysql', 'mysql'], ['mariadb', 'oss1007-mariadb', 'mariadb']]) {
    if (only && !only.includes(db)) continue;
    for (const globalTz of ['+00:00', 'Europe/Vienna']) {
        myAdmin(container, bin, `SET GLOBAL time_zone = '${globalTz}'`);
        for (const tzOpt of ['Z', 'local']) {
            for (const tz of NODE_TZS) scenario({ mysqlGlobalTz: globalTz, typeormTimezone: tzOpt }, db, tz, tz, { timezone: tzOpt });
        }
    }
    myAdmin(container, bin, `SET GLOBAL time_zone = '+00:00'`);
    for (const [a, b] of [['Europe/Vienna', 'UTC'], ['UTC', 'America/Los_Angeles']]) {
        scenario({ mysqlGlobalTz: '+00:00', typeormTimezone: 'Z', crossTz: true }, db, a, b, { timezone: 'Z' });
        scenario({ mysqlGlobalTz: '+00:00', typeormTimezone: 'local', crossTz: true }, db, a, b, { timezone: 'local' });
    }
    myAdmin(container, bin, `SET GLOBAL time_zone = 'SYSTEM'`);
}

for (const db of ['better-sqlite3', 'sqljs']) {
    if (only && !only.includes(db)) continue;
    if (typeormPath) continue;
    for (const tz of NODE_TZS) {
        const file = path.join(os.tmpdir(), `oss1007-${db}-${process.pid}-${n}.sqlite`);
        scenario({}, db, tz, tz, {}, {}, {}, { file });
    }
    const file = path.join(os.tmpdir(), `oss1007-${db}-${process.pid}-x.sqlite`);
    scenario({ crossTz: true }, db, 'Europe/Vienna', 'UTC', {}, {}, {}, { file });
}
