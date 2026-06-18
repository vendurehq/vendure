import { toast } from '@/vdb/components/ui/sonner.js';
import { extendDetailFormQuery } from '@/vdb/framework/document-extension/extend-detail-form-query.js';
import { useLingui } from '@lingui/react/macro';
import { DocumentNode } from 'graphql';
import { useEffect, useMemo, useRef } from 'react';

/**
 * @description
 * Extends a detail page query document with any registered extensions provided by
 * the `extendDetailDocument` function for the given page.
 */
export function useExtendedDetailQuery<T extends DocumentNode>(detailQuery: T, pageId?: string) {
    const hasShownError = useRef(false);
    const { i18n } = useLingui();

    const extendedDetailQuery = useMemo(() => {
        if (!pageId || !detailQuery) {
            return detailQuery;
        }
        const result = extendDetailFormQuery(detailQuery, pageId);
        if (result.errorMessage && !hasShownError.current) {
            // Show a user-friendly toast notification
            toast.error(i18n.t('Query extension error'), {
                description:
                    result.errorMessage + '. ' + i18n.t('The page will continue with the default query.'),
            });
        }
        return result.extendedQuery;
    }, [detailQuery, pageId]);

    // Reset error flag when dependencies change
    useEffect(() => {
        hasShownError.current = false;
    }, [detailQuery, pageId]);

    return extendedDetailQuery;
}
