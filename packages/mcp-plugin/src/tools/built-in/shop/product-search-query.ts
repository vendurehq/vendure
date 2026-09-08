import { ListQueryOptions, Product } from '@vendure/core';

import { type ListInput, listOptions } from '../list-helpers';

// Words under four characters are left alone so short words like "gas" or "bus" aren't mangled.
function singular(word: string): string {
    if (word.length < 4) {
        return word;
    }
    if (/(?:s|x|z|ch|sh)es$/i.test(word)) {
        return word.slice(0, -2);
    }
    if (/[^s]s$/i.test(word)) {
        return word.slice(0, -1);
    }
    return word;
}

// `trimPlurals` is used as a second attempt when the words as typed find nothing.
export function productSearchWords(query: string | undefined, trimPlurals = false): string[] {
    const words = (query ?? '')
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0);
    return trimPlurals ? words.map(singular) : words;
}

export function publicProductListOptions(input: ListInput, words: string[] = []): ListQueryOptions<Product> {
    const options = listOptions<Product>({ limit: input.limit, offset: input.offset });
    const wordFilters = words.map(word => ({
        _or: [{ name: { contains: word } }, { slug: { contains: word } }],
    }));
    return {
        ...options,
        filter: {
            enabled: { eq: true },
            ...(wordFilters.length ? { _and: wordFilters } : {}),
        },
    };
}
