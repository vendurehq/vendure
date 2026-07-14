import { toast } from '@/vdb/components/ui/sonner.js';
import { getListQueryDocuments } from '@/vdb/framework/data-table/data-table-extensions.js';
import { extendDocument } from '@/vdb/framework/document-extension/extend-document.js';
import { useLingui } from '@lingui/react/macro';
import { DocumentNode } from 'graphql';
import { useEffect, useMemo, useRef } from 'react';

import { usePageBlock } from './use-page-block.js';
import { usePage } from './use-page.js';

/**
 * @description
 * Extends the given list query document with additional fields that can be
 * supplied via the Dashboard Extension API.
 */
export function useExtendedListQuery<T extends DocumentNode>(listQuery: T) {
    const { pageId } = usePage();
    const { blockId } = usePageBlock() ?? {};
    const { i18n } = useLingui();
    const listQueryExtensions = pageId && blockId ? getListQueryDocuments(pageId, blockId) : [];
    const hasShownError = useRef(false);

    const extendedListQuery = useMemo(() => {
        let result: T = listQuery;

        try {
            result = listQueryExtensions.reduce(
                (acc, extension) => extendDocument(acc, extension),
                listQuery,
            ) as T;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            // Continue with the original query instead of the extended one
            result = listQuery;

            // Store error for useEffect to handle
            if (error && !hasShownError.current) {
                hasShownError.current = true;

                // Provide a helpful error message based on the error type
                let errorMessageText = i18n.t('Failed to extend query document');
                if (error.message.includes('Extension query must have at least one top-level field')) {
                    errorMessageText = i18n.t(
                        'Query extension is invalid: must have at least one top-level field',
                    );
                } else if (error.message.includes('The query extension must extend the')) {
                    errorMessageText = i18n.t('Query extension mismatch: ') + error.message;
                } else if (error.message.includes('Syntax Error')) {
                    errorMessageText = i18n.t('Query extension contains invalid GraphQL syntax');
                } else {
                    errorMessageText = i18n.t('Query extension error: ') + error.message;
                }

                // Log the error and continue with the original query
                // eslint-disable-next-line no-console
                console.warn(`${errorMessageText}. Continuing with original query.`, {
                    pageId,
                    blockId,
                    extensionsCount: listQueryExtensions.length,
                    error: error.message,
                });

                // Show a user-friendly toast notification
                toast.error(i18n.t('Query extension error'), {
                    description:
                        errorMessageText + '. ' + i18n.t('The page will continue with the default query.'),
                });
            }
        }

        return result;
    }, [listQuery, listQueryExtensions, pageId, blockId]);

    // Reset error flag when dependencies change
    useEffect(() => {
        hasShownError.current = false;
    }, [listQuery, listQueryExtensions, pageId, blockId]);

    return extendedListQuery;
}
