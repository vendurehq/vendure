import { SelectQueryBuilder } from 'typeorm';
/**
 * 把 GraphQL `sort`（Vendure 形态 `{ name: 'ASC' }`、`{ name: { direction: 'ASC' } }`
 * 或数组 `[{ field: 'name', direction: 'ASC' }]`）映射为 QueryBuilder orderBy。
 * 只接受白名单字段，非法字段/方向静默丢弃；结果为空时不追加排序（保持原行为）。
 */
export declare function applyListSort(qb: SelectQueryBuilder<any>, alias: string, sort: unknown, allowed: ReadonlyArray<string>): void;
