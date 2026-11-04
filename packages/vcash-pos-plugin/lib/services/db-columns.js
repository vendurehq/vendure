"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDbColumn = findDbColumn;
/**
 * 动态查找实体表的实际数据库列名。
 *
 * customFields 是 embedded entity，列名在不同数据库/命名策略下不一致
 * （如 `customFieldsOrdertype` vs `customFields_orderType`）。
 * SQLite 用 PRAGMA table_info，PostgreSQL 用 information_schema.columns。
 *
 * @param tableName 表名（Vendure 为小写，如 order / payment）
 * @param fieldName 字段名（如 orderType / posSessionId），按去下划线后不区分大小写匹配
 */
async function findDbColumn(connection, tableName, fieldName) {
    var _a, _b, _c, _d;
    const normalizedField = fieldName.toLowerCase().replace(/_/g, '');
    const dbType = connection.options.type;
    if (dbType === 'postgres' || dbType === 'aurora-postgres') {
        const rows = (await connection.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema NOT IN ('pg_catalog', 'information_schema')`, [tableName]));
        return ((_b = (_a = rows.find(r => r.column_name.toLowerCase().replace(/_/g, '').includes(normalizedField))) === null || _a === void 0 ? void 0 : _a.column_name) !== null && _b !== void 0 ? _b : null);
    }
    const columns = (await connection.query(`PRAGMA table_info("${tableName}")`));
    return (_d = (_c = columns.find(c => c.name.toLowerCase().replace(/_/g, '').includes(normalizedField))) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null;
}
//# sourceMappingURL=db-columns.js.map