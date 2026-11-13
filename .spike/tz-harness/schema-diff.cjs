/* eslint-disable */
// What does TypeORM's migration generator emit when a column changes from timestamp to timestamptz?
const { DataSource, EntitySchema } = require('typeorm');
const mk = type => new EntitySchema({ name: 'M', tableName: 'schema_diff', columns: {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type, createDate: true },
    placedAt: { type, nullable: true },
} });
const opts = { type: 'postgres', host: '127.0.0.1', port: 17432, username: 'vendure', password: 'password', database: 'tz' };
(async () => {
    const a = new DataSource({ ...opts, entities: [mk('timestamp')], synchronize: true, dropSchema: false });
    await a.initialize();
    await a.query(`INSERT INTO schema_diff ("placedAt") VALUES ('2026-01-15 12:00:00')`);
    await a.destroy();
    const b = new DataSource({ ...opts, entities: [mk('timestamptz')] });
    await b.initialize();
    const log = await b.driver.createSchemaBuilder().log();
    for (const q of log.upQueries) console.log(q.query);
    await b.query('DROP TABLE schema_diff');
    await b.destroy();
})();
