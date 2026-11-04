import { Connection } from 'typeorm';

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
export async function findDbColumn(
  connection: Connection,
  tableName: string,
  fieldName: string,
): Promise<string | null> {
  const normalizedField = fieldName.toLowerCase().replace(/_/g, '');
  const dbType = connection.options.type;

  if (dbType === 'postgres' || dbType === 'aurora-postgres') {
    const rows = (await connection.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
      [tableName],
    )) as Array<{ column_name: string }>;
    return (
      rows.find(r => r.column_name.toLowerCase().replace(/_/g, '').includes(normalizedField))
        ?.column_name ?? null
    );
  }

  const columns = (await connection.query(`PRAGMA table_info("${tableName}")`)) as Array<{
    name: string;
  }>;
  return columns.find(c => c.name.toLowerCase().replace(/_/g, '').includes(normalizedField))?.name ?? null;
}
