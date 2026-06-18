import { PageBlockContext } from '@/vdb/framework/layout-engine/page-block-provider.js';
import { useContext } from 'react';

/**
 * @description
 * Returns the current PageBlock context, which means there must be
 * a PageBlock ancestor component higher in the tree.
 *
 * If `optional` is set to true, the hook will not throw if no PageBlock
 * exists higher in the tree, but will just return undefined.
 *
 * @example
 * ```tsx
 * const { blockId, title, description, column } = usePageBlock();
 * ```
 * 
 * @docsCategory page-layout
 * @docsPage usePageBlock
 * @since 3.3.0
 */
export function usePageBlock({ optional }: { optional?: boolean } = {}) {
    const pageBlock = useContext(PageBlockContext);
    if (!pageBlock && !optional) {
        throw new Error('PageBlockProvider not found');
    }
    return pageBlock;
}
