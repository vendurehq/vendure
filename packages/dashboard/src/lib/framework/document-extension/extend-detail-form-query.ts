import { extendDocument } from '@/vdb/framework/document-extension/extend-document.js';
import { getDetailQueryDocuments } from '@/vdb/framework/form-engine/custom-form-component-extensions.js';
import { DocumentNode } from 'graphql';

/**
 * @description
 * Extends a detail page query document with any registered extensions provided by
 * the `extendDetailDocument` function for the given page.
 */
export function extendDetailFormQuery<T extends DocumentNode>(
    detailQuery: T,
    pageId?: string,
): {
    extendedQuery: T;
    errorMessage?: string | null;
} {
    let result: T = detailQuery;
    let errorMessage: string | null = null;

    if (!pageId) {
        // If no pageId is provided, return the original query without any extensions
        return { extendedQuery: detailQuery };
    }

    const detailQueryExtensions = getDetailQueryDocuments(pageId);

    try {
        result = detailQueryExtensions.reduce(
            (acc, extension) => extendDocument(acc, extension),
            detailQuery,
        ) as T;
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        // Continue with the original query instead of the extended one
        result = detailQuery;
    }

    // Store error for useEffect to handle
    if (errorMessage) {
        // Log the error and continue with the original query
        // eslint-disable-next-line no-console
        console.warn(`${errorMessage}. Continuing with original query.`, {
            pageId,
            extensionsCount: detailQueryExtensions.length,
            error: errorMessage,
        });
    }

    return { extendedQuery: result, errorMessage };
}
