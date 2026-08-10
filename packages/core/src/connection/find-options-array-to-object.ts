import { FindOptionsRelations } from 'typeorm';

/**
 * Converts a string array of relation paths into the object form used by the TypeORM
 * FindOptions `relations` property. Dotted paths are expanded into nested objects, so
 * `['customer', 'lines.productVariant']` becomes
 * `{ customer: true, lines: { productVariant: true } }`.
 */
export function findOptionsArrayToObject<T>(input: string[]): FindOptionsRelations<T> {
    const result: Record<string, any> = {};

    for (const path of input) {
        if (!path) {
            continue;
        }
        const segments = path.split('.');
        let node = result;
        for (const [index, segment] of segments.entries()) {
            const isLeaf = index === segments.length - 1;
            if (isLeaf) {
                // A shorter path may arrive after the longer one that nested it
                // (`['lines.productVariant', 'lines']`), in which case the branch
                // already selects the relation and must not be flattened to `true`.
                node[segment] ??= true;
            } else {
                if (node[segment] == null || node[segment] === true) {
                    node[segment] = {};
                }
                node = node[segment];
            }
        }
    }

    return result as FindOptionsRelations<T>;
}
