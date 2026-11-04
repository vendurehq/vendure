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
export declare function findDbColumn(connection: Connection, tableName: string, fieldName: string): Promise<string | null>;
