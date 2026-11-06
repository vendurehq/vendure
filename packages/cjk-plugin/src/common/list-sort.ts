import { SelectQueryBuilder } from 'typeorm';

type Direction = 'ASC' | 'DESC';

/**
 * 把 GraphQL `sort`（Vendure 形态 `{ name: 'ASC' }`、`{ name: { direction: 'ASC' } }`
 * 或数组 `[{ field: 'name', direction: 'ASC' }]`）映射为 QueryBuilder orderBy。
 * 只接受白名单字段，非法字段/方向静默丢弃；结果为空时不追加排序（保持原行为）。
 */
export function applyListSort(
    qb: SelectQueryBuilder<any>,
    alias: string,
    sort: unknown,
    allowed: ReadonlyArray<string>,
): void {
    const entries: Array<{ field: string; direction: Direction | null }> = [];
    if (Array.isArray(sort)) {
        for (const item of sort) {
            if (!item || typeof item !== 'object') continue;
            entries.push({
                field: String((item as any).field ?? ''),
                direction: normalizeDirection((item as any).direction),
            });
        }
    } else if (sort && typeof sort === 'object') {
        for (const [field, value] of Object.entries(sort as Record<string, unknown>)) {
            const direction =
                typeof value === 'string'
                    ? normalizeDirection(value)
                    : normalizeDirection((value as any)?.direction);
            entries.push({ field, direction });
        }
    }
    const seen = new Set<string>();
    for (const entry of entries) {
        if (!entry.direction || !allowed.includes(entry.field) || seen.has(entry.field)) continue;
        seen.add(entry.field);
        qb.addOrderBy(`${alias}.${entry.field}`, entry.direction);
    }
}

function normalizeDirection(value: unknown): Direction | null {
    const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return v === 'ASC' || v === 'DESC' ? v : null;
}
