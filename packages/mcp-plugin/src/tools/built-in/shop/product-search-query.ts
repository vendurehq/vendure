import { ListQueryOptions, Product } from '@vendure/core';

import { type ListInput, listOptions } from '../list-helpers';

/**
 * Trims a plural ending off a word. Only characters at the end are removed, and product matching
 * is substring-based, so the trimmed word always finds everything the original word would find.
 * Words under four characters are left alone so that "gas" or "bus" are not mangled.
 */
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

/**
 * Splits a search query into the words a product has to match. Pass `trimPlurals` to get the words
 * with their plural endings removed; `search_products` uses that as a second attempt when the words
 * as the shopper typed them find nothing.
 */
export function productSearchWords(query: string | undefined, trimPlurals = false): string[] {
    const words = (query ?? '')
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0);
    return trimPlurals ? words.map(singular) : words;
}

/**
 * Builds the query for a public product search: only enabled products, and every word has to turn
 * up in the product's name or slug, in any order. Descriptions are not searched.
 */
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
