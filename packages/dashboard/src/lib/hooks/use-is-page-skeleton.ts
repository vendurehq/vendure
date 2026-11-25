import { PageSkeletonContext } from '@/vdb/framework/layout-engine/page-skeleton-context.js';
import { useContext } from 'react';

/**
 * True inside the skeleton of a page while its route loads.
 */
export function useIsPageSkeleton() {
    return useContext(PageSkeletonContext);
}
