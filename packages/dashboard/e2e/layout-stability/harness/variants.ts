import type { ResponseRewrite } from './network.js';

/**
 * Content variants of a paginated list response (`{ <field>: { items, totalItems } }`).
 * Each takes the real response and changes only its content, so the shape is
 * always the server's.
 */
export type ListVariant = 'real' | 'empty' | 'oneRow' | 'fullPage' | 'longNames' | 'noImages' | 'bigTotal';

export const LIST_VARIANTS: Record<ListVariant, string> = {
    real: 'the real response',
    empty: '0 rows',
    oneRow: '1 row',
    fullPage: 'a full page (120 items in total)',
    longNames: 'names and slugs of 80+ characters',
    noImages: 'no featured asset',
    bigTotal: 'totalItems 123,456',
};

const LONG = 'An extraordinarily long product name that keeps going well past eighty characters';

function pageSize(variables: Record<string, any>) {
    return Number(variables?.options?.take) || 10;
}

function mapList(
    data: any,
    fn: (list: { items: any[]; totalItems: number }, variables: any) => any,
    variables: any,
) {
    const field = Object.keys(data ?? {}).find(k => Array.isArray(data[k]?.items));
    if (!field) return data;
    return { ...data, [field]: fn(data[field], variables) };
}

/** Fills the page to `take` rows with copies of the real rows (ids made unique). */
export function fillPage(items: any[], take: number, offset = 0) {
    if (items.length === 0) return items;
    return Array.from({ length: take }, (_, i) => {
        const source = items[i % items.length];
        return i < items.length && offset === 0
            ? source
            : { ...source, id: `${source.id}-copy-${offset + i}` };
    });
}

export function listVariant(variant: ListVariant): ResponseRewrite | undefined {
    switch (variant) {
        case 'real':
            return undefined;
        case 'empty':
            return (data, vars) => mapList(data, list => ({ ...list, items: [], totalItems: 0 }), vars);
        case 'oneRow':
            return (data, vars) =>
                mapList(data, list => ({ ...list, items: list.items.slice(0, 1), totalItems: 1 }), vars);
        case 'fullPage': {
            // A later page of a short list is empty on the server: fill it from the rows seen before.
            let seen: any[] = [];
            return (data, vars) =>
                mapList(
                    data,
                    (list, v) => {
                        if (list.items.length) seen = list.items;
                        return {
                            ...list,
                            items: fillPage(seen, pageSize(v), Number(v?.options?.skip) || 0),
                            totalItems: 120,
                        };
                    },
                    vars,
                );
        }
        case 'longNames':
            return (data, vars) =>
                mapList(
                    data,
                    list => ({
                        ...list,
                        items: list.items.map((item, i) => ({
                            ...item,
                            ...('name' in item ? { name: `${LONG} ${i + 1}` } : {}),
                            ...('slug' in item
                                ? { slug: `${LONG.toLowerCase().replace(/ /g, '-')}-${i + 1}` }
                                : {}),
                        })),
                    }),
                    vars,
                );
        case 'noImages':
            return (data, vars) =>
                mapList(
                    data,
                    list => ({
                        ...list,
                        items: list.items.map(item =>
                            'featuredAsset' in item ? { ...item, featuredAsset: null } : item,
                        ),
                    }),
                    vars,
                );
        case 'bigTotal':
            return (data, vars) => mapList(data, list => ({ ...list, totalItems: 123456 }), vars);
    }
}
