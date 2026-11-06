"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyListSort = applyListSort;
/**
 * 把 GraphQL `sort`（Vendure 形态 `{ name: 'ASC' }`、`{ name: { direction: 'ASC' } }`
 * 或数组 `[{ field: 'name', direction: 'ASC' }]`）映射为 QueryBuilder orderBy。
 * 只接受白名单字段，非法字段/方向静默丢弃；结果为空时不追加排序（保持原行为）。
 */
function applyListSort(qb, alias, sort, allowed) {
    var _a;
    const entries = [];
    if (Array.isArray(sort)) {
        for (const item of sort) {
            if (!item || typeof item !== 'object')
                continue;
            entries.push({
                field: String((_a = item.field) !== null && _a !== void 0 ? _a : ''),
                direction: normalizeDirection(item.direction),
            });
        }
    }
    else if (sort && typeof sort === 'object') {
        for (const [field, value] of Object.entries(sort)) {
            const direction = typeof value === 'string'
                ? normalizeDirection(value)
                : normalizeDirection(value === null || value === void 0 ? void 0 : value.direction);
            entries.push({ field, direction });
        }
    }
    const seen = new Set();
    for (const entry of entries) {
        if (!entry.direction || !allowed.includes(entry.field) || seen.has(entry.field))
            continue;
        seen.add(entry.field);
        qb.addOrderBy(`${alias}.${entry.field}`, entry.direction);
    }
}
function normalizeDirection(value) {
    const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return v === 'ASC' || v === 'DESC' ? v : null;
}
//# sourceMappingURL=list-sort.js.map