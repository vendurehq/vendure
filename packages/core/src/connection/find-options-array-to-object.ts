import { FindOptionsRelations } from 'typeorm';

/**
 * @description
 * Converts a string array of relation paths into the object form used by the TypeORM
 * FindOptions `relations` property. Dotted paths are expanded into nested objects.
 *
 * @example
 * ```ts
 * findOptionsArrayToObject<Order>(['customer', 'lines.productVariant']);
 * // { customer: true, lines: { productVariant: true } }
 * ```
 *
 * @docsCategory data-access
 * @since 3.8.0
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
                // (`['lines.productVariant', 'lines']`). Overwriting that branch with
                // `true` would drop `productVariant` from the loaded relations.
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
